// Records what the real DOM collector picks on each fixture page, in a real browser,
// so the unit tests can check the pure grouping against the answer key without a browser.
// Run: npm run fixtures:snapshot
import { chromium } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { serve } from './static-server.mjs';

const root = new URL('../fixtures/site/', import.meta.url).pathname;
const out = new URL('../tests/snapshots/', import.meta.url).pathname;
const key = JSON.parse(await readFile(new URL('../fixtures/answer-key.json', import.meta.url)));
const spike = await readFile(new URL('../dist-spike/inventory-spike.js', import.meta.url), 'utf8');

const { server, port } = await serve(root);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await mkdir(out, { recursive: true });
for (const name of key.pages) {
  // Fixed host so route patterns and variant ids are stable across runs.
  await page.goto(`http://127.0.0.1:${port}/${name}`);
  await page.addScriptTag({ content: spike });
  const candidates = await page.evaluate(() => window.__ci.collect());
  const title = await page.title();
  const snapshot = { url: `http://fixture.test/${name}`, title, candidates };
  await writeFile(`${out}${name.replace('.html', '')}.json`, JSON.stringify(snapshot, null, 2) + '\n');
  console.log(`${name}: ${candidates.length} candidates`);
}
await browser.close();
server.close();
