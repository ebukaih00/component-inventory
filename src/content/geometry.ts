/** Viewport geometry for cropping screenshots of elements. */

/**
 * The part of an element to crop, in viewport px, or null if it isn't showable yet. An element that
 * fits the window must be fully on screen. One taller (or wider) than the window can never be: crop
 * its top (or left) part, as long as that edge is on screen, at most as tall as it is wide.
 */
export function cropRect(el: Element): { x: number; y: number; width: number; height: number } | null {
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return null;
  const axis = (start: number, size: number, view: number) => {
    if (start >= 0 && start + size <= view) return { start, size }; // fully visible
    if (size > view && start >= 0 && start < view) return { start, size: view - start }; // oversized: leading part
    return null;
  };
  const x = axis(r.left, r.width, innerWidth);
  const y = axis(r.top, r.height, innerHeight);
  if (!x || !y) return null;
  const height = r.height > innerHeight ? Math.min(y.size, Math.max(x.size, 120)) : y.size;
  return { x: x.start, y: y.start, width: x.size, height };
}

export const nextFrames = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

/** Scrolls the element into view if it can't be cropped where it is. */
export async function bringIntoView(el: Element) {
  if (cropRect(el)) return;
  const r = el.getBoundingClientRect();
  el.scrollIntoView({ block: r.height > innerHeight ? 'start' : 'center', inline: r.width > innerWidth ? 'start' : 'center', behavior: 'instant' as ScrollBehavior });
  await nextFrames();
}
