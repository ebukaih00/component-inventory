/**
 * Service worker: coordinates scans on navigation, stores them, takes visible-tab
 * screenshots and crops thumbnails.
 */
import contentScript from '../content/index.ts?script&iife';
import { inventoryIdForDomain, makeCapture, routePattern, styleKey, type Rect } from '../detect';
import type { Broadcast, CaptureResponse, CollectResponse, ContentToWorker, FindResponse, PanelToWorker, ScanResponse, WorkerReply, WorkerToContent } from '../shared/messages';
import { addRule, addThumbnail, ensureInventory, getGroup, getRules, groupCaptures, listInventories, putCapture, recordScan, setGroupUsage, setRecording, thumbsNeeded } from '../storage/db';
import { BOARD_MAX, cropScreenshot, throttledCapture } from './crop';

const scriptId = (domain: string) => `record:${domain}`;
const originPattern = (url: URL) => `${url.protocol}//${url.hostname}/*`;

function broadcast(msg: Broadcast) {
  chrome.runtime.sendMessage(msg).catch(() => undefined); // no listener when the panel is closed
}

/* ---------- side panel ---------- */

// Clicking the toolbar icon opens the panel. The click also grants activeTab for the page.
// We open the panel ourselves instead of using openPanelOnActionClick: with that behaviour Chrome
// does not fire action.onClicked, and the click does not grant activeTab, so the panel cannot read
// the tab's URL. Handling the click here grants activeTab for the tab, then opens the panel.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => undefined);

chrome.action.onClicked.addListener((tab) => {
  // sidePanel.open must run inside the click's user gesture: call it before any await.
  if (tab.windowId !== undefined) chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => undefined);
});

chrome.commands?.onCommand.addListener((command, tab) => {
  if (command === 'toggle-collect' && tab?.id) {
    const id = tab.id;
    if (tab.windowId !== undefined) chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => undefined);
    void inject(id).then(() => sendToContent(id, { type: 'collect-toggle' })).catch(() => undefined);
    return;
  }
  if (command !== 'scan-page' || !tab?.id) return;
  if (tab.windowId !== undefined) chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => undefined);
  void scanTab(tab.id).catch(() => undefined);
});

/* ---------- record mode ---------- */

/**
 * Script registration is check-then-act, and Chrome fires several events that trigger it (startup,
 * install, permission removed, Start/Stop clicks). Run those changes one at a time, so two of them
 * never both see a script and both try to remove it ("Nonexistent script ID").
 */
let registrations: Promise<unknown> = Promise.resolve();
function serially<T>(task: () => Promise<T>): Promise<T> {
  const run = registrations.then(task, task);
  registrations = run.catch(() => undefined);
  return run;
}

async function isRegistered(domain: string): Promise<boolean> {
  return (await chrome.scripting.getRegisteredContentScripts({ ids: [scriptId(domain)] })).length > 0;
}

function ensureRegistered(domain: string, matches: string[]) {
  return serially(async () => {
    if (await isRegistered(domain)) return;
    await chrome.scripting.registerContentScripts([
      { id: scriptId(domain), matches, js: [contentScript], runAt: 'document_idle', persistAcrossSessions: true },
    ]);
  });
}

function ensureUnregistered(domain: string) {
  return serially(async () => {
    if (!(await isRegistered(domain))) return;
    // Chrome may still drop it on its own in between (e.g. when site access is revoked): that's fine.
    await chrome.scripting.unregisterContentScripts({ ids: [scriptId(domain)] }).catch(() => undefined);
  });
}

function registerRecording(domain: string, url: URL) {
  return ensureRegistered(domain, [originPattern(url)]);
}

async function inject(tabId: number) {
  await chrome.scripting.executeScript({ target: { tabId }, files: [contentScript] });
}

async function sendScanNow(tabId: number, manual: boolean) {
  await sendToContent(tabId, { type: 'scan-now', manual });
}

