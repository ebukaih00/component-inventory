/**
 * Pure board model: what goes where in an exported inventory, grouped by bucket and kind.
 * The HTML report renders it. No DOM, no chrome.*, no URL.
 */
import type { InventoryExport } from '../detect/export';
import type { VariantRow } from '../detect/report';
import { BUCKETS, kindLabel, type BucketKey } from '../detect/labels';
import { KINDS } from '../detect/types';

export type { BucketKey };

export interface BoardRow {
  name: string;
  meta: string;
  /** Route patterns the variant appears on. */
  screens: string[];
  style: string;
  /** The same style as labelled parts, for rendering with swatches. */
  styleParts: { label: string; value: string }[];
  thumbnails: string[];
  note?: string;
}

export interface BoardItem {
  /** Group heading for "could be one" groups. */
  caption?: string;
  chips: string[];
  rows: BoardRow[];
}

export interface BoardKind {
  label: string;
  items: BoardItem[];
}

export interface BoardSection {
  bucket: BucketKey;
  title: string;
  hint: string;
  count: number;
  kinds: BoardKind[];
}

export interface Board {
  title: string;
  subtitle: string;
  sections: BoardSection[];
}

const screens = (r: VariantRow) => (r.screens.length === 1 ? r.screens[0] : `${r.screens.length} screens`);

function row(r: VariantRow, note?: string): BoardRow {
  const s = r.styleSummary;
  return {
    name: r.name,
    meta: `${r.uses} ${r.uses === 1 ? 'use' : 'uses'} · ${screens(r)}`,
    screens: r.screens,
    style: `${s.font} · padding ${s.padding} · radius ${s.radius} · bg ${s.background} · text ${s.color} · border ${s.border}`,
    styleParts: [
      { label: 'Font', value: s.font },
      { label: 'Padding', value: s.padding },
      { label: 'Radius', value: s.radius },
      { label: 'Background', value: s.background },
      { label: 'Text', value: s.color },
      { label: 'Border', value: s.border },
    ],
    thumbnails: r.thumbnails.slice(0, 3),
    ...(note ? { note } : {}),
  };
}

function byKind<T extends { kind: VariantRow['kind'] }>(items: T[], toItem: (x: T) => BoardItem): BoardKind[] {
  const out: BoardKind[] = [];
  for (const kind of KINDS) {
    const mine = items.filter((x) => x.kind === kind);
    if (mine.length === 0) continue;
    out.push({ label: kindLabel(kind, null), items: mine.map(toItem) });
  }
  return out;
}

export function buildBoard(e: InventoryExport): Board {
  const { buckets, summary } = e;
  return {
    title: `Component inventory · ${e.inventory.name}`,
    subtitle: `${summary.screens} screens · ${summary.pages} pages · ${summary.common} ${BUCKETS.common.legend} · ${summary.couldBeOne} ${BUCKETS.couldBeOne.legend} · ${summary.oneOff} ${BUCKETS.oneOff.legend} · exported ${e.exportedAt.slice(0, 10)}`,
    sections: [
      {
        bucket: 'common',
        title: BUCKETS.common.label,
        hint: BUCKETS.common.hint,
        count: buckets.common.length,
        kinds: byKind(buckets.common, (r) => ({ chips: [], rows: [row(r)] })),
      },
      {
        bucket: 'couldBeOne',
        title: BUCKETS.couldBeOne.label,
        hint: BUCKETS.couldBeOne.hint,
        count: buckets.couldBeOne.length,
        kinds: byKind(buckets.couldBeOne, (g) => ({
          caption: `${g.variants.length} variants, probably the same ${kindLabel(g.kind, g.subkind).toLowerCase()} · ${g.uses} uses`,
          chips: g.diffs.map((d) => `${d.prop} ${d.values.join(' · ')}`),
          rows: g.variants.map((v) => row(v)),
        })),
      },
      {
        bucket: 'oneOff',
        title: BUCKETS.oneOff.label,
        hint: BUCKETS.oneOff.hint,
        count: buckets.oneOff.length,
        kinds: byKind(buckets.oneOff, (r) => ({
          chips: [],
          rows: [row(r, r.closest ? `Closest: ${r.closest.name}${r.closest.differences.length ? ` · differs in ${r.closest.differences.join(', ')}` : ''}` : 'No similar component')],
        })),
      },
    ],
  };
}
