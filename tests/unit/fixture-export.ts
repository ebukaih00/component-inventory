import { readFileSync } from 'node:fs';
import { applyScan, buildExport, emptyState, type PageScan } from '../../src/detect';

/** The export of the fixture pages (answer-key order), built from the real-browser snapshots. */
export function fixtureExport() {
  let s = emptyState('fixture.test');
  const key = JSON.parse(readFileSync(new URL('../../fixtures/answer-key.json', import.meta.url), 'utf8')) as { pages: string[] };
  for (const n of key.pages.map((p) => p.replace('.html', ''))) {
    const snap = JSON.parse(readFileSync(new URL(`../snapshots/${n}.json`, import.meta.url), 'utf8'));
    s = applyScan(s, { ...snap, scannedAt: 1 } as PageScan);
  }
  return buildExport(s, new Date('2026-11-03T00:00:00Z'));
}
