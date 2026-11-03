import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildReport } from '../../src/detect';
import {
  addThumbnail, db, ensureInventory, exportInventory, loadState, mergeVariants, recordScan, renameVariant,
  resetDbConnection, setIgnored, setRecording, splitFromGroup, thumbsNeeded, unmergeInto, deleteInventory,
} from '../../src/storage/db';
import { cand } from './helpers';

const scan = (url: string, candidates = [cand()]) => ({ url, title: url, scannedAt: 1, candidates });
const INV = 'inv_app.test';

beforeEach(async () => {
  (await db()).close();
  indexedDB.deleteDatabase('component-inventory');
  resetDbConnection();
});

describe('storage', () => {
  it('records scans, replacing a page’s instances on rescan', async () => {
    await recordScan('app.test', scan('https://app.test/a', [cand(), cand()]));
    await recordScan('app.test', scan('https://app.test/a', [cand()]));
    await recordScan('app.test', scan('https://app.test/b', [cand({ radius: 4 })]));
    const s = (await loadState(INV))!;
    expect(s.pages).toHaveLength(2);
    expect(s.instances).toHaveLength(2);
    expect(s.variants).toHaveLength(2);
  });

  it('keeps user edits when the same variant is scanned again', async () => {
    const { result } = await recordScan('app.test', scan('https://app.test/a'));
    const id = result.newVariants[0].id;
    await renameVariant(id, 'Primary button');
    await recordScan('app.test', scan('https://app.test/b'));
    expect((await loadState(INV))!.variants[0].name).toBe('Primary button');
  });

  it('collects up to 3 thumbnails without duplicates', async () => {
    const { result, needThumbs } = await recordScan('app.test', scan('https://app.test/a'));
    const id = result.newVariants[0].id;
    expect(needThumbs[id]).toEqual({ need: 3, sources: [] });
    expect(await addThumbnail(id, 'data:a', 'a|x')).toBe(true);
    expect(await addThumbnail(id, 'data:a', 'a|x')).toBe(false);
    await addThumbnail(id, 'data:b', 'b|x');
    await addThumbnail(id, 'data:c', 'c|x');
    expect(await addThumbnail(id, 'data:d', 'd|x')).toBe(false);
    expect(await thumbsNeeded([id])).toEqual({});
  });

  it('merge, unmerge, split and ignore', async () => {
    await recordScan('app.test', scan('https://app.test/a', [cand({ radius: 4 })]));
    await recordScan('app.test', scan('https://app.test/b', [cand({ radius: 6 })]));
    const [a, b] = (await loadState(INV))!.variants.map((v) => v.id);
    const report = async () => buildReport((await loadState(INV))!);

    expect((await report()).couldBeOne).toHaveLength(1);
    await mergeVariants(a, [a, b]);
    expect((await report()).common[0].memberIds.sort()).toEqual([a, b].sort());
    await unmergeInto(a, [a, b]);
    expect((await report()).couldBeOne).toHaveLength(1);
    await splitFromGroup(b, [a, b]);
    expect((await report()).oneOff).toHaveLength(2);
    await setIgnored([b], true);
    expect((await report()).ignored).toHaveLength(1);
  });

  it('tracks recording, exports and deletes', async () => {
    await ensureInventory('app.test');
    expect((await setRecording('app.test', true)).recording).toBe(true);
    await recordScan('app.test', scan('https://app.test/a'));
    expect((await exportInventory(INV))?.summary.pages).toBe(1);
    await deleteInventory(INV);
    expect(await loadState(INV)).toBeNull();
    expect(await (await db()).count('variants')).toBe(0);
  });
});
