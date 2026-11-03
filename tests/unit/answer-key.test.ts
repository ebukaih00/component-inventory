/**
 * The fixture site's answer key, checked against the pure pipeline.
 * Snapshots come from the real DOM collector in Chromium (npm run fixtures:snapshot).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { applyScan, buildReport, emptyState, type Bucket, type InventoryState, type PageScan } from '../../src/detect';

type KeyItem = { kind?: string; bucket?: Bucket; group?: string; instances?: number; closest?: string; detected?: boolean };
const key = JSON.parse(readFileSync(new URL('../../fixtures/answer-key.json', import.meta.url), 'utf8')) as {
  pages: string[];
  items: Record<string, KeyItem>;
};

function loadState(): InventoryState {
  let state = emptyState('fixture.test');
  for (const name of key.pages) {
    const snap = JSON.parse(readFileSync(new URL(`../snapshots/${name.replace('.html', '')}.json`, import.meta.url), 'utf8'));
    state = applyScan(state, { ...snap, scannedAt: 1 } as PageScan);
  }
  return state;
}

const state = loadState();
const report = buildReport(state);
const instancesOf = (k: string) => state.instances.filter((i) => i.fixtureKey === k);
const variantsOf = (k: string) => [...new Set(instancesOf(k).map((i) => i.variantId))];
const groupOf = (variantId: string) => report.couldBeOne.find((g) => g.variants.some((v) => v.memberIds.includes(variantId)));

describe('fixture answer key', () => {
  it('has no false positives: every detection is a planted component', () => {
    const unkeyed = state.instances.filter((i) => !i.fixtureKey);
    expect(unkeyed.map((i) => i.selectorPath)).toEqual([]);
  });

  for (const [k, item] of Object.entries(key.items)) {
    if (item.detected === false) {
      it(`${k} is not detected`, () => expect(instancesOf(k)).toHaveLength(0));
      continue;
    }
    it(`${k} → ${item.kind} in ${item.bucket}`, () => {
      const ids = variantsOf(k);
      expect(ids.length, 'every instance of a key is one variant').toBe(1);
      const v = state.variants.find((x) => x.id === ids[0])!;
      expect(v.kind).toBe(item.kind);
      expect(report.bucketOf[v.id]).toBe(item.bucket);
      if (item.instances) expect(instancesOf(k)).toHaveLength(item.instances);
      if (item.closest) {
        const row = report.oneOff.find((r) => r.id === v.id)!;
        expect(row.closest?.id).toBe(variantsOf(item.closest)[0]);
      }
    });
  }

  it('groups near-duplicates together and only them', () => {
    const groups = new Map<string, string[]>();
    for (const [k, item] of Object.entries(key.items)) if (item.group) groups.set(item.group, [...(groups.get(item.group) ?? []), k]);
    for (const keys of groups.values()) {
      const ids = keys.map((k) => groupOf(variantsOf(k)[0])?.id);
      expect(new Set(ids).size).toBe(1);
      const g = report.couldBeOne.find((x) => x.id === ids[0])!;
      expect(g.reason).toBe('near-duplicates');
      expect(g.variants).toHaveLength(keys.length);
      expect(g.diffs).toEqual([{ prop: 'radius', values: ['4', '6', '8'] }]);
    }
  });

  it('summarises screens and buckets', () => {
    expect(report.summary).toMatchObject({ screens: 4, pages: 4, common: 7, couldBeOne: 2, oneOff: 5 });
  });
});
