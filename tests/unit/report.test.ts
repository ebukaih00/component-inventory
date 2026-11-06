import { describe, expect, it } from 'vitest';
import { applyScan, buildExport, buildReport, emptyState, isInventoryExport, type InventoryState, type Variant } from '../../src/detect';
import { cand } from './helpers';

const scan = (url: string, candidates = [cand()]) => ({ url, title: url, scannedAt: 1, candidates });

function patch(state: InventoryState, id: string, p: Partial<Variant>): InventoryState {
  return { ...state, variants: state.variants.map((v) => (v.id === id ? { ...v, ...p } : v)) };
}

describe('mergeScan', () => {
  it('gives the same style the same variant across pages and names it', () => {
    let s = emptyState('app.test');
    s = applyScan(s, scan('https://app.test/a'));
    s = applyScan(s, scan('https://app.test/b'));
    expect(s.variants).toHaveLength(1);
    expect(s.variants[0].name).toBe('Button 1');
    expect(s.instances).toHaveLength(2);
  });

  it('replaces a page’s instances on rescan', () => {
    let s = emptyState('app.test');
    s = applyScan(s, scan('https://app.test/a', [cand(), cand()]));
    s = applyScan(s, scan('https://app.test/a#again', [cand()]));
    expect(s.pages).toHaveLength(1);
    expect(s.instances).toHaveLength(1);
  });

  it('numbers new variants per kind label', () => {
    let s = emptyState('app.test');
    s = applyScan(s, scan('https://app.test/a', [cand(), cand({ radius: 20 }), cand({}, 'input', 'text')]));
    expect(s.variants.map((v) => v.name)).toEqual(['Button 1', 'Button 2', 'Text input 1']);
  });
});

describe('buckets', () => {
  it('Reused means used twice, anywhere; once is a one-off', () => {
    let s = emptyState('app.test');
    s = applyScan(s, scan('https://app.test/projects/1'));
    let r = buildReport(s);
    expect(r.common).toHaveLength(0);
    expect(r.oneOff).toHaveLength(1);
    s = applyScan(s, scan('https://app.test/projects/2'));
    r = buildReport(s);
    expect(r.summary.screens).toBe(1); // two pages of one route
    expect(r.common).toHaveLength(1);
    expect(r.common[0].screens).toEqual(['/projects/:id']);
    s = applyScan(s, scan('https://app.test/settings'));
    r = buildReport(s);
    expect(r.common[0].screens).toEqual(['/projects/:id', '/settings']);
  });

  it('a component repeated on one screen is reused, not a near-duplicate', () => {
    const s = applyScan(emptyState('app.test'), scan('https://app.test/list', [cand(), cand(), cand()]));
    const r = buildReport(s);
    expect(r.common).toHaveLength(1);
    expect(r.common[0].uses).toBe(3);
    expect(r.couldBeOne).toHaveLength(0);
  });

  it('One-off shows the closest component', () => {
    let s = emptyState('app.test');
    s = applyScan(s, scan('https://app.test/a', [cand(), cand({ background: '#ffffffff', color: '#111111ff' })]));
    s = applyScan(s, scan('https://app.test/b', [cand(), cand({ background: '#ffffffff', color: '#111111ff' }), cand({ background: '#b91c1cff', radius: 0 })]));
    const r = buildReport(s);
    expect(r.oneOff).toHaveLength(1);
    expect(r.oneOff[0].closest?.name).toBe('Button 1');
    expect(r.oneOff[0].closest?.differences).toEqual(['radius', 'background']);
  });

  it('filters by kind', () => {
    let s = emptyState('app.test');
    s = applyScan(s, scan('https://app.test/a', [cand(), cand({}, 'badge')]));
    expect(buildReport(s, { kind: 'badge' }).oneOff.map((r) => r.kind)).toEqual(['badge']);
  });
});

describe('review actions', () => {
  const nearDupState = () => {
    let s = emptyState('app.test');
    s = applyScan(s, scan('https://app.test/a', [cand({ radius: 4 })]));
    s = applyScan(s, scan('https://app.test/b', [cand({ radius: 6 })]));
    return s;
  };

  it('groups near-duplicates into Could be one', () => {
    const r = buildReport(nearDupState());
    expect(r.couldBeOne).toHaveLength(1);
    expect(r.couldBeOne[0].diffs).toEqual([{ prop: 'radius', values: ['4', '6'] }]);
    expect(r.nearDuplicates[r.couldBeOne[0].variants[0].id]).toHaveLength(1);
  });

  it('merge folds instances into the target, which becomes Common', () => {
    let s = nearDupState();
    const [a, b] = s.variants;
    s = patch(s, b.id, { status: 'merged', mergedInto: a.id });
    const r = buildReport(s);
    expect(r.couldBeOne).toHaveLength(0);
    expect(r.common).toHaveLength(1);
    expect(r.common[0]).toMatchObject({ id: a.id, uses: 2, memberIds: [a.id, b.id] });
    expect(r.bucketOf[b.id]).toBe('common');
  });

  it('split ("not the same") breaks the group', () => {
    let s = nearDupState();
    const [a, b] = s.variants;
    s = patch(s, a.id, { notSameAs: [b.id] });
    const r = buildReport(s);
    expect(r.couldBeOne).toHaveLength(0);
    expect(r.oneOff).toHaveLength(2);
  });

  it('ignore removes a variant from the buckets', () => {
    let s = nearDupState();
    s = patch(s, s.variants[1].id, { status: 'ignored' });
    const r = buildReport(s);
    expect(r.ignored).toHaveLength(1);
    expect(r.couldBeOne).toHaveLength(0);
    expect(r.oneOff).toHaveLength(1);
  });

  it('rename shows up in the report and export', () => {
    let s = nearDupState();
    s = patch(s, s.variants[0].id, { name: 'Ghost button', renamed: true });
    const e = buildExport(s, new Date(0));
    expect(isInventoryExport(e)).toBe(true);
    expect(e.buckets.couldBeOne[0].variants.map((v) => v.name)).toContain('Ghost button');
    expect(e.variants.find((v) => v.name === 'Ghost button')?.nearDuplicateOf).toHaveLength(1);
    expect(e.pages.map((p) => p.url)).toEqual(['https://app.test/a', 'https://app.test/b']);
  });
});
