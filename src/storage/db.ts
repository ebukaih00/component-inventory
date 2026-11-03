/** IndexedDB storage: one inventory per product domain, all local. */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import {
  buildExport,
  inventoryIdForDomain,
  mergeScan,
  newInventory,
  type Instance,
  type Inventory,
  type InventoryExport,
  type InventoryState,
  type Page,
  type PageScan,
  type ScanResult,
  type Variant,
} from '../detect';
import type { ThumbNeed } from '../shared/messages';

export const MAX_THUMBNAILS = 3;

/** Stored variant: the data-model Variant plus where each thumbnail came from. */
export type StoredVariant = Variant & { thumbnailSources?: string[] };

interface InventoryDB extends DBSchema {
  inventories: { key: string; value: Inventory };
  pages: { key: string; value: Page; indexes: { inventoryId: string } };
  variants: { key: string; value: StoredVariant; indexes: { inventoryId: string } };
  instances: { key: string; value: Instance; indexes: { inventoryId: string; pageId: string } };
}

let dbPromise: Promise<IDBPDatabase<InventoryDB>> | null = null;

export function db(): Promise<IDBPDatabase<InventoryDB>> {
  dbPromise ??= openDB<InventoryDB>('component-inventory', 1, {
    upgrade(d) {
      d.createObjectStore('inventories', { keyPath: 'id' });
      d.createObjectStore('pages', { keyPath: 'id' }).createIndex('inventoryId', 'inventoryId');
      d.createObjectStore('variants', { keyPath: 'id' }).createIndex('inventoryId', 'inventoryId');
      const inst = d.createObjectStore('instances', { keyPath: 'id' });
      inst.createIndex('inventoryId', 'inventoryId');
      inst.createIndex('pageId', 'pageId');
    },
  });
  return dbPromise;
}

/** For tests: forget the cached connection. */
export function resetDbConnection() {
  dbPromise = null;
}

export async function listInventories(): Promise<Inventory[]> {
  return (await db()).getAll('inventories');
}

export async function getInventory(domain: string): Promise<Inventory | undefined> {
  return (await db()).get('inventories', inventoryIdForDomain(domain));
}

export async function ensureInventory(domain: string): Promise<Inventory> {
  const d = await db();
  const existing = await d.get('inventories', inventoryIdForDomain(domain));
  if (existing) return existing;
  const inv = newInventory(domain);
  await d.put('inventories', inv);
  return inv;
}

export async function setRecording(domain: string, recording: boolean): Promise<Inventory> {
  const inv = await ensureInventory(domain);
  const next = { ...inv, recording };
  await (await db()).put('inventories', next);
  return next;
}

export async function loadState(inventoryId: string): Promise<InventoryState | null> {
  const d = await db();
  const inventory = await d.get('inventories', inventoryId);
  if (!inventory) return null;
  const [pages, variants, instances] = await Promise.all([
    d.getAllFromIndex('pages', 'inventoryId', inventoryId),
    d.getAllFromIndex('variants', 'inventoryId', inventoryId),
    d.getAllFromIndex('instances', 'inventoryId', inventoryId),
  ]);
  return { inventory, pages, variants, instances };
}

function needsFor(v: StoredVariant): ThumbNeed {
  return { need: Math.max(0, MAX_THUMBNAILS - v.thumbnails.length), sources: v.thumbnailSources ?? [] };
}

