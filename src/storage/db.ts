/** IndexedDB storage: one inventory per product domain, all local. */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import {
  buildExport,
  groupId as makeGroupId,
  type Capture,
  type CollectionState,
  type Group,
  inventoryIdForDomain,
  mergeScan,
  newInventory,
  type Instance,
  type Inventory,
  type InventoryExport,
  type InventoryState,
  type Page,
  type PickRule,
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
  groups: { key: string; value: Group; indexes: { inventoryId: string } };
  captures: { key: string; value: Capture; indexes: { inventoryId: string; groupId: string } };
}

let dbPromise: Promise<IDBPDatabase<InventoryDB>> | null = null;

export function db(): Promise<IDBPDatabase<InventoryDB>> {
  dbPromise ??= openDB<InventoryDB>('component-inventory', 2, {
    upgrade(d, oldVersion) {
      if (oldVersion < 1) {
        d.createObjectStore('inventories', { keyPath: 'id' });
        d.createObjectStore('pages', { keyPath: 'id' }).createIndex('inventoryId', 'inventoryId');
        d.createObjectStore('variants', { keyPath: 'id' }).createIndex('inventoryId', 'inventoryId');
        const inst = d.createObjectStore('instances', { keyPath: 'id' });
        inst.createIndex('inventoryId', 'inventoryId');
        inst.createIndex('pageId', 'pageId');
      }
      if (oldVersion < 2) {
        // The board: groups the user makes, and the components they collect into them.
        d.createObjectStore('groups', { keyPath: 'id' }).createIndex('inventoryId', 'inventoryId');
        const cap = d.createObjectStore('captures', { keyPath: 'id' });
        cap.createIndex('inventoryId', 'inventoryId');
        cap.createIndex('groupId', 'groupId');
      }
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

/** Add a hand-picked rule (replacing one with the same id). */
export async function addRule(domain: string, rule: PickRule): Promise<Inventory> {
  const inv = await ensureInventory(domain);
  const next = { ...inv, rules: [...(inv.rules ?? []).filter((r) => r.id !== rule.id), rule] };
  await (await db()).put('inventories', next);
  return next;
}

export async function getRules(domain: string): Promise<PickRule[]> {
  return (await getInventory(domain))?.rules ?? [];
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
  const tx = d.transaction(['inventories', 'pages', 'variants', 'instances', 'groups', 'captures'], 'readwrite');
  await tx.objectStore('inventories').delete(inventoryId);
  for (const store of ['pages', 'variants', 'instances', 'groups', 'captures'] as const) {
    const keys = await tx.objectStore(store).index('inventoryId').getAllKeys(inventoryId);
    for (const k of keys) await tx.objectStore(store).delete(k);
  }
  await tx.done;
}

export async function exportInventory(inventoryId: string): Promise<InventoryExport | null> {
  const state = await loadState(inventoryId);
  return state ? buildExport(state) : null;
}

/* ---------- the board: groups and collected components ---------- */

export async function loadCollection(inventoryId: string): Promise<CollectionState | null> {
  const d = await db();
  const inventory = await d.get('inventories', inventoryId);
  if (!inventory) return null;
  const [groups, captures] = await Promise.all([
    d.getAllFromIndex('groups', 'inventoryId', inventoryId),
    d.getAllFromIndex('captures', 'inventoryId', inventoryId),
  ]);
  return { inventory, groups, captures };
}

/** Where Collect puts new components: a group id, or null for Unsorted. */
export async function setCollectInto(domain: string, groupId: string | null): Promise<void> {
  const inv = await ensureInventory(domain);
  await (await db()).put('inventories', { ...inv, collectInto: groupId });
}

export async function createGroup(domain: string, name: string, now = Date.now()): Promise<Group> {
  const inv = await ensureInventory(domain);
  const group: Group = { id: makeGroupId(inv.id, name, now), inventoryId: inv.id, name: name.trim() || 'Untitled group', createdAt: now, usage: {} };
  await (await db()).put('groups', group);
  return group;
}

export async function getGroup(id: string): Promise<Group | undefined> {
  return (await db()).get('groups', id);
}

export async function renameGroup(id: string, name: string) {
  const d = await db();
  const g = await d.get('groups', id);
  if (g && name.trim()) await d.put('groups', { ...g, name: name.trim() });
}

export async function setGroupUsage(id: string, route: string, count: number) {
  const d = await db();
  const g = await d.get('groups', id);
  if (g) await d.put('groups', { ...g, usage: { ...g.usage, [route]: count } });
}

/** Deleting a group keeps what was in it: its components go back to Unsorted. */
export async function deleteGroup(id: string) {
  const d = await db();
  const tx = d.transaction(['groups', 'captures', 'inventories'], 'readwrite');
  const g = await tx.objectStore('groups').get(id);
  await tx.objectStore('groups').delete(id);
  for (const c of await tx.objectStore('captures').index('groupId').getAll(id)) {
    await tx.objectStore('captures').put({ ...c, groupId: null });
  }
  if (g) {
    const inv = await tx.objectStore('inventories').get(g.inventoryId);
    if (inv?.collectInto === id) await tx.objectStore('inventories').put({ ...inv, collectInto: null });
  }
  await tx.done;
}

/** Adds a capture, or updates the same element collected again (keeping its first date). */
export async function putCapture(c: Capture): Promise<{ added: boolean }> {
  const d = await db();
  const tx = d.transaction('captures', 'readwrite');
  const old = await tx.store.get(c.id);
  await tx.store.put(old ? { ...c, createdAt: old.createdAt, thumbnail: c.thumbnail ?? old.thumbnail } : c);
  await tx.done;
  return { added: !old };
}

export async function moveCaptures(ids: string[], groupId: string | null) {
  const d = await db();
  const tx = d.transaction('captures', 'readwrite');
  for (const id of ids) {
    const c = await tx.store.get(id);
    if (c) await tx.store.put({ ...c, groupId });
  }
  await tx.done;
}

export async function deleteCaptures(ids: string[]) {
  const d = await db();
  const tx = d.transaction('captures', 'readwrite');
  for (const id of ids) await tx.store.delete(id);
  await tx.done;
}

export async function groupCaptures(groupId: string): Promise<Capture[]> {
  return (await db()).getAllFromIndex('captures', 'groupId', groupId);
}

/** Clears the board (groups and collected components); Auto-detect's data stays. */
export async function deleteBoard(inventoryId: string) {
  const d = await db();
  const tx = d.transaction(['inventories', 'groups', 'captures'], 'readwrite');
  for (const store of ['groups', 'captures'] as const) {
    const keys = await tx.objectStore(store).index('inventoryId').getAllKeys(inventoryId);
    for (const k of keys) await tx.objectStore(store).delete(k);
  }
  const inv = await tx.objectStore('inventories').get(inventoryId);
  if (inv) await tx.objectStore('inventories').put({ ...inv, collectInto: null });
  await tx.done;
}
