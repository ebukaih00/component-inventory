/**
 * Detection spike: paste dist-spike/inventory-spike.js into DevTools on a real screen.
 *
 *   __ci.scan()            scan this page, add it to the in-memory inventory, print the buckets
 *   __ci.highlight('v_…')  outline every instance of a variant on this page
 *   __ci.mark('v_…', true) record whether a cluster is right (true) or wrong (false)
 *   __ci.score()           print the share of clusters you marked right
 *   __ci.thresholds        edit these, then __ci.report() to regroup without rescanning
 *   __ci.save() / load()   keep the inventory across pages in localStorage (same origin only)
 *   __ci.export()          copy the JSON export to the clipboard
 */
import { applyScan, buildExport, buildReport, DEFAULT_THRESHOLDS, emptyState, inventoryIdForDomain, variantId, variantKey, type InventoryState } from '../detect';
import { collectCandidates } from '../content/collect';

const STORAGE_KEY = '__component_inventory_spike';
const thresholds = { ...DEFAULT_THRESHOLDS };
let state: InventoryState = emptyState(location.hostname);
const marks = new Map<string, boolean>();
let lastElements = new Map<string, Element[]>();

function report() {
  const r = buildReport(state, { thresholds });
  const s = r.summary;
  console.log(`%cComponent inventory — ${s.screens} screens, ${s.pages} pages · Reused ${s.common} · Near-duplicates ${s.couldBeOne} · One-off ${s.oneOff}`, 'font-weight:bold');
  console.groupCollapsed(`Reused (${r.common.length})`);
  console.table(r.common.map((v) => ({ id: v.id, name: v.name, uses: v.uses, screens: v.screens.join(' '), ...v.styleSummary })));
  console.groupEnd();
  console.groupCollapsed(`Near-duplicates (${r.couldBeOne.length})`);
  for (const g of r.couldBeOne) {
    console.log(`${g.uses} uses · ${g.diffs.map((d) => `${d.prop} ${d.values.join(' · ')}`).join(', ') || '—'}`);
    console.table(g.variants.map((v) => ({ id: v.id, name: v.name, uses: v.uses, ...v.styleSummary })));
  }
  console.groupEnd();
  console.groupCollapsed(`One-off (${r.oneOff.length})`);
  console.table(r.oneOff.map((v) => ({ id: v.id, name: v.name, page: v.pages[0], closest: v.closest?.name ?? '—', differs: v.closest?.differences.join(', ') ?? '' })));
  console.groupEnd();
  return r;
}

function scan() {
  const t0 = performance.now();
  const { candidates, elements } = collectCandidates(document);
  state = applyScan(state, { url: location.href, title: document.title, scannedAt: Date.now(), candidates });
  const inv = inventoryIdForDomain(location.hostname);
  lastElements = new Map();
  candidates.forEach((c, i) => {
    const id = variantId(inv, variantKey(c.kind, c.subkind, c.fingerprint));
    lastElements.set(id, [...(lastElements.get(id) ?? []), elements[i]]);
  });
  console.log(`Scanned ${candidates.length} candidates in ${Math.round(performance.now() - t0)}ms`);
  return report();
}

let outlines: HTMLElement[] = [];
function highlight(id: string) {
  outlines.forEach((o) => o.remove());
  outlines = [];
  const r = buildReport(state, { thresholds });
  const row = [...r.common, ...r.oneOff, ...r.couldBeOne.flatMap((g) => g.variants)].find((v) => v.id === id || v.memberIds.includes(id));
  const ids = row?.memberIds ?? [id];
  for (const el of ids.flatMap((i) => lastElements.get(i) ?? [])) {
    const b = el.getBoundingClientRect();
    const o = document.createElement('div');
    Object.assign(o.style, { position: 'absolute', left: `${b.left + scrollX - 2}px`, top: `${b.top + scrollY - 2}px`, width: `${b.width + 4}px`, height: `${b.height + 4}px`, outline: '2px solid #2456d6', pointerEvents: 'none', zIndex: '2147483647' });
    document.body.appendChild(o);
    outlines.push(o);
  }
  return outlines.length;
}

const api = {
  thresholds,
  scan,
  report,
  highlight,
  mark(id: string, right: boolean) { marks.set(id, right); },
  score() {
    const right = [...marks.values()].filter(Boolean).length;
    console.log(`${right}/${marks.size} clusters marked right (${marks.size ? Math.round((right / marks.size) * 100) : 0}%)`);
  },
  save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); },
  load() { const raw = localStorage.getItem(STORAGE_KEY); if (raw) state = JSON.parse(raw); return report(); },
  reset() { state = emptyState(location.hostname); marks.clear(); },
  collect: () => collectCandidates(document).candidates,
  export() { const json = JSON.stringify(buildExport(state), null, 2); void navigator.clipboard?.writeText(json).catch(() => undefined); return json; },
  get state() { return state; },
};

(window as unknown as { __ci: typeof api }).__ci = api;
console.log('Component inventory spike loaded. Run __ci.scan()');
