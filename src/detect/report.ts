/**
 * The three buckets. Pure function of the stored inventory.
 *
 *   Reused (common)              — a variant used 2+ times, anywhere
 *   Near-duplicates (couldBeOne) — variants that look almost the same; merge candidates
 *   One-off (oneOff)             — used once; shows the closest existing component
 * Labels and explanations live in labels.ts.
 */
import { DIFF_PROPS, distance, compare, isNearDuplicate, propValue, type DiffProp } from './distance';
import { hash } from './hash';
import { DEFAULT_THRESHOLDS, type Thresholds } from './thresholds';
import type { InventoryState, Kind, StyleSummary, Subkind, Variant } from './types';

export type Bucket = 'common' | 'couldBeOne' | 'oneOff';

export interface VariantRow {
  id: string;
  kind: Kind;
  subkind: Subkind;
  name: string;
  uses: number;
  /** Page URLs it appears on. */
  pages: string[];
  /** Distinct route patterns it appears on. */
  screens: string[];
  maxPerPage: number;
  thumbnails: string[];
  styleSummary: StyleSummary;
  /** This variant plus any merged into it. */
  memberIds: string[];
}

export interface PropValues {
  prop: DiffProp;
  values: string[];
}

export interface CouldBeOneGroup {
  id: string;
  kind: Kind;
  subkind: Subkind;
  reason: 'near-duplicates';
  variants: VariantRow[];
  diffs: PropValues[];
  uses: number;
}

export interface OneOffRow extends VariantRow {
  closest: { id: string; name: string; differences: DiffProp[] } | null;
}

export interface Report {
  summary: { screens: number; pages: number; common: number; couldBeOne: number; oneOff: number; ignored: number };
  common: VariantRow[];
  couldBeOne: CouldBeOneGroup[];
  oneOff: OneOffRow[];
  ignored: VariantRow[];
  /** Variant id → ids it is probably the same as (after merges, before user splits). */
  nearDuplicates: Record<string, string[]>;
  /** Variant id (including merged ones) → bucket of the row it ends up in. */
  bucketOf: Record<string, Bucket>;
}

export interface ReportOptions {
  kind?: Kind | null;
  thresholds?: Thresholds;
}

/** Follow mergedInto links to the variant that represents this one. */
export function resolveVariant(id: string, byId: Map<string, Variant>): string {
  const seen = new Set<string>();
  let cur = id;
  for (;;) {
    const v = byId.get(cur);
    if (!v || v.status !== 'merged' || !v.mergedInto || seen.has(cur)) return cur;
    seen.add(cur);
    cur = v.mergedInto;
  }
}

