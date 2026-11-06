/**
 * JSON export of an inventory (Download JSON in the side panel).
 */
import { buildReport, type CouldBeOneGroup, type OneOffRow, type Report, type VariantRow } from './report';
import type { InventoryState, Kind, Rect, StyleSummary, Subkind, VariantStatus } from './types';

export const EXPORT_SCHEMA = 'component-inventory/1';

export interface ExportVariant {
  id: string;
  kind: Kind;
  subkind: Subkind;
  name: string;
  status: VariantStatus;
  mergedInto: string | null;
  nearDuplicateOf: string[];
  styleSummary: StyleSummary;
  thumbnails: string[];
}

export interface InventoryExport {
  schema: typeof EXPORT_SCHEMA;
  exportedAt: string;
  inventory: { id: string; name: string; domain: string };
  summary: Report['summary'];
  pages: { url: string; routePattern: string; title: string; scannedAt: string }[];
  buckets: {
    common: VariantRow[];
    couldBeOne: CouldBeOneGroup[];
    oneOff: OneOffRow[];
  };
  variants: ExportVariant[];
  instances: { variantId: string; page: string; selectorPath: string; rect: Rect; fixtureKey?: string }[];
}

export function buildExport(state: InventoryState, now = new Date()): InventoryExport {
  const report = buildReport(state);
  const pageUrl = new Map(state.pages.map((p) => [p.id, p.url]));
  return {
    schema: EXPORT_SCHEMA,
    exportedAt: now.toISOString(),
    inventory: { id: state.inventory.id, name: state.inventory.name, domain: state.inventory.domain },
    summary: report.summary,
    pages: state.pages
      .map((p) => ({ url: p.url, routePattern: p.routePattern, title: p.title, scannedAt: new Date(p.scannedAt).toISOString() }))
      .sort((a, b) => a.url.localeCompare(b.url)),
    buckets: { common: report.common, couldBeOne: report.couldBeOne, oneOff: report.oneOff },
    variants: state.variants.map((v) => ({
      id: v.id,
      kind: v.kind,
      subkind: v.subkind,
      name: v.name,
      status: v.status,
      mergedInto: v.mergedInto,
      nearDuplicateOf: report.nearDuplicates[v.id] ?? [],
      styleSummary: v.styleSummary,
      thumbnails: v.thumbnails,
    })),
    instances: state.instances.map((i) => ({
      variantId: i.variantId,
      page: pageUrl.get(i.pageId) ?? '',
      selectorPath: i.selectorPath,
      rect: i.rect,
      ...(i.fixtureKey ? { fixtureKey: i.fixtureKey } : {}),
    })),
  };
}

export function isInventoryExport(x: unknown): x is InventoryExport {
  return typeof x === 'object' && x !== null && (x as { schema?: unknown }).schema === EXPORT_SCHEMA;
}
