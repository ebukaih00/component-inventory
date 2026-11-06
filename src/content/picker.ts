/**
 * Element picker: outlines what's under the cursor; click picks it, ↑ selects the parent, Esc stops.
 * The page doesn't see the clicks while picking.
 *
 * Two modes. "once" (Add element): the first click ends picking. "collect" (the board): every click
 * adds the element and picking carries on until Esc, with a confirmation on the page each time.
 */
import { cleanClassTokens, type Kind, type PickTarget } from '../detect';
import { OVERLAY_HOST_ID, selectorPath } from './collect';

export const PICKER_HOST_ID = `${OVERLAY_HOST_ID}-picker`;

export interface Picked {
  target: PickTarget;
  suggestion: Kind;
  label: string;
  size: string;
}

export interface PickerOptions {
  mode: 'once' | 'collect';
  /** Collect mode: resolve with the confirmation to show ("Added to Buttons"). */
  onPick: (el: Element) => void | Promise<string>;
  /** Esc. */
  onStop: () => void;
}

const HINTS = {
  once: '<b>Pick a component.</b> Click to choose · ↑ parent · ↓ child · Esc to cancel',
  collect: '<b>Collecting.</b> Click a component to add it · ↑ parent · ↓ child · Esc to stop',
};

let stop: (() => void) | null = null;
let activeMode: PickerOptions['mode'] | null = null;

export function stopPicker() {
  stop?.();
  stop = null;
  activeMode = null;
}

export function pickerMode() {
  return activeMode;
}

/** Interactive elements a click on their text or icon most likely meant. */
const SNAP_TO = 'button, a[href], [role="button"], [role="tab"], [role="menuitem"], [role="link"], [role="option"], summary, label, select, textarea';

/**
 * People click a button's label or icon, not the button. Snap to the component around it (up to
 * four levels up); ↓ still reaches the part they were over.
 */
export function snap(el: Element): Element {
  let target = el;
  if (target instanceof SVGElement && target.tagName.toLowerCase() !== 'svg') target = target.closest('svg') ?? target;
  const around = target.closest(SNAP_TO);
  if (!around || around === target) return target;
  let depth = 0;
  for (let cur: Element | null = target; cur && cur !== around; cur = cur.parentElement) depth++;
  return depth <= 4 ? around : target;
}

