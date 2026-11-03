/**
 * Content script. Picks candidates, fingerprints them and reports instances with their positions.
 * In record mode it rescans after DOM changes and SPA navigations; it also crops thumbnails of
 * visible instances as the user scrolls.
 */
import { inventoryIdForDomain, variantId, variantKey, type Candidate } from '../detect';
import type { CaptureResponse, ContentToWorker, Crop, PanelToContent, ScanResponse, ThumbNeed, WorkerToContent } from '../shared/messages';
import { collectCandidates, OVERLAY_HOST_ID } from './collect';
import { clearHighlight, highlight } from './overlay';

declare global {
  interface Window {
    __componentInventoryLoaded?: boolean;
  }
}

const RESCAN_DEBOUNCE_MS = 1200;
const SCROLL_DEBOUNCE_MS = 600;
const MAX_SCROLL_CAPTURES = 30;

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
      const result = collectCandidates(document);
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

  function inViewport(el: Element) {
    const r = el.getBoundingClientRect();
    return r.width >= 2 && r.height >= 2 && r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth;
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
        if (!el?.isConnected || need.sources.includes(src) || !inViewport(el)) continue;
        const r = el.getBoundingClientRect();
        crops.push({ variantId: vid, source: src, rect: { x: r.left, y: r.top, width: r.width, height: r.height } });
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
        elements[localId].scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' as ScrollBehavior });
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
  const scheduleRescan = () => {
    window.clearTimeout(rescanTimer);
    rescanTimer = window.setTimeout(() => void scan(false), RESCAN_DEBOUNCE_MS);
  };

  const observer = new MutationObserver((records) => {
    if (capturing) return;
    const ours = records.every((r) => (r.target as Element).id === OVERLAY_HOST_ID || [...r.addedNodes, ...r.removedNodes].every((n) => (n as Element).id === OVERLAY_HOST_ID));
    if (!ours) scheduleRescan();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'open', 'aria-expanded'] });

  // SPA navigations without DOM mutations (rare) — poll the URL cheaply.
  window.setInterval(() => {
    if (location.href !== lastUrl) scheduleRescan();
  }, 1000);

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
    } else if (msg.type === 'clear-highlight') {
      clearHighlight();
      sendResponse({ ok: true });
    }
    return false;
  });

  // Registered (record mode) scripts scan on load; the worker ignores the scan if recording is off.
  void scan(false);
}
