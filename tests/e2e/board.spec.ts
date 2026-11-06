/**
 * The board: collect components by clicking them, group them, and let Find similar count them and
 * pick up versions that look different on other pages.
 */
import { readFileSync } from 'node:fs';
import { expect, openPanel, tabIdOf, test } from './fixtures';

test('collect, group, find similar on another page, and save the board report', async ({ context, worker, extensionId, site }) => {
  const app = await context.newPage();
  await app.goto(`${site}/index.html`);
  const tabId = await tabIdOf(worker, site);
  const panel = await openPanel(context, extensionId, tabId, 'board');
  await expect(panel.getByText('Collect the components you see')).toBeVisible();

  // Collect the ghost "Filter" button: it lands in Unsorted, with a preview.
  await panel.getByTestId('collect').click();
  await expect(panel.getByTestId('status')).toHaveText('Collecting');
  await app.bringToFront();
  await app.getByRole('button', { name: 'Filter' }).click();
  const unsorted = panel.getByTestId('unsorted');
  await expect(unsorted.getByTestId('tile')).toHaveCount(1);
  await expect(unsorted.getByTestId('tile').locator('img')).toHaveCount(1);

  // Make a group and send new picks there; move the first one in too.
  await panel.getByTestId('add-to').selectOption('__new');
  await panel.getByTestId('group-name').fill('Ghost button');
  await panel.getByTestId('group-create').click();
  await expect(panel.getByTestId('add-to').locator('option:checked')).toHaveText('Ghost button');
  await unsorted.getByTestId('move-to').selectOption({ label: 'Ghost button' });
  const group = panel.locator('[data-testid="group"][data-group="Ghost button"]');
  await expect(group.getByTestId('tile')).toHaveCount(1);
  await expect(panel.getByTestId('unsorted')).toHaveCount(0);

  // Clicking a link while collecting collects it; the page doesn't navigate.
  await app.bringToFront();
  await app.getByRole('link', { name: 'Projects' }).click();
  await expect(group.getByTestId('tile')).toHaveCount(2);
  expect(app.url()).toMatch(/index\.html$/);
  await group.getByTestId('tile').filter({ hasText: 'Link' }).getByRole('button', { name: 'Remove' }).click();
  await expect(group.getByTestId('tile')).toHaveCount(1);

  // Esc stops collecting, on the page and in the panel.
  await app.bringToFront();
  await app.keyboard.press('Escape');
  await expect(panel.getByTestId('collect')).toBeVisible();

  // On Settings, Find counts the ghost button there and collects it: it has a different radius.
  await app.goto(`${site}/settings.html`);
  await group.getByTestId('find').click();
  await expect(panel.getByTestId('toast')).toContainText('1 match on /settings.html · 1 new version added');
  await expect(group.getByTestId('group-meta')).toHaveText('2 versions · 2 uses on 2 screens');
  await expect(group.getByTestId('differs')).toContainText('radius 4 · 8');

  const [d] = await Promise.all([panel.waitForEvent('download'), panel.getByTestId('save-report').click()]);
  expect(d.suggestedFilename()).toMatch(/^board-127\.0\.0\.1-\d{4}-\d{2}-\d{2}\.html$/);
  const html = readFileSync((await d.path())!, 'utf8');
  expect(html).toContain('Ghost button');
  expect(html).toContain('<span class="chip">radius 4 · 8</span>');
});