export function startPicker(opts: PickerOptions) {
  stopPicker();
  activeMode = opts.mode;
  const host = document.createElement('div');
  host.id = PICKER_HOST_ID;
  Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '2147483647', pointerEvents: 'none' });
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `<style>
    .box { position: fixed; outline: 2px solid #2456d6; outline-offset: 1px; border-radius: 3px; background: rgba(36, 86, 214, 0.08); display: none; transition: outline-color 150ms ease-out, background-color 150ms ease-out; }
    .box.done { outline-color: #2f8a4f; background: rgba(47, 138, 79, 0.12); }
    .tag { position: fixed; display: none; max-width: 360px; padding: 2px 6px; border-radius: 4px; background: #1f1f1d; color: #fff; font: 500 11px/1.5 ui-monospace, Menlo, monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .bar { position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%); max-width: calc(100vw - 32px); padding: 6px 12px; border-radius: 6px; background: #1f1f1d; color: #fff; font: 12px system-ui, sans-serif; box-shadow: 0 4px 12px rgba(31, 31, 29, 0.2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .bar b { font-weight: 500; }
    .bar.done { background: #2f8a4f; }
    @media (prefers-reduced-motion: reduce) { .box { transition: none; } }
  </style>
  <div class="box"></div><div class="tag"></div>
  <div class="bar" role="status">${HINTS[opts.mode]}</div>`;
  const box = root.querySelector<HTMLElement>('.box')!;
  const tag = root.querySelector<HTMLElement>('.tag')!;
  const bar = root.querySelector<HTMLElement>('.bar')!;
  document.documentElement.appendChild(host);
  // A crosshair everywhere says "you're picking", whatever cursor the page sets.
  const cursor = document.createElement('style');
  cursor.id = `${PICKER_HOST_ID}-cursor`; // our id prefix: record mode doesn't rescan for it
  cursor.textContent = '* { cursor: crosshair !important; }';
  document.head.appendChild(cursor);

  let current: Element | null = null;
  const trail: Element[] = []; // children we went up from (or snapped from), for ↓
  let busy = false;
  let flashTimer: number | undefined;

  const show = (el: Element | null) => {
    current = el;
    if (!el) {
      box.style.display = tag.style.display = 'none';
      return;
    }
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { display: 'block', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    tag.textContent = `${describe(el)} · ${Math.round(r.width)} × ${Math.round(r.height)}`;
    tag.style.display = 'block';
    // Keep the label inside the window: above the element, or below it when there's no room.
    const w = tag.offsetWidth;
    const below = r.top < 26 ? Math.min(r.bottom + 4, innerHeight - 24) : r.top - 22;
    Object.assign(tag.style, { left: `${Math.min(Math.max(4, r.left), innerWidth - w - 4)}px`, top: `${Math.max(4, below)}px` });
  };

  /** Collect mode: say what happened, in green, then back to the hint. */
  const flash = (text: string, ok: boolean) => {
    window.clearTimeout(flashTimer);
    bar.textContent = text;
    bar.classList.toggle('done', ok);
    box.classList.toggle('done', ok);
    flashTimer = window.setTimeout(() => {
      bar.innerHTML = HINTS[opts.mode];
      bar.classList.remove('done');
      box.classList.remove('done');
    }, 1600);
  };

  const pickable = (el: Element | null) => (el && el !== document.documentElement && el !== document.body && !el.id.startsWith(PICKER_HOST_ID) ? el : null);

  const onMove = (e: MouseEvent) => {
    if (busy) return;
    const raw = pickable(document.elementFromPoint(e.clientX, e.clientY));
    if (!raw) return;
    if (current && trail.length && current.contains(raw)) return; // keep what ↑/↓ or snapping chose
    const el = snap(raw);
    if (el === current) return;
    trail.length = 0;
    if (el !== raw) trail.push(raw);
    show(el);
  };
  const swallow = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  };
  const onClick = async (e: MouseEvent) => {
    swallow(e);
    const el = current ?? pickable(e.target as Element);
    if (!el || busy) return;
    if (opts.mode === 'once') {
      stopPicker();
      void opts.onPick(el);
      return;
    }
    // Hide the outline while the element is screenshotted, then confirm.
    busy = true;
    host.style.visibility = 'hidden';
    try {
      flash((await opts.onPick(el)) ?? 'Added', true);
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Couldn’t add this one', false);
    } finally {
      busy = false;
      host.style.visibility = '';
      show(current);
    }
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      swallow(e);
      stopPicker();
      opts.onStop();
    } else if (e.key === 'ArrowUp' && current) {
      swallow(e);
      const parent = pickable(current.parentElement);
      if (parent) {
        trail.push(current);
        show(parent);
      }
    } else if (e.key === 'ArrowDown' && trail.length) {
      swallow(e);
      show(trail.pop()!);
    }
  };
  const onScroll = () => show(current);

  // Capture phase, so the page's own handlers never see the picking clicks.
  addEventListener('mousemove', onMove, true);
  addEventListener('click', onClick, true);
  for (const t of ['mousedown', 'mouseup', 'pointerdown', 'pointerup'] as const) addEventListener(t, swallow, true);
  addEventListener('keydown', onKey, true);
  addEventListener('scroll', onScroll, true);

  stop = () => {
    window.clearTimeout(flashTimer);
    removeEventListener('mousemove', onMove, true);
    removeEventListener('click', onClick, true);
    for (const t of ['mousedown', 'mouseup', 'pointerdown', 'pointerup'] as const) removeEventListener(t, swallow, true);
    removeEventListener('keydown', onKey, true);
    removeEventListener('scroll', onScroll, true);
    host.remove();
    cursor.remove();
  };
}

export function describe(el: Element): string {
  const classes = cleanClassTokens(Array.from(el.classList)).slice(0, 3);
  return `${el.tagName.toLowerCase()}${classes.map((c) => `.${c}`).join('')}`;
}

/** A best guess at what the user picked; they can change it in the panel. */
export function suggest(el: Element): Kind {
  const tag = el.tagName.toLowerCase();
  const role = el.getAttribute('role');
  if (tag === 'button' || role === 'button') return 'button';
  if (tag === 'a') return 'link';
  if (tag === 'input' || tag === 'select' || tag === 'textarea') return 'input';
  if (tag === 'svg' || tag === 'i') return 'icon';
  if (tag === 'img') return 'avatar';
  if (tag === 'nav' || tag === 'ul' || tag === 'ol') return 'nav';
  if (tag === 'table') return 'table';
  if (role === 'alert' || role === 'status') return 'alert';
  if (role === 'dialog' || tag === 'dialog') return 'dialog';
  const r = el.getBoundingClientRect();
  return r.height <= 32 && r.width <= 240 && (el.textContent ?? '').trim().length <= 30 ? 'badge' : 'card';
}

export function describePick(el: Element): Picked {
  const r = el.getBoundingClientRect();
  return {
    target: {
      tag: el.tagName.toLowerCase(),
      classes: cleanClassTokens(Array.from(el.classList)),
      selector: selectorPath(el),
      path: location.pathname,
    },
    suggestion: suggest(el),
    label: describe(el),
    size: `${Math.round(r.width)} × ${Math.round(r.height)}`,
  };
}
