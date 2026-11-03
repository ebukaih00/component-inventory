import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { applyScan, buildExport, emptyState, type PageScan } from '../../src/detect';
import { buildBoard } from '../../figma-plugin/src/board';

function fixtureExport() {
  let s = emptyState('fixture.test');
  for (const n of ['index', 'projects', 'settings', 'billing']) {
    const snap = JSON.parse(readFileSync(new URL(`../snapshots/${n}.json`, import.meta.url), 'utf8'));
    s = applyScan(s, { ...snap, scannedAt: 1 } as PageScan);
  }
  return buildExport(s, new Date('2026-11-03T00:00:00Z'));
}

describe('Figma board model', () => {
  const board = buildBoard(fixtureExport());

  it('has one section per bucket with counts', () => {
    expect(board.sections.map((s) => [s.title, s.count])).toEqual([['Common', 7], ['Could be one', 2], ['One-off', 5]]);
    expect(board.subtitle).toContain('4 screens');
  });

  it('groups rows by kind and shows near-duplicate differences', () => {
    const could = board.sections[1];
    const buttons = could.kinds.find((k) => k.label === 'Button')!;
    expect(buttons.items[0].chips).toEqual(['radius 4 · 6 · 8']);
    expect(buttons.items[0].rows).toHaveLength(3);
    expect(could.kinds.find((k) => k.label === 'Card')!.items[0].caption).toBe('Repeated 4× on one screen');
  });

  it('names the closest component for one-offs', () => {
    const notes = board.sections[2].kinds.flatMap((k) => k.items.flatMap((i) => i.rows.map((r) => r.note)));
    expect(notes.some((n) => n?.startsWith('Closest: Button 1'))).toBe(true);
    expect(notes).toContain('No similar component'); // the only table
  });
});
