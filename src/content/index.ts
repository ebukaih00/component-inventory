/**
 * Content script. Picks candidates, fingerprints them and reports instances with their positions.
 * In record mode it rescans after DOM changes and SPA navigations; it also crops thumbnails of
 * visible instances as the user scrolls.
 */
import { inventoryIdForDomain, variantId, variantKey, type Candidate } from '../detect';
import type { PickRule } from '../detect';
import type { CaptureResponse, ContentToWorker, Crop, PanelToContent, ScanResponse, ThumbNeed, WorkerToContent } from '../shared/messages';
import { collectCandidates, OVERLAY_HOST_ID } from './collect';
import { cropRect } from './geometry';
import { clearHighlight, highlight } from './overlay';
import { collectedLine, collectElement, findSimilar, highlightSelectors } from './board';
import { describePick, pickerMode, startPicker, stopPicker } from './picker';

declare global {
  interface Window {
    __componentInventoryLoaded?: boolean;
  }
}

const RESCAN_DEBOUNCE_MS = 1200;
/** Pages that never go quiet (tickers, video, carousels) still get rescanned this often. */
const RESCAN_MAX_WAIT_MS = 3000;
/** After an in-app navigation, give the new view this long to render, whatever else is changing. */
const ROUTE_SETTLE_MS = 700;
const SCROLL_DEBOUNCE_MS = 600;
const MAX_SCROLL_CAPTURES = 80;

if (!window.__componentInventoryLoaded) {
  window.__componentInventoryLoaded = true;
  main();
}

