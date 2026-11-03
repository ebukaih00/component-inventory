/** Outlines instances on the live page when a row is clicked in the side panel. */
import { OVERLAY_HOST_ID } from './collect';

let host: HTMLElement | null = null;
let timer: number | undefined;

export function clearHighlight() {
  host?.remove();
  host = null;
  window.clearTimeout(timer);
}

export function highlight(elements: Element[]) {
  clearHighlight();
  if (elements.length === 0) return 0;
  host = document.createElement('div');
  host.id = OVERLAY_HOST_ID;
  Object.assign(host.style, { position: 'absolute', left: '0', top: '0', width: '0', height: '0', zIndex: '2147483647', pointerEvents: 'none' });
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    .box { position: absolute; outline: 2px solid #2456d6; outline-offset: 2px; border-radius: 4px; background: rgba(36, 86, 214, 0.08); }
    .n { position: absolute; top: -20px; left: -2px; font: 500 11px system-ui, sans-serif; color: #fff; background: #2456d6; padding: 1px 4px; border-radius: 4px; }`;
  root.appendChild(style);
  elements.forEach((el, i) => {
    const r = el.getBoundingClientRect();
    const box = document.createElement('div');
    box.className = 'box';
    Object.assign(box.style, { left: `${r.left + scrollX}px`, top: `${r.top + scrollY}px`, width: `${r.width}px`, height: `${r.height}px` });
    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = String(i + 1);
    box.appendChild(n);
    root.appendChild(box);
  });
  document.documentElement.appendChild(host);
  elements[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
  timer = window.setTimeout(clearHighlight, 4000);
  return elements.length;
}
