import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { inventoryIdForDomain, type InventoryState } from '../detect';
import type { Broadcast } from '../shared/messages';
import { loadState } from '../storage/db';

export interface TabInfo {
  id: number;
  url: string | null;
  domain: string | null;
}

/** ?tab=<id> pins the panel to a tab (used when the panel is opened as a page, e.g. in e2e tests). */
const pinnedTab = Number(new URLSearchParams(location.search).get('tab')) || null;

async function readTab(): Promise<TabInfo | null> {
  const tab = pinnedTab
    ? await chrome.tabs.get(pinnedTab).catch(() => undefined)
    : (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  if (!tab?.id) return null;
  let domain: string | null = null;
  try {
    const u = tab.url ? new URL(tab.url) : null;
    if (u && /^https?:$/.test(u.protocol)) domain = u.hostname;
  } catch {
    /* no access to this tab's URL */
  }
  return { id: tab.id, url: tab.url ?? null, domain };
}

export function useCurrentTab(): TabInfo | null {
  const [tab, setTab] = useState<TabInfo | null>(null);
  useEffect(() => {
    const refresh = () => void readTab().then(setTab);
    refresh();
    const onUpdated = (_id: number, info: { url?: string; status?: string }) => {
      if (info.url || info.status === 'complete') refresh();
    };
    chrome.tabs.onActivated.addListener(refresh);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.windows?.onFocusChanged.addListener(refresh);
    // The URL becomes readable once the user clicks the toolbar icon (activeTab); no event fires for that.
    const poll = window.setInterval(refresh, 2000);
    return () => {
      chrome.tabs.onActivated.removeListener(refresh);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.windows?.onFocusChanged.removeListener(refresh);
      window.clearInterval(poll);
    };
  }, []);
  return tab;
}

export type ScanStatus = { state: 'idle' } | { state: 'scanning' } | { state: 'done'; count: number } | { state: 'error'; message: string };

export function useInventory(domain: string | null, tabId: number | null) {
  const [state, setState] = useState<InventoryState | null>(null);
  const [loading, setLoading] = useState(true);
  const [scan, setScan] = useState<ScanStatus>({ state: 'idle' });
  const [previewsBlocked, setPreviewsBlocked] = useState(false);
  const inventoryId = domain ? inventoryIdForDomain(domain) : null;
  const timer = useRef<number>();

  const reload = useCallback(async () => {
    if (!inventoryId) {
      setState(null);
      setLoading(false);
      return;
    }
    setState(await loadState(inventoryId));
    setLoading(false);
  }, [inventoryId]);

  useEffect(() => {
    setLoading(true);
    setScan({ state: 'idle' });
    setPreviewsBlocked(false);
    void reload();
    const onMessage = (msg: Broadcast) => {
      if (msg.type === 'inventory-changed' && msg.inventoryId === inventoryId) {
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => void reload(), 150);
      }
      if (msg.type === 'capture-status' && msg.tabId === tabId) setPreviewsBlocked(!msg.ok);
      if (msg.type === 'scan-status' && msg.tabId === tabId) {
        if (msg.state === 'scanning') setScan({ state: 'scanning' });
        if (msg.state === 'done') setScan({ state: 'done', count: msg.count ?? 0 });
        if (msg.state === 'error') setScan({ state: 'error', message: msg.message ?? 'Scan failed' });
      }
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, [inventoryId, tabId, reload]);

  return { state, loading, reload, scan, setScan, previewsBlocked };
}
