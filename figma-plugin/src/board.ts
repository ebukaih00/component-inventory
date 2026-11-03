/** Pure board model: what goes where. code.ts turns it into Figma nodes. */
import type { InventoryExport } from '../../src/detect/export';
import type { VariantRow } from '../../src/detect/report';
import { kindLabel } from '../../src/detect/labels';
import { KINDS } from '../../src/detect/types';

export type BucketKey = 'common' | 'couldBeOne' | 'oneOff';

export interface BoardRow {
  name: string;
  meta: string;
  style: string;
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
    style: `${s.font} · padding ${s.padding} · radius ${s.radius} · bg ${s.background} · text ${s.color} · border ${s.border}`,
    thumbnails: r.thumbnails.slice(0, 3),
    ...(note ? { note } : {}),
  };
}

function byKind<T extends { kind: VariantRow['kind']; subkind: VariantRow['subkind'] }>(items: T[], toItem: (x: T) => BoardItem): BoardKind[] {
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
    subtitle: `${summary.screens} screens · ${summary.pages} pages · ${summary.common} common · ${summary.couldBeOne} could be one · ${summary.oneOff} one-off · exported ${e.exportedAt.slice(0, 10)}`,
    sections: [
      {
        bucket: 'common',
        title: 'Common',
        hint: 'The same variant on 2 or more screens. Document as system components.',
        count: buckets.common.length,
        kinds: byKind(buckets.common, (r) => ({ chips: [], rows: [row(r)] })),
      },
      {
        bucket: 'couldBeOne',
        title: 'Could be one',
        hint: 'Near-duplicates, or a pattern repeated on one screen. Consolidate into one component with variants.',
        count: buckets.couldBeOne.length,
        kinds: byKind(buckets.couldBeOne, (g) => ({
          caption:
            g.reason === 'near-duplicates'
              ? `${g.variants.length} variants, probably the same ${kindLabel(g.kind, g.subkind).toLowerCase()} · ${g.uses} uses`
              : `Repeated ${g.variants[0].maxPerPage}× on one screen`,
          chips: g.diffs.map((d) => `${d.prop} ${d.values.join(' · ')}`),
          rows: g.variants.map((v) => row(v)),
        })),
      },
      {
        bucket: 'oneOff',
        title: 'One-off',
        hint: 'Appears once. Replace with the closest match, or keep as bespoke.',
        count: buckets.oneOff.length,
        kinds: byKind(buckets.oneOff, (r) => ({
          chips: [],
          rows: [row(r, r.closest ? `Closest: ${r.closest.name}${r.closest.differences.length ? ` · differs in ${r.closest.differences.join(', ')}` : ''}` : 'No similar component')],
        })),
      },
    ],
  };
}
