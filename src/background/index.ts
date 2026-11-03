/**
 * Service worker: coordinates scans on navigation, stores them, takes visible-tab
 * screenshots and crops thumbnails.
 */
import contentScript from '../content/index.ts?script&iife';
import { inventoryIdForDomain } from '../detect';
import type { Broadcast, CaptureResponse, ContentToWorker, PanelToWorker, ScanResponse, WorkerReply, WorkerToContent } from '../shared/messages';
import { addThumbnail, listInventories, recordScan, setRecording, thumbsNeeded } from '../storage/db';
import { cropScreenshot, throttledCapture } from './crop';

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
  if (command !== 'scan-page' || !tab?.id) return;
  if (tab.windowId !== undefined) chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => undefined);
  void scanTab(tab.id).catch(() => undefined);
});

/* ---------- record mode ---------- */

async function registerRecording(domain: string, url: URL) {
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [scriptId(domain)] });
  if (existing.length) return;
  await chrome.scripting.registerContentScripts([
    {
      id: scriptId(domain),
      matches: [originPattern(url)],
      js: [contentScript],
      runAt: 'document_idle',
      persistAcrossSessions: true,
    },
  ]);
}

async function inject(tabId: number) {
  await chrome.scripting.executeScript({ target: { tabId }, files: [contentScript] });
}

async function sendScanNow(tabId: number, manual: boolean) {
  const msg: WorkerToContent = { type: 'scan-now', manual };
  // The content script may still be loading its module; retry briefly.
  for (let i = 0; i < 10; i++) {
    try {
      await chrome.tabs.sendMessage(tabId, msg);
      return;
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
  await chrome.scripting.unregisterContentScripts({ ids: [scriptId(domain)] }).catch(() => undefined);
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
  const registered = new Set((await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id));
  for (const inv of await listInventories()) {
    const id = scriptId(inv.domain);
    const allowed = await chrome.permissions.contains({ origins: [`*://${inv.domain}/*`] }).catch(() => false);
    if (inv.recording && allowed && !registered.has(id)) {
      await chrome.scripting.registerContentScripts([{ id, matches: [`*://${inv.domain}/*`], js: [contentScript], runAt: 'document_idle', persistAcrossSessions: true }]);
    }
    if ((!inv.recording || !allowed) && registered.has(id)) await chrome.scripting.unregisterContentScripts({ ids: [id] });
  }
}
chrome.runtime.onStartup.addListener(() => void reconcile());
chrome.runtime.onInstalled.addListener(() => void reconcile());
chrome.permissions.onRemoved.addListener(() => void reconcile());

/* ---------- messages ---------- */

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
      let saved = 0;
      for (const { crop, dataUrl } of await cropScreenshot(shot, msg.crops, msg.dpr)) {
        if (await addThumbnail(crop.variantId, dataUrl, crop.source)) saved++;
      }
      if (saved) broadcast({ type: 'inventory-changed', inventoryId: inventoryIdForDomain(domain) });
      return { saved } satisfies CaptureResponse;
    }
  }
}

async function handlePanel(msg: PanelToWorker): Promise<WorkerReply> {
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
  }
}

chrome.runtime.onMessage.addListener((msg: ContentToWorker | PanelToWorker, sender, sendResponse) => {
  // The side panel is an extension page (it can also be opened in a tab, as the e2e tests do).
  const fromContent = Boolean(sender.tab) && !sender.url?.startsWith(chrome.runtime.getURL(''));
  const work = fromContent ? handleContent(msg as ContentToWorker, sender) : handlePanel(msg as PanelToWorker);
  work.then(sendResponse, (e) => sendResponse({ ok: false, error: errorMessage(e) }));
  return true; // async response
});
