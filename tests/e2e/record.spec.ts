/**
 * End to end: load the unpacked extension, browse the fixture site in record mode,
 * check the side panel and the JSON against the answer key.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
// @ts-expect-error plain JS helper
import { serve } from '../../scripts/static-server.mjs';
import type { Page } from '@playwright/test';
import { expect, openPanel, tabIdOf, test } from './fixtures';

type KeyItem = { bucket?: 'common' | 'couldBeOne' | 'oneOff'; detected?: boolean; group?: string };
const key = JSON.parse(readFileSync('fixtures/answer-key.json', 'utf8')) as { pages: string[]; items: Record<string, KeyItem> };

interface Exported {
  summary: Record<string, number>;
  buckets: {
    common: { kind: string; memberIds: string[]; thumbnails: string[] }[];
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

/** Download JSON lives in the footer's More menu. */
async function downloadJson(panel: Page) {
  await panel.getByTestId('more').click();
  await panel.getByTestId('download').click();
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
  for (const [i, name] of ['Projects', 'Settings', 'Billing', 'Team'].entries()) {
    await app.getByRole('link', { name }).click();
    await app.waitForURL(`**/${name.toLowerCase()}.html`);
    await expect(panel.getByTestId('summary')).toContainText(`${i + 2} screens`, { timeout: 10_000 });
  }

  await expect(panel.getByTestId('summary')).toHaveText(/5 screens.*13 reused.*2 near-duplicates.*13 one-off/);
  await expect(panel.locator('[data-bucket="couldBeOne"] .chip')).toContainText(['height 16 · 20', 'radius 4 · 6 · 8']);

  // JSON export
  const [download] = await Promise.all([panel.waitForEvent('download'), downloadJson(panel)]);
  const exported = JSON.parse(readFileSync((await download.path())!, 'utf8')) as Exported;
  expect(exported.summary).toMatchObject({ screens: 5, common: 13, couldBeOne: 2, oneOff: 13 });
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
    const [d] = await Promise.all([panel.waitForEvent('download'), downloadJson(panel)]);
    const e = JSON.parse(readFileSync((await d.path())!, 'utf8')) as Exported;
    return e.buckets.common.filter((r) => r.thumbnails.length > 0).length;
  }, { timeout: 15_000 }).toBeGreaterThanOrEqual(5);

  // HTML report: self-contained, opens offline, same counts as the panel.
  const [saved] = await Promise.all([panel.waitForEvent('download'), panel.getByTestId('save-report').click()]);
  expect(saved.suggestedFilename()).toMatch(/^inventory-127\.0\.0\.1-\d{4}-\d{2}-\d{2}\.html$/);
  const report = await context.newPage();
  const requests: string[] = [];
  report.on('request', (r) => { if (!r.url().startsWith('data:') && !r.url().startsWith('file:')) requests.push(r.url()); });
  const reportPath = test.info().outputPath(saved.suggestedFilename());
  await saved.saveAs(reportPath);
  await report.goto(pathToFileURL(reportPath).href);
  await expect(report.locator('h1')).toHaveText('127.0.0.1');
  await expect(report.getByTestId('summary')).toHaveText(/5 screens.*13 reused.*2 near-duplicates.*13 one-off/);
  await expect(report.locator('h2')).toContainText(['Reused', 'Near-duplicates', 'One-off', 'Pages scanned']);
  await expect(report.locator('#couldBeOne .chip')).toContainText(['radius 4 · 6 · 8', 'height 16 · 20']); // grouped by kind
  expect(await report.locator('#common .thumb img').count()).toBeGreaterThanOrEqual(5);
  expect(requests).toEqual([]);
  await report.close();
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

  // Merge: keep the radius-6 variant; the group becomes one reused component used on 3 screens.
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
  await expect(panel.getByTestId('summary')).toHaveText(/1 screen.*2 reused.*0 near-duplicates.*2 one-off/);
  await expect(panel.getByTestId('status')).toContainText('Paused');
  await expect(panel.locator('[data-bucket="common"] .row', { hasText: 'Card' })).toContainText('4 uses');

  // Collapsed buckets stay collapsed when the panel is reopened.
  const oneOffHeader = panel.locator('[data-bucket="oneOff"] .bucket-header');
  await oneOffHeader.click();
  await expect(oneOffHeader).toHaveAttribute('aria-expanded', 'false');
  await panel.reload();
  await expect(panel.locator('[data-bucket="oneOff"] .bucket-header')).toHaveAttribute('aria-expanded', 'false');
});

