import { describe, expect, it } from 'vitest';
import { buildBoard } from '../../src/export/board';
import { fixtureExport } from './fixture-export';

describe('board model', () => {
  const board = buildBoard(fixtureExport());

  it('has one section per bucket with counts', () => {
    expect(board.sections.map((s) => [s.title, s.count])).toEqual([['Reused', 13], ['Near-duplicates', 2], ['One-off', 13]]);
    expect(board.subtitle).toContain('5 screens');
  });

  it('groups rows by kind and shows near-duplicate differences', () => {
    const could = board.sections[1];
    const buttons = could.kinds.find((k) => k.label === 'Button')!;
    expect(buttons.items[0].chips).toEqual(['radius 4 · 6 · 8']);
    expect(buttons.items[0].rows).toHaveLength(3);
    expect(could.kinds.map((k) => k.label)).toEqual(['Button', 'Icon']);
    expect(could.kinds[1].items[0].chips).toEqual(['height 16 · 20']);
  });

  it('names the closest component for one-offs', () => {
    const notes = board.sections[2].kinds.flatMap((k) => k.items.flatMap((i) => i.rows.map((r) => r.note)));
    expect(notes.some((n) => n?.startsWith('Closest: Button 1'))).toBe(true);
    expect(notes).toContain('No similar component'); // the only table
  });

  it('lists the screens of reused rows', () => {
    const rows = board.sections[0].kinds.flatMap((k) => k.items.flatMap((i) => i.rows));
    expect(rows.find((r) => r.name.startsWith('Card'))!.screens).toEqual(['/projects.html']);
    expect(rows.find((r) => r.name.startsWith('Navigation'))!.screens).toHaveLength(5);
  });
});
