/** Step 4: record a page scan into an inventory. Pure: returns what changed. */
import { variantKey, variantId, styleSummary } from './fingerprint';
import { hash } from './hash';
import { normalizeUrl, routePattern } from './route';
import { kindLabel } from './labels';
import type { Instance, Inventory, InventoryState, Page, PageScan, Variant } from './types';

export { kindLabel };

export function inventoryIdForDomain(domain: string): string {
  return `inv_${domain}`;
}

export function newInventory(domain: string, now = Date.now()): Inventory {
  return { id: inventoryIdForDomain(domain), name: domain, domain, createdAt: now, recording: false };
}

export function pageId(inventoryId: string, url: string): string {
  return `p_${hash(`${inventoryId}::${normalizeUrl(url)}`)}`;
}

export interface ScanResult {
  page: Page;
  /** Variants seen for the first time. */
  newVariants: Variant[];
  /** Replaces every instance previously recorded for this page. */
  instances: Instance[];
  /** Variant ids present on this page, with the local ids of their candidates in scan order. */
  candidatesByVariant: Map<string, number[]>;
}

export function mergeScan(state: Pick<InventoryState, 'inventory' | 'variants'>, scan: PageScan): ScanResult {
  const inv = state.inventory;
  const url = normalizeUrl(scan.url);
  const page: Page = {
    id: pageId(inv.id, url),
    inventoryId: inv.id,
    url,
    routePattern: routePattern(url),
    title: scan.title,
    scannedAt: scan.scannedAt,
  };

  const known = new Map(state.variants.map((v) => [v.id, v]));
  const perLabel = new Map<string, number>();
  for (const v of state.variants) {
    const label = kindLabel(v.kind, v.subkind);
    perLabel.set(label, (perLabel.get(label) ?? 0) + 1);
  }

  const newVariants: Variant[] = [];
  const instances: Instance[] = [];
  const candidatesByVariant = new Map<string, number[]>();

  scan.candidates.forEach((c, i) => {
    const key = variantKey(c.kind, c.subkind, c.fingerprint);
    const id = variantId(inv.id, key);
    if (!known.has(id)) {
      const label = kindLabel(c.kind, c.subkind);
      const n = (perLabel.get(label) ?? 0) + 1;
      perLabel.set(label, n);
      const v: Variant = {
        id,
        inventoryId: inv.id,
        kind: c.kind,
        subkind: c.subkind,
        key,
        fingerprint: c.fingerprint,
        styleSummary: styleSummary(c.fingerprint.style),
        thumbnails: [],
        name: `${label} ${n}`,
        renamed: false,
        status: 'kept',
        mergedInto: null,
        nearDuplicateOf: [],
        notSameAs: [],
        createdAt: scan.scannedAt,
      };
      known.set(id, v);
      newVariants.push(v);
    }
    instances.push({
      id: `${page.id}:${i}`,
      inventoryId: inv.id,
      variantId: id,
      pageId: page.id,
      selectorPath: c.selectorPath,
      rect: c.rect,
      ...(c.fixtureKey ? { fixtureKey: c.fixtureKey } : {}),
    });
    const list = candidatesByVariant.get(id) ?? [];
    list.push(c.localId);
    candidatesByVariant.set(id, list);
  });

  return { page, newVariants, instances, candidatesByVariant };
}

/** Convenience for tests and the spike: apply a scan to an in-memory state. */
export function applyScan(state: InventoryState, scan: PageScan): InventoryState {
  const r = mergeScan(state, scan);
  return {
    inventory: state.inventory,
    pages: [...state.pages.filter((p) => p.id !== r.page.id), r.page],
    variants: [...state.variants, ...r.newVariants],
    instances: [...state.instances.filter((i) => i.pageId !== r.page.id), ...r.instances],
  };
}

export function emptyState(domain: string): InventoryState {
  return { inventory: newInventory(domain), pages: [], variants: [], instances: [] };
}
