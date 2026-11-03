/**
 * End to end: load the unpacked extension, browse the fixture site in record mode,
 * check the side panel and the JSON against the answer key.
 */
import { readFileSync } from 'node:fs';
import { expect, openPanel, tabIdOf, test } from './fixtures';

type KeyItem = { bucket?: 'common' | 'couldBeOne' | 'oneOff'; detected?: boolean; group?: string };
const key = JSON.parse(readFileSync('fixtures/answer-key.json', 'utf8')) as { pages: string[]; items: Record<string, KeyItem> };

interface Exported {
  summary: Record<string, number>;
  buckets: {
    common: { memberIds: string[]; thumbnails: string[] }[];
    couldBeOne: { id: string; variants: { memberIds: string[] }[] }[];
    oneOff: { memberIds: string[] }[];
  };
  instances: { variantId: string; fixtureKey?: string }[];
}

function bucketOf(e: Exported, variantId: string): string | undefined {
  if (e.buckets.common.some((r) => r.memberIds.includes(variantId))) return 'common';
  if (e.buckets.couldBeOne.some((g) => g.variants.some((r) => r.memberIds.includes(variantId)))) return 'couldBeOne';
  if (e.buckets.oneOff.some((r) => r.memberIds.includes(variantId))) return 'oneOff';
}

test('record mode inventories the fixture site and the JSON matches the answer key', async ({ context, worker, extensionId, site }) => {
  const app = await context.newPage();
  await app.goto(`${site}/index.html`);
  const tabId = await tabIdOf(worker, site);

  const panel = await openPanel(context, extensionId, tabId);
  await expect(panel.locator('.domain')).toHaveText('127.0.0.1');
  await expect(panel.getByText('Nothing inventoried on 127.0.0.1 yet.')).toBeVisible();
  await panel.getByTestId('start').click();
  await expect(panel.getByTestId('status')).toContainText('Recording');
  await expect(panel.getByTestId('summary')).toContainText('1 screen');

  // Browse normally: the site tab must be the active one so thumbnails can be captured.
  await app.bringToFront();
  for (const [i, name] of ['Projects', 'Settings', 'Billing'].entries()) {
    await app.getByRole('link', { name }).click();
    await app.waitForURL(`**/${name.toLowerCase()}.html`);
    await expect(panel.getByTestId('summary')).toContainText(`${i + 2} screens`, { timeout: 10_000 });
  }

  await expect(panel.getByTestId('summary')).toHaveText(/4 screens.*7 common.*2 could be one.*5 one-off/);
  await expect(panel.locator('[data-bucket="couldBeOne"] .chip')).toHaveText('radius 4 · 6 · 8');

  // JSON export
  const [download] = await Promise.all([panel.waitForEvent('download'), panel.getByTestId('download').click()]);
  const exported = JSON.parse(readFileSync((await download.path())!, 'utf8')) as Exported;
  expect(exported.summary).toMatchObject({ screens: 4, common: 7, couldBeOne: 2, oneOff: 5 });
  expect(exported.instances.filter((i) => !i.fixtureKey)).toEqual([]);
  for (const [k, item] of Object.entries(key.items)) {
    const ids = [...new Set(exported.instances.filter((i) => i.fixtureKey === k).map((i) => i.variantId))];
    if (item.detected === false) {
      expect(ids, k).toEqual([]);
      continue;
    }
    expect(ids, k).toHaveLength(1);
    expect(bucketOf(exported, ids[0]), k).toBe(item.bucket);
  }

  // Thumbnails were cropped from visible-tab screenshots.
  await expect.poll(async () => {
    const [d] = await Promise.all([panel.waitForEvent('download'), panel.getByTestId('download').click()]);
    const e = JSON.parse(readFileSync((await d.path())!, 'utf8')) as Exported;
    return e.buckets.common.filter((r) => r.thumbnails.length > 0).length;
  }, { timeout: 15_000 }).toBeGreaterThanOrEqual(5);
});

test('review: merge a could-be-one group, highlight on the page, ignore and restore', async ({ context, worker, extensionId, site }) => {
  const app = await context.newPage();
  await app.goto(`${site}/index.html`);
  const tabId = await tabIdOf(worker, site);
  const panel = await openPanel(context, extensionId, tabId);
  await panel.getByTestId('start').click();
  await expect(panel.getByTestId('status')).toContainText('Recording');
  for (const name of ['settings', 'billing']) {
    await app.goto(`${site}/${name}.html`);
    await expect(panel.getByTestId('summary')).toContainText(name === 'settings' ? '2 screens' : '3 screens');
  }
  const group = panel.locator('[data-bucket="couldBeOne"] .group');
  await expect(group.locator('.tile')).toHaveCount(3);

  // Merge: keep the radius-6 variant; the group becomes one Common component used on 3 screens.
  const tile = group.locator('.tile', { hasText: 'radius 6' });
  await tile.getByTestId('keep-this').click();
  await expect(panel.locator('[data-bucket="couldBeOne"] .group')).toHaveCount(0);
  const merged = panel.locator('[data-bucket="common"] .row', { hasText: '3 merged' });
  await expect(merged).toBeVisible();

  // Click a row: its instances are outlined on the live page.
  await merged.locator('.row-main').click();
  await expect(app.locator('#__component-inventory-overlay')).toHaveCount(1);

  // Ignore, then restore.
  await merged.getByTestId('ignore').click();
  await expect(panel.getByRole('button', { name: 'Show 1 ignored' })).toBeVisible();
  await panel.getByRole('button', { name: 'Show 1 ignored' }).click();
  await panel.locator('.ignored .row-main').click();
  await panel.getByRole('button', { name: 'Restore' }).click();
  await expect(panel.locator('[data-bucket="common"] .row', { hasText: '3 merged' })).toBeVisible();
});

test('manual scan works without record mode', async ({ context, worker, extensionId, site }) => {
  const app = await context.newPage();
  await app.goto(`${site}/projects.html`);
  const tabId = await tabIdOf(worker, site);
  const panel = await openPanel(context, extensionId, tabId);
  await panel.getByTestId('scan').click();
  await expect(panel.getByTestId('summary')).toHaveText(/1 screen.*0 common.*2 could be one.*2 one-off/);
  await expect(panel.getByTestId('status')).toContainText('Paused');
  await expect(panel.locator('[data-bucket="couldBeOne"] .row', { hasText: 'Card' })).toContainText('Repeated 4× on one screen');
});