class UnionFind {
  private parent = new Map<string, string>();
  find(x: string): string {
    let p = this.parent.get(x) ?? x;
    if (p !== x) {
      p = this.find(p);
      this.parent.set(x, p);
    }
    return p;
  }
  union(a: string, b: string) {
    const ra = this.find(a), rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

const byUses = (a: { uses: number; name: string }, b: { uses: number; name: string }) =>
  b.uses - a.uses || a.name.localeCompare(b.name);

export function buildReport(state: InventoryState, opts: ReportOptions = {}): Report {
  const t = opts.thresholds ?? DEFAULT_THRESHOLDS;
  const byId = new Map(state.variants.map((v) => [v.id, v]));
  const pageById = new Map(state.pages.map((p) => [p.id, p]));

  // Aggregate instances onto representative variants.
  const members = new Map<string, string[]>();
  for (const v of state.variants) {
    const rep = resolveVariant(v.id, byId);
    members.set(rep, [...(members.get(rep) ?? []), v.id]);
  }
  const agg = new Map<string, { uses: number; pages: Set<string>; screens: Set<string>; perPage: Map<string, number> }>();
  for (const inst of state.instances) {
    const rep = resolveVariant(inst.variantId, byId);
    const page = pageById.get(inst.pageId);
    if (!page) continue;
    const a = agg.get(rep) ?? { uses: 0, pages: new Set(), screens: new Set(), perPage: new Map() };
    a.uses++;
    a.pages.add(page.url);
    a.screens.add(page.routePattern);
    a.perPage.set(page.id, (a.perPage.get(page.id) ?? 0) + 1);
    agg.set(rep, a);
  }

  const row = (v: Variant): VariantRow => {
    const a = agg.get(v.id);
    const ids = members.get(v.id) ?? [v.id];
    const thumbs = ids.flatMap((id) => byId.get(id)?.thumbnails ?? []);
    return {
      id: v.id,
      kind: v.kind,
      subkind: v.subkind,
      name: v.name,
      uses: a?.uses ?? 0,
      pages: [...(a?.pages ?? [])].sort(),
      screens: [...(a?.screens ?? [])].sort(),
      maxPerPage: a ? Math.max(...a.perPage.values()) : 0,
      thumbnails: [...v.thumbnails, ...thumbs.filter((x) => !v.thumbnails.includes(x))].slice(0, 3),
      styleSummary: v.styleSummary,
      memberIds: ids,
    };
  };

  const reps = state.variants.filter(
    (v) => v.status !== 'merged' && agg.has(v.id) && (!opts.kind || v.kind === opts.kind),
  );
  const active = reps.filter((v) => v.status !== 'ignored');
  const ignored = reps.filter((v) => v.status === 'ignored').map(row).sort(byUses);

  // Near-duplicate graph, per kind + subkind.
  const uf = new UnionFind();
  const nearDuplicates: Record<string, string[]> = {};
  const blocked = (a: Variant, b: Variant) => a.notSameAs.includes(b.id) || b.notSameAs.includes(a.id);
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i], b = active[j];
      if (a.kind !== b.kind || a.subkind !== b.subkind) continue;
      if (!isNearDuplicate(a, b, t)) continue;
      (nearDuplicates[a.id] ??= []).push(b.id);
      (nearDuplicates[b.id] ??= []).push(a.id);
      if (!blocked(a, b)) uf.union(a.id, b.id);
    }
  }
  const clusters = new Map<string, Variant[]>();
  for (const v of active) {
    const root = uf.find(v.id);
    clusters.set(root, [...(clusters.get(root) ?? []), v]);
  }

  const common: VariantRow[] = [];
  const couldBeOne: CouldBeOneGroup[] = [];
  const oneOffVariants: Variant[] = [];

  for (const cluster of clusters.values()) {
    if (cluster.length > 1) {
      const rows = cluster.map(row).sort(byUses);
      const diffs: PropValues[] = [];
      for (const prop of DIFF_PROPS) {
        const values = [...new Set(cluster.map((v) => propValue(prop, v.fingerprint.style, v.fingerprint.structure)))];
        if (values.length > 1) diffs.push({ prop, values: sortValues(values) });
      }
      // Only report props that really differ between some pair (e.g. height is ignored for cards).
      const real = new Set(cluster.flatMap((a) => cluster.flatMap((b) => (a === b ? [] : compare(a, b, t).map((d) => d.prop)))));
      couldBeOne.push({
        id: `g_${hash(cluster.map((v) => v.id).sort().join(','))}`,
        kind: cluster[0].kind,
        subkind: cluster[0].subkind,
        reason: 'near-duplicates',
        variants: rows,
        diffs: diffs.filter((d) => real.has(d.prop)),
        uses: rows.reduce((s, r) => s + r.uses, 0),
      });
      continue;
    }
    const v = cluster[0];
    const r = row(v);
    if (r.uses >= 2) common.push(r);
    else oneOffVariants.push(v);
  }

  // Closest existing component for each one-off: prefer variants that are not one-offs themselves.
  const oneOffIds = new Set(oneOffVariants.map((v) => v.id));
  const oneOff: OneOffRow[] = oneOffVariants.map((v) => {
    let best: { v: Variant; d: number } | null = null;
    for (const other of active) {
      if (other.id === v.id) continue;
      const d = distance(v, other, t) + (oneOffIds.has(other.id) ? 100 : 0);
      if (d < (best?.d ?? Infinity)) best = { v: other, d };
    }
    return {
      ...row(v),
      closest: best
        ? { id: best.v.id, name: best.v.name, differences: compare(v, best.v, t).map((d) => d.prop) }
        : null,
    };
  });

  common.sort(byUses);
  couldBeOne.sort((a, b) => b.uses - a.uses || a.variants[0].name.localeCompare(b.variants[0].name));
  oneOff.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));

  const bucketOf: Record<string, Bucket> = {};
  const mark = (r: VariantRow, b: Bucket) => r.memberIds.forEach((id) => (bucketOf[id] = b));
  common.forEach((r) => mark(r, 'common'));
  couldBeOne.forEach((g) => g.variants.forEach((r) => mark(r, 'couldBeOne')));
  oneOff.forEach((r) => mark(r, 'oneOff'));

  return {
    summary: {
      screens: new Set(state.pages.map((p) => p.routePattern)).size,
      pages: state.pages.length,
      common: common.length,
      couldBeOne: couldBeOne.length,
      oneOff: oneOff.length,
      ignored: ignored.length,
    },
    common,
    couldBeOne,
    oneOff,
    ignored,
    nearDuplicates,
    bucketOf,
  };
}

function sortValues(values: string[]): string[] {
  const nums = values.map(Number);
  if (nums.every((n) => !Number.isNaN(n))) return values.sort((a, b) => Number(a) - Number(b));
  return values.sort();
}