/** Records a page scan in one transaction. Returns what changed and which variants still need thumbnails. */
export async function recordScan(domain: string, scan: PageScan): Promise<{ result: ScanResult; needThumbs: Record<string, ThumbNeed> }> {
  const inventory = await ensureInventory(domain);
  const d = await db();
  const tx = d.transaction(['pages', 'variants', 'instances'], 'readwrite');
  const variants = await tx.objectStore('variants').index('inventoryId').getAll(inventory.id);
  const result = mergeScan({ inventory, variants }, scan);
  await tx.objectStore('pages').put(result.page);
  for (const v of result.newVariants) await tx.objectStore('variants').put(v);
  const oldKeys = await tx.objectStore('instances').index('pageId').getAllKeys(result.page.id);
  for (const k of oldKeys) await tx.objectStore('instances').delete(k);
  for (const i of result.instances) await tx.objectStore('instances').put(i);
  await tx.done;

  const byId = new Map<string, StoredVariant>([...variants, ...result.newVariants].map((v) => [v.id, v]));
  const needThumbs: Record<string, ThumbNeed> = {};
  for (const id of result.candidatesByVariant.keys()) {
    const v = byId.get(id);
    if (v && v.thumbnails.length < MAX_THUMBNAILS) needThumbs[id] = needsFor(v);
  }
  return { result, needThumbs };
}

export async function thumbsNeeded(variantIds: string[]): Promise<Record<string, ThumbNeed>> {
  const d = await db();
  const out: Record<string, ThumbNeed> = {};
  for (const id of variantIds) {
    const v = await d.get('variants', id);
    if (v && v.thumbnails.length < MAX_THUMBNAILS) out[id] = needsFor(v);
  }
  return out;
}

export async function addThumbnail(variantId: string, dataUrl: string, source: string): Promise<boolean> {
  const d = await db();
  const tx = d.transaction('variants', 'readwrite');
  const v = await tx.store.get(variantId);
  if (!v || v.thumbnails.length >= MAX_THUMBNAILS || (v.thumbnailSources ?? []).includes(source)) {
    await tx.done;
    return false;
  }
  await tx.store.put({ ...v, thumbnails: [...v.thumbnails, dataUrl], thumbnailSources: [...(v.thumbnailSources ?? []), source] });
  await tx.done;
  return true;
}

/* ---------- review actions (side panel) ---------- */

async function updateVariants(ids: string[], fn: (v: StoredVariant) => StoredVariant): Promise<void> {
  const d = await db();
  const tx = d.transaction('variants', 'readwrite');
  for (const id of ids) {
    const v = await tx.store.get(id);
    if (v) await tx.store.put(fn(v));
  }
  await tx.done;
}

export function renameVariant(id: string, name: string) {
  const trimmed = name.trim();
  return updateVariants([id], (v) => (trimmed ? { ...v, name: trimmed, renamed: true } : v));
}

/** Merge: the others become instances of the target. */
export function mergeVariants(targetId: string, otherIds: string[]) {
  return updateVariants(otherIds.filter((id) => id !== targetId), (v) => ({ ...v, status: 'merged', mergedInto: targetId }));
}

/** Undo a merge: every variant merged into targetId is kept again. */
export async function unmergeInto(targetId: string, memberIds: string[]) {
  return updateVariants(memberIds.filter((id) => id !== targetId), (v) =>
    v.mergedInto === targetId ? { ...v, status: 'kept', mergedInto: null } : v,
  );
}

/** Split: this variant is not the same as the others in its group. */
export function splitFromGroup(id: string, otherIds: string[]) {
  return updateVariants([id], (v) => ({ ...v, notSameAs: [...new Set([...v.notSameAs, ...otherIds.filter((o) => o !== id)])] }));
}

export function setIgnored(ids: string[], ignored: boolean) {
  return updateVariants(ids, (v) => ({ ...v, status: ignored ? 'ignored' : 'kept', mergedInto: null }));
}

export async function deleteInventory(inventoryId: string) {
  const d = await db();
  const tx = d.transaction(['inventories', 'pages', 'variants', 'instances'], 'readwrite');
  await tx.objectStore('inventories').delete(inventoryId);
  for (const store of ['pages', 'variants', 'instances'] as const) {
    const keys = await tx.objectStore(store).index('inventoryId').getAllKeys(inventoryId);
    for (const k of keys) await tx.objectStore(store).delete(k);
  }
  await tx.done;
}

export async function exportInventory(inventoryId: string): Promise<InventoryExport | null> {
  const state = await loadState(inventoryId);
  return state ? buildExport(state) : null;
}