async function sendToContent<T = unknown>(tabId: number, msg: WorkerToContent): Promise<T> {
  // The content script may still be loading its module; retry briefly.
  for (let i = 0; i < 10; i++) {
    try {
      return (await chrome.tabs.sendMessage(tabId, msg)) as T;
    } catch {
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  throw new Error('The page did not respond. Reload it and try again.');
}

async function startRecording(tabId: number, rawUrl: string) {
  const url = new URL(rawUrl);
  if (!/^https?:$/.test(url.protocol)) throw new Error('Only http and https pages can be recorded.');
  const granted = await chrome.permissions.contains({ origins: [originPattern(url)] });
  if (!granted) throw new Error(`Permission for ${url.hostname} was not granted.`);
  await setRecording(url.hostname, true);
  await registerRecording(url.hostname, url);
  broadcast({ type: 'inventory-changed', inventoryId: inventoryIdForDomain(url.hostname) });
  await inject(tabId);
  await sendScanNow(tabId, false);
}

async function stopRecording(domain: string) {
  await setRecording(domain, false);
  await ensureUnregistered(domain);
  broadcast({ type: 'inventory-changed', inventoryId: inventoryIdForDomain(domain) });
}

async function scanTab(tabId: number) {
  broadcast({ type: 'scan-status', tabId, state: 'scanning' });
  try {
    await inject(tabId);
    await sendScanNow(tabId, true);
  } catch (e) {
    broadcast({ type: 'scan-status', tabId, state: 'error', message: errorMessage(e) });
    throw e;
  }
}

/** Keep registered scripts in step with stored recording flags (e.g. after an update). */
async function reconcile() {
  for (const inv of await listInventories()) {
    const allowed = await chrome.permissions.contains({ origins: [`*://${inv.domain}/*`] }).catch(() => false);
    if (inv.recording && allowed) await ensureRegistered(inv.domain, [`*://${inv.domain}/*`]);
    else await ensureUnregistered(inv.domain);
  }
}
const reconcileQuietly = () => void reconcile().catch((e) => console.warn('Component Inventory: could not sync recording scripts', e));
chrome.runtime.onStartup.addListener(reconcileQuietly);
chrome.runtime.onInstalled.addListener(reconcileQuietly);
chrome.permissions.onRemoved.addListener(reconcileQuietly);

/* ---------- messages ---------- */

const withoutHash = (url: string | undefined) => (url ?? '').split('#')[0];

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function handleContent(msg: ContentToWorker, sender: chrome.runtime.MessageSender): Promise<unknown> {
  const tab = sender.tab;
  if (!tab?.id || !sender.url) throw new Error('No tab');
  const domain = new URL(sender.url).hostname;

  switch (msg.type) {
    case 'scan': {
      const inv = (await listInventories()).find((i) => i.domain === domain);
      if (!msg.manual && !inv?.recording) return { stored: false, needThumbs: {} } satisfies ScanResponse;
      const { result, needThumbs } = await recordScan(domain, msg.scan);
      broadcast({ type: 'inventory-changed', inventoryId: result.page.inventoryId });
      broadcast({ type: 'scan-status', tabId: tab.id, state: 'done', count: msg.scan.candidates.length });
      return { stored: true, needThumbs } satisfies ScanResponse;
    }
    case 'get-rules':
      return { rules: await getRules(domain) };
    case 'picked':
    case 'pick-cancelled':
    case 'collect-state':
      return undefined; // for the side panel
    case 'collect': {
      const inv = await ensureInventory(domain);
      const wanted = msg.groupId !== undefined ? msg.groupId : (inv.collectInto ?? null);
      const group = wanted ? await getGroup(wanted) : undefined;
      const thumbnail = msg.rect ? await screenshotOf(tab, sender.url, msg.rect, msg.dpr) : null;
      const { added } = await putCapture(makeCapture(inv.id, msg.draft, group?.id ?? null, msg.source, thumbnail));
      broadcast({ type: 'inventory-changed', inventoryId: inv.id });
      return { ok: true, added, groupName: group?.name ?? null, preview: thumbnail !== null } satisfies CollectResponse;
    }
    case 'thumbs-wanted':
      return { stored: true, needThumbs: await thumbsNeeded(msg.variantIds) } satisfies ScanResponse;
    case 'capture': {
      if (!tab.active || msg.crops.length === 0) return { saved: 0 } satisfies CaptureResponse;
      let shot: string;
      try {
        shot = await throttledCapture(tab.windowId);
      } catch (e) {
        // Without activeTab (no toolbar click on this tab yet) Chrome refuses screenshots.
        broadcast({ type: 'capture-status', tabId: tab.id, ok: false });
        return { saved: 0, blocked: /activeTab|all_urls|permission/i.test(errorMessage(e)) } satisfies CaptureResponse;
      }
      broadcast({ type: 'capture-status', tabId: tab.id, ok: true });
      // The capture can wait for Chrome's rate limit. If the tab moved to another page (or view) in the
      // meantime, the screenshot shows that page, not the one the crops were measured on: drop it.
      const now = await chrome.tabs.get(tab.id).catch(() => null);
      if (!now?.active || withoutHash(now.url) !== withoutHash(sender.url)) return { saved: 0 } satisfies CaptureResponse;
      let saved = 0;
      for (const { crop, dataUrl } of await cropScreenshot(shot, msg.crops, msg.dpr)) {
        if (await addThumbnail(crop.variantId, dataUrl, crop.source)) saved++;
      }
      if (saved) broadcast({ type: 'inventory-changed', inventoryId: inventoryIdForDomain(domain) });
      return { saved } satisfies CaptureResponse;
    }
  }
}

/** One element's preview for the board, or null if Chrome won't screenshot this tab (no activeTab yet). */
async function screenshotOf(tab: chrome.tabs.Tab, url: string, rect: Rect, dpr: number): Promise<string | null> {
  if (!tab.active || tab.id === undefined) return null;
  try {
    const shot = await throttledCapture(tab.windowId);
    const now = await chrome.tabs.get(tab.id).catch(() => null);
    if (!now?.active || withoutHash(now.url) !== withoutHash(url)) return null; // moved on while waiting
    broadcast({ type: 'capture-status', tabId: tab.id, ok: true });
    const [crop] = await cropScreenshot(shot, [{ variantId: '', source: '', rect }], dpr, BOARD_MAX);
    return crop?.dataUrl ?? null;
  } catch {
    broadcast({ type: 'capture-status', tabId: tab.id, ok: false });
    return null;
  }
}

async function findSimilar(tabId: number, groupId: string): Promise<FindResponse> {
  const captures = await groupCaptures(groupId);
  const tab = await chrome.tabs.get(tabId);
  const route = routePattern(tab.url ?? '');
  if (captures.length === 0) return { ok: true, count: 0, added: 0, route };
  await inject(tabId);
  const res = await sendToContent<Omit<FindResponse, 'route'>>(tabId, {
    type: 'find-similar',
    groupId,
    matchers: captures.map((c) => ({ kind: c.kind, tag: c.tag, classes: c.classes, fingerprint: c.fingerprint })),
    known: [...new Set(captures.map(styleKey))],
  });
  if (!res?.ok) return { ok: false, count: 0, added: 0, route, error: res?.error ?? 'The page did not respond.' };
  await setGroupUsage(groupId, route, res.count);
  broadcast({ type: 'inventory-changed', inventoryId: captures[0].inventoryId });
  return { ...res, route };
}

async function handlePanel(msg: PanelToWorker): Promise<WorkerReply | FindResponse> {
  switch (msg.type) {
    case 'start-recording':
      await startRecording(msg.tabId, msg.url);
      return { ok: true };
    case 'stop-recording':
      await stopRecording(msg.domain);
      return { ok: true };
    case 'scan-tab':
      await scanTab(msg.tabId);
      return { ok: true };
    case 'start-pick':
      await inject(msg.tabId);
      await sendToContent(msg.tabId, { type: 'pick-start' });
      return { ok: true };
    case 'add-rule':
      await addRule(msg.domain, msg.rule);
      broadcast({ type: 'inventory-changed', inventoryId: inventoryIdForDomain(msg.domain) });
      await scanTab(msg.tabId); // apply it now: a manual scan stores the page and crops previews
      return { ok: true };
    case 'set-collecting':
      if (msg.on) await inject(msg.tabId);
      await sendToContent(msg.tabId, { type: msg.on ? 'collect-start' : 'collect-stop' });
      return { ok: true };
    case 'find-similar':
      return findSimilar(msg.tabId, msg.groupId);
  }
}

chrome.runtime.onMessage.addListener((msg: ContentToWorker | PanelToWorker, sender, sendResponse) => {
  // The side panel is an extension page (it can also be opened in a tab, as the e2e tests do).
  const fromContent = Boolean(sender.tab) && !sender.url?.startsWith(chrome.runtime.getURL(''));
  const work = fromContent ? handleContent(msg as ContentToWorker, sender) : handlePanel(msg as PanelToWorker);
  work.then(sendResponse, (e) => sendResponse({ ok: false, error: errorMessage(e) }));
  return true; // async response
});