test('record mode scans single-page-app navigations even when the DOM never goes quiet', async ({ context, worker, extensionId }) => {
  const { server, port } = await serve(path.resolve('fixtures/spa'));
  try {
    const origin = `http://127.0.0.1:${port}`;
    const app = await context.newPage();
    await app.goto(`${origin}/index.html`);
    const tabId = await tabIdOf(worker, origin);
    const panel = await openPanel(context, extensionId, tabId);
    await panel.getByTestId('start').click();
    await expect(panel.getByTestId('summary')).toContainText('1 page scanned');

    await app.bringToFront();
    await app.getByRole('link', { name: 'View B' }).click();
    await expect(app).toHaveURL(`${origin}/b`);
    await expect(panel.getByTestId('summary')).toContainText('2 pages scanned', { timeout: 8_000 });

    await app.getByRole('link', { name: 'View A' }).click();
    await expect(panel.getByTestId('summary')).toContainText('3 pages scanned', { timeout: 8_000 });
  } finally {
    server.close();
  }
});

test('Scan this page previews components taller than the window from their top part', async ({ context, worker, extensionId }) => {
  const { server, port } = await serve(path.resolve('fixtures/tall'));
  try {
    const origin = `http://127.0.0.1:${port}`;
    const app = await context.newPage();
    await app.goto(`${origin}/index.html`);
    const tabId = await tabIdOf(worker, origin);
    const panel = await openPanel(context, extensionId, tabId);
    await app.bringToFront();
    await panel.getByTestId('scan').click();
    await expect(panel.locator('[data-bucket="common"] .row', { hasText: 'Card' })).toContainText('2 uses');
    await expect.poll(async () => {
      const [d] = await Promise.all([panel.waitForEvent('download'), downloadJson(panel)]);
      const e = JSON.parse(readFileSync((await d.path())!, 'utf8')) as Exported;
      return e.buckets.common.find((r) => r.kind === 'card')?.thumbnails.length ?? 0;
    }, { timeout: 15_000 }).toBeGreaterThan(0);
  } finally {
    server.close();
  }
});

test('Add element: pick something the detector missed, and everything like it is inventoried', async ({ context, worker, extensionId, site }) => {
  const app = await context.newPage();
  await app.goto(`${site}/index.html`);
  const tabId = await tabIdOf(worker, site);
  const panel = await openPanel(context, extensionId, tabId);
  await panel.getByTestId('scan').click();
  await expect(panel.getByTestId('summary')).toContainText('1 page scanned');
  await expect(panel.locator('.row', { hasText: 'Card' })).toHaveCount(0); // the stat tiles aren't found

  await panel.getByTestId('pick').click();
  await expect(panel.getByTestId('picking')).toBeVisible();
  await app.bringToFront();
  await app.locator('.stat-label').first().hover(); // lands on the label…
  await app.keyboard.press('ArrowUp'); // …so go up to the tile
  await app.mouse.down();
  await app.mouse.up();

  const sheet = panel.getByTestId('pick-sheet');
  await expect(sheet).toContainText('div.stat');
  await panel.getByTestId('pick-kind').selectOption('card');
  await expect(sheet.getByRole('radio', { name: /Everything that looks like this/ })).toBeChecked();
  await panel.getByTestId('pick-add').click();

  // Both tiles are now one reused card.
  await expect(panel.locator('[data-bucket="common"] .row', { hasText: 'Card' })).toContainText('2 uses');
  const [d] = await Promise.all([panel.waitForEvent('download'), downloadJson(panel)]);
  const e = JSON.parse(readFileSync((await d.path())!, 'utf8')) as Exported;
  const tiles = e.instances.filter((i) => i.fixtureKey === 'stat-tile');
  expect(tiles).toHaveLength(2);
  expect(new Set(tiles.map((i) => i.variantId)).size).toBe(1);
});
