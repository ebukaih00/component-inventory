import { test as base, chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import path from 'node:path';
// @ts-expect-error plain JS helper
import { serve } from '../../scripts/static-server.mjs';

const EXTENSION = path.resolve('dist-e2e');
const SITE = path.resolve('fixtures/site');

export const test = base.extend<{ context: BrowserContext; worker: Worker; extensionId: string; site: string }>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: true,
      viewport: { width: 1280, height: 800 },
      args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
    });
    await use(context);
    await context.close();
  },
  worker: async ({ context }, use) => {
    const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await use(sw);
  },
  extensionId: async ({ worker }, use) => use(new URL(worker.url()).host),
  // eslint-disable-next-line no-empty-pattern
  site: async ({}, use) => {
    const { server, port } = await serve(SITE);
    await use(`http://127.0.0.1:${port}`);
    server.close();
  },
});

export const expect = test.expect;

export async function tabIdOf(worker: Worker, url: string): Promise<number> {
  return worker.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url?.startsWith(u))!.id!, url);
}

/** Opens the side panel as a page, pinned to a tab. The panel opens on the Board; most tests want Auto-detect. */
export async function openPanel(context: BrowserContext, extensionId: string, tabId: number, view: 'board' | 'detect' = 'detect'): Promise<Page> {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html?tab=${tabId}`);
  await panel.getByTestId(`view-${view}`).click();
  return panel;
}