function main() {
  const inventoryId = inventoryIdForDomain(location.hostname);
  let candidates: Candidate[] = [];
  let elements: Element[] = [];
  let byVariant = new Map<string, number[]>(); // variant id → local ids
  let lastUrl = location.href;
  let scanning = false;
  let queued: { manual: boolean } | null = null;
  let capturing = false;
  /** Screenshots refused (no activeTab yet). Retried on the next scan, not on every scroll. */
  let captureBlocked = false;

  const send = <T>(msg: ContentToWorker) => chrome.runtime.sendMessage(msg) as Promise<T>;
  const source = (localId: number) => `${location.href.split('#')[0]}|${candidates[localId].selectorPath}`;

  async function scan(manual: boolean): Promise<void> {
    if (scanning) {
      queued = { manual: manual || (queued?.manual ?? false) };
      return;
    }
    scanning = true;
    try {
      const rules = await send<{ rules?: PickRule[] }>({ type: 'get-rules' }).then((r) => r?.rules ?? [], () => []);
      const result = collectCandidates(document, rules);
      candidates = result.candidates;
      elements = result.elements;
      byVariant = new Map();
      candidates.forEach((c) => {
        const id = variantId(inventoryId, variantKey(c.kind, c.subkind, c.fingerprint));
        byVariant.set(id, [...(byVariant.get(id) ?? []), c.localId]);
      });
      lastUrl = location.href;
      captureBlocked = false;
      const res = await send<ScanResponse>({
        type: 'scan',
        manual,
        scan: { url: location.href, title: document.title, scannedAt: Date.now(), candidates },
      });
      if (!res?.stored) return;
      await captureVisible(res.needThumbs);
      if (manual && !captureBlocked) await captureByScrolling();
    } finally {
      scanning = false;
      if (queued) {
        const next = queued;
        queued = null;
        void scan(next.manual);
      }
    }
  }

  /** Picks up to `need` not-yet-cropped instances per variant that are fully on screen. */
  function visibleCrops(needs: Record<string, ThumbNeed>): Crop[] {
    const crops: Crop[] = [];
    for (const [vid, need] of Object.entries(needs)) {
      let left = need.need;
      for (const localId of byVariant.get(vid) ?? []) {
        if (left <= 0) break;
        const el = elements[localId];
        const src = source(localId);
        const rect = el?.isConnected && !need.sources.includes(src) ? cropRect(el) : null;
        if (!rect) continue;
        crops.push({ variantId: vid, source: src, rect });
        need.sources.push(src);
        left--;
      }
    }
    return crops;
  }

  async function captureVisible(needs: Record<string, ThumbNeed>) {
    if (captureBlocked) return;
    const crops = visibleCrops(needs);
    if (crops.length === 0) return;
    clearHighlight();
    capturing = true;
    try {
      const res = await send<CaptureResponse>({ type: 'capture', crops, dpr: devicePixelRatio });
      if (res?.blocked) captureBlocked = true;
    } finally {
      capturing = false;
    }
  }

  /** Manual scan only: scroll each variant's first un-cropped instance into view and crop it. */
  async function captureByScrolling() {
    const start = { x: scrollX, y: scrollY };
    const skipped = new Set<number>(); // too big for the viewport, or clipped
    const pending = (id: number, n: ThumbNeed) => elements[id]?.isConnected && !skipped.has(id) && !n.sources.includes(source(id));
    let shots = 0;
    try {
      while (shots < MAX_SCROLL_CAPTURES) {
        const { needThumbs } = await send<ScanResponse>({ type: 'thumbs-wanted', variantIds: [...byVariant.keys()] });
        const entry = Object.entries(needThumbs).find(([vid, n]) => (byVariant.get(vid) ?? []).some((id) => pending(id, n)));
        if (!entry) break;
        const [vid, need] = entry;
        const localId = (byVariant.get(vid) ?? []).find((id) => pending(id, need))!;
        // Tall or wide components: bring their top (left) edge into view, since that part is what gets cropped.
        const r = elements[localId].getBoundingClientRect();
        elements[localId].scrollIntoView({
          block: r.height > innerHeight ? 'start' : 'center',
          inline: r.width > innerWidth ? 'start' : 'center',
          behavior: 'instant' as ScrollBehavior,
        });
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const crops = visibleCrops(needThumbs);
        if (!crops.some((c) => c.variantId === vid)) {
          skipped.add(localId);
          continue;
        }
        capturing = true;
        const res = await send<CaptureResponse>({ type: 'capture', crops, dpr: devicePixelRatio });
        capturing = false;
        if (res?.blocked) {
          captureBlocked = true;
          break;
        }
        shots++;
      }
    } finally {
      capturing = false;
      scrollTo({ left: start.x, top: start.y, behavior: 'instant' as ScrollBehavior });
    }
  }

  /* ---------- record mode: rescan after DOM changes and route changes ---------- */

  let rescanTimer: number | undefined;
  let routeTimer: number | undefined;
  let pendingSince: number | null = null;
  const rescanNow = () => {
    window.clearTimeout(rescanTimer);
    window.clearTimeout(routeTimer);
    routeTimer = undefined;
    pendingSince = null;
    void scan(false);
  };
  /** Debounced, but a stream of DOM changes can only delay a rescan by RESCAN_MAX_WAIT_MS. */
  const scheduleRescan = () => {
    const now = Date.now();
    pendingSince ??= now;
    window.clearTimeout(rescanTimer);
    const wait = Math.min(RESCAN_DEBOUNCE_MS, Math.max(0, pendingSince + RESCAN_MAX_WAIT_MS - now));
    rescanTimer = window.setTimeout(rescanNow, wait);
  };
  /** A new URL: scan once the view has had a moment to render. DOM changes don't push this back. */
  const onRouteChange = () => {
    if (routeTimer !== undefined) return;
    routeTimer = window.setTimeout(rescanNow, ROUTE_SETTLE_MS);
  };

  const observer = new MutationObserver((records) => {
    if (capturing) return;
    const isOurs = (n: Node) => typeof (n as Element).id === 'string' && (n as Element).id.startsWith(OVERLAY_HOST_ID);
    const ours = records.every((r) => isOurs(r.target) || [...r.addedNodes, ...r.removedNodes].every(isOurs));
    if (!ours) scheduleRescan();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'open', 'aria-expanded'] });

  // In-app (SPA) navigations: pushState/replaceState can't be observed from an isolated world, so poll
  // the URL cheaply, and catch back/forward directly.
  const checkUrl = () => {
    if (location.href.split('#')[0] !== lastUrl.split('#')[0]) onRouteChange();
  };
  window.setInterval(checkUrl, 300);
  addEventListener('popstate', checkUrl);

  let scrollTimer: number | undefined;
  addEventListener('scroll', () => {
    if (capturing || scanning || captureBlocked) return;
    window.clearTimeout(scrollTimer);
    scrollTimer = window.setTimeout(async () => {
      if (byVariant.size === 0) return;
      const res = await send<ScanResponse>({ type: 'thumbs-wanted', variantIds: [...byVariant.keys()] }).catch(() => null);
      if (res) await captureVisible(res.needThumbs);
    }, SCROLL_DEBOUNCE_MS);
  }, { passive: true });

  /* ---------- messages from the worker and side panel ---------- */

  chrome.runtime.onMessage.addListener((msg: WorkerToContent | PanelToContent, _sender, sendResponse) => {
    if (msg.type === 'scan-now') {
      void scan(msg.manual);
      sendResponse({ ok: true });
    } else if (msg.type === 'highlight') {
      const els = msg.variantIds.flatMap((id) => (byVariant.get(id) ?? []).map((i) => elements[i])).filter((e) => e?.isConnected);
      sendResponse({ ok: true, count: highlight(els) });
    } else if (msg.type === 'pick-start') {
      clearHighlight();
      startPicker({
        mode: 'once',
        onPick: (el) => void send({ type: 'picked', ...describePick(el) }).catch(() => undefined),
        onStop: () => void send({ type: 'pick-cancelled' }).catch(() => undefined),
      });
      sendResponse({ ok: true });
    } else if (msg.type === 'collect-start' || (msg.type === 'collect-toggle' && pickerMode() !== 'collect')) {
      startCollecting();
      sendResponse({ ok: true });
    } else if (msg.type === 'collect-stop' || msg.type === 'collect-toggle') {
      if (pickerMode() === 'collect') stopPicker();
      void send({ type: 'collect-state', on: false }).catch(() => undefined);
      sendResponse({ ok: true });
    } else if (msg.type === 'find-similar') {
      findSimilar(msg).then(sendResponse, (e: unknown) => sendResponse({ ok: false, count: 0, added: 0, error: String(e) }));
      return true; // async
    } else if (msg.type === 'highlight-selectors') {
      sendResponse({ ok: true, count: highlightSelectors(msg.selectors) });
    } else if (msg.type === 'pick-cancel') {
      stopPicker();
      sendResponse({ ok: true });
    } else if (msg.type === 'clear-highlight') {
      clearHighlight();
      sendResponse({ ok: true });
    }
    return false;
  });

  function startCollecting() {
    clearHighlight();
    startPicker({
      mode: 'collect',
      onPick: async (el) => collectedLine(await collectElement(el, { source: 'picked' })),
      onStop: () => void send({ type: 'collect-state', on: false }).catch(() => undefined),
    });
    void send({ type: 'collect-state', on: true }).catch(() => undefined);
  }

  // Registered (record mode) scripts scan on load; the worker ignores the scan if recording is off.
  void scan(false);
}
