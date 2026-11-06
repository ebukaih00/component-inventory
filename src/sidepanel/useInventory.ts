import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { inventoryIdForDomain, type CollectionState, type InventoryState } from '../detect';
import type { Broadcast } from '../shared/messages';
import { loadCollection, loadState } from '../storage/db';

export interface TabInfo {
  id: number;
  url: string | null;
  domain: string | null;
}

/** A tab on an http(s) site: the panel has something to inventory. */
export type SiteTab = TabInfo & { domain: string };

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

const sameTab = (a: TabInfo | null | undefined, b: TabInfo | null) =>
  a === b || (!!a && !!b && a.id === b.id && a.url === b.url && a.domain === b.domain);

/** undefined until the tab has been read once, so the panel never flashes a "no tab" screen on open. */
export function useCurrentTab(): TabInfo | null | undefined {
  const [tab, setTab] = useState<TabInfo | null | undefined>(undefined);
  useEffect(() => {
    // The 2s poll mostly finds nothing new: keep the same object so the panel doesn't re-render.
    const refresh = () => void readTab().then((next) => setTab((cur) => (sameTab(cur, next) ? cur : next)));
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

/**
 * UI state that should survive closing the panel (collapsed buckets, kind filter), per key.
 * Read synchronously on first render, so the panel paints in its saved state with no flip.
 */
export function usePersisted<T>(key: string | null, initial: T): [T, (v: T) => void] {
  const [saved, setSaved] = useState<Record<string, T>>({});
  const read = (k: string): T => {
    try {
      const raw = localStorage.getItem(k);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  };
  const value = key === null ? initial : key in saved ? saved[key] : read(key);
  const set = (v: T) => {
    if (key === null) return;
    setSaved((s) => ({ ...s, [key]: v }));
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch {
      /* storage full or disabled: still works for this session */
    }
  };
  return [value, set];
}

/** The board for this site: its groups and collected components. Reloads when the worker says so. */
export function useCollection(domain: string) {
  const [state, setState] = useState<CollectionState | null>(null);
  const [loading, setLoading] = useState(true);
  const inventoryId = inventoryIdForDomain(domain);
  const timer = useRef<number>();
  const reload = useCallback(async () => {
    setState(await loadCollection(inventoryId));
    setLoading(false);
  }, [inventoryId]);
  useEffect(() => {
    setLoading(true);
    void reload();
    const onMessage = (msg: Broadcast) => {
      if (msg.type === 'inventory-changed' && msg.inventoryId === inventoryId) {
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => void reload(), 100);
      }
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, [inventoryId, reload]);
  return { state, loading, reload };
}

/** Screenshots refused on this tab (no activeTab yet): previews need one toolbar click. */
export function usePreviewsBlocked(tabId: number) {
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    setBlocked(false);
    const onMessage = (msg: Broadcast) => {
      if (msg.type === 'capture-status' && msg.tabId === tabId) setBlocked(!msg.ok);
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, [tabId]);
  return blocked;
}
