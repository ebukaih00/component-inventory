/**
 * DOM adapter: walks the live page and produces Candidates for the pure detection library.
 * This is the only module (with the rest of src/content and src/spike) allowed to touch the DOM.
 */
import {
  classify,
  cleanClassTokens,
  deltaE,
  findRepeatedSiblings,
  formatStructure,
  normalizeColor,
  type Candidate,
  matchesClassRule,
  type NodeFacts,
  type PickRule,
  type StyleProps,
  type TagTree,
} from '../detect';

export interface CollectResult {
  candidates: Candidate[];
  /** elements[localId] is the element for candidates[localId]. */
  elements: Element[];
}

const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'template', 'head', 'meta', 'link', 'iframe', 'object', 'embed', 'canvas', 'video', 'audio', 'br', 'hr', 'option', 'optgroup']);
const LEAF_TAGS = new Set(['svg', 'select', 'textarea', 'input', 'img', 'canvas', 'video']);
export const OVERLAY_HOST_ID = '__component-inventory-overlay';

/* ---------- colour normalisation (canvas fallback for oklch(), color(), named colours) ---------- */

const colourCache = new Map<string, string>();
let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;

export function toHexColor(value: string): string {
  const cached = colourCache.get(value);
  if (cached) return cached;
  let out = normalizeColor(value);
  if (!out) {
    try {
      ctx ??= typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true })
        : document.createElement('canvas').getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = '#000';
        ctx.fillStyle = value;
        ctx.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
        out = normalizeColor(`rgba(${r}, ${g}, ${b}, ${a / 255})`);
      }
    } catch {
      /* ignore */
    }
  }
  out ??= '#00000000';
  colourCache.set(value, out);
  return out;
}

/* ---------- helpers ---------- */

function tagTree(el: Element, depth: number): TagTree {
  const tag = el.tagName.toLowerCase();
  if (depth === 0 || LEAF_TAGS.has(tag)) return { tag, children: [] };
  const children: TagTree[] = [];
  for (const child of Array.from(el.children).slice(0, 30)) {
    const t = child.tagName.toLowerCase();
    if (t === 'script' || t === 'style' || t === 'template') continue;
    children.push(tagTree(child, depth - 1));
  }
  return { tag, children };
}

export function structureOf(el: Element): string {
  return formatStructure(tagTree(el, 3), 3);
}

function px(v: string, basis = 0): number {
  if (v.endsWith('%')) return (parseFloat(v) / 100) * basis;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function visibleBorder(cs: CSSStyleDeclaration) {
  for (const side of ['Top', 'Right', 'Bottom', 'Left'] as const) {
    const style = cs.getPropertyValue(`border-${side.toLowerCase()}-style`);
    const width = px(cs.getPropertyValue(`border-${side.toLowerCase()}-width`));
    const color = toHexColor(cs.getPropertyValue(`border-${side.toLowerCase()}-color`));
    if (width > 0 && style !== 'none' && style !== 'hidden' && !color.endsWith('00')) return { width, style, color };
  }
  return null;
}

function hasBox(cs: CSSStyleDeclaration, parentBg: string): boolean {
  const bg = toHexColor(cs.backgroundColor);
  if (!bg.endsWith('00') && deltaE(bg, parentBg) > 1) return true;
  if (cs.backgroundImage && cs.backgroundImage !== 'none') return true;
  if (visibleBorder(cs)) return true;
  return cs.boxShadow !== 'none' && cs.boxShadow !== '';
}

export function readStyle(cs: CSSStyleDeclaration, rect: DOMRect): StyleProps {
  const border = visibleBorder(cs);
  const weight = cs.fontWeight === 'bold' ? 700 : cs.fontWeight === 'normal' ? 400 : parseInt(cs.fontWeight, 10) || 400;
  return {
    fontFamily: cs.fontFamily,
    fontSize: px(cs.fontSize),
    fontWeight: weight,
    paddingTop: px(cs.paddingTop),
    paddingRight: px(cs.paddingRight),
    paddingBottom: px(cs.paddingBottom),
    paddingLeft: px(cs.paddingLeft),
    // A radius past half the shorter side renders the same (pills use 9999px): store what you see.
    radius: Math.min(px(cs.borderTopLeftRadius.split(' ')[0], Math.min(rect.width, rect.height)), Math.min(rect.width, rect.height) / 2),
    borderWidth: border?.width ?? 0,
    borderStyle: border?.style ?? 'none',
    borderColor: border?.color ?? '#00000000',
    background: toHexColor(cs.backgroundColor),
    color: toHexColor(cs.color),
    height: rect.height,
    shadow: cs.boxShadow !== 'none' && cs.boxShadow !== '',
    textDecoration: cs.textDecorationLine,
  };
}

export function selectorPath(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur.nodeType === 1 && cur.tagName.toLowerCase() !== 'html') {
    const tag = cur.tagName.toLowerCase();
    if (cur.id && /^[A-Za-z][\w-]*$/.test(cur.id) && cur.ownerDocument.querySelectorAll(`#${cur.id}`).length === 1) {
      parts.unshift(`#${cur.id}`);
      break;
    }
    if (tag === 'body') {
      parts.unshift('body');
      break;
    }
    const parent: Element | null = cur.parentElement;
    if (!parent) {
      parts.unshift(tag);
      break;
    }
    const same = Array.from(parent.children).filter((c) => c.tagName === cur!.tagName);
    parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(cur) + 1})` : tag);
    cur = parent;
  }
  return parts.join(' > ');
}

/** Displayed, visible and somewhere on the page (not parked off screen). */
export function isShown(el: Element, cs: CSSStyleDeclaration): boolean {
  if (cs.display === 'none' || !isVisible(el, cs)) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return false;
  const doc = el.ownerDocument;
  const x = r.left + scrollX;
  const y = r.top + scrollY;
  return x + r.width > 0 && y + r.height > 0 && x < doc.documentElement.scrollWidth && y < doc.documentElement.scrollHeight;
}

function isVisible(el: Element, cs: CSSStyleDeclaration): boolean {
  const anyEl = el as Element & { checkVisibility?: (o: object) => boolean };
  if (typeof anyEl.checkVisibility === 'function') {
    return anyEl.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true });
  }
  return cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0;
}

interface Ctx {
  bg: string;
  inNav: boolean;
  inTable: boolean;
  inButton: boolean;
  inCard: boolean;
  repeated: boolean;
}

/* ---------- main walk ---------- */

export function collectCandidates(doc: Document = document, rules: PickRule[] = []): CollectResult {
  const win = doc.defaultView ?? window;
  const scrollX = win.scrollX;
  const scrollY = win.scrollY;
  const docW = Math.max(doc.documentElement.scrollWidth, win.innerWidth);
  const docH = Math.max(doc.documentElement.scrollHeight, win.innerHeight);

  const candidates: Candidate[] = [];
  const elements: Element[] = [];
  const styleCache = new Map<Element, CSSStyleDeclaration>();
  const style = (el: Element) => {
    let cs = styleCache.get(el);
    if (!cs) {
      cs = win.getComputedStyle(el);
      styleCache.set(el, cs);
    }
    return cs;
  };

  // Hand-picked rules win over the classifier. One-element rules resolve their selector once.
  const path = (doc.defaultView ?? window).location.pathname;
  const pinned = new Map<Element, PickRule>();
  for (const r of rules) {
    if (!r.selector || r.path !== path) continue;
    try {
      const el = doc.querySelector(r.selector);
      if (el) pinned.set(el, r);
    } catch {
      /* a selector from an older page layout */
    }
  }
  const classRules = rules.filter((r) => !r.selector);
  const ruleTags = new Set(classRules.map((r) => r.tag));
  const ruleFor = (el: Element, tag: string): PickRule | undefined => {
    const one = pinned.get(el);
    if (one || !ruleTags.has(tag)) return one;
    const classes = new Set(cleanClassTokens(Array.from(el.classList)));
    return classRules.find((r) => matchesClassRule(r, tag, classes));
  };

  const rootBg = (() => {
    const b = toHexColor(style(doc.body).backgroundColor);
    if (!b.endsWith('00')) return b;
    const h = toHexColor(style(doc.documentElement).backgroundColor);
    return h.endsWith('00') ? '#ffffffff' : h;
  })();

  const visit = (el: Element, ctx: Ctx) => {
    const tag = el.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag)) return;
    if (el.id.startsWith(OVERLAY_HOST_ID)) return; // our highlight and picker overlays
    const cs = style(el);
    if (cs.display === 'none') return;

    const rect = el.getBoundingClientRect();
    const visible = isVisible(el, cs);
    const docRect = { x: rect.left + scrollX, y: rect.top + scrollY, width: rect.width, height: rect.height };
    const onPage =
      rect.width >= 1 && rect.height >= 1 &&
      docRect.x + docRect.width > 0 && docRect.y + docRect.height > 0 &&
      docRect.x < docW && docRect.y < docH;
    const fullPage = rect.width >= docW * 0.9 && rect.height >= docH * 0.9;
    const boxed = hasBox(cs, ctx.bg);

    let kind: ReturnType<typeof classify> = null;
    if (visible && onPage && !fullPage && tag !== 'body') {
      const small = rect.height <= 128 && rect.width <= 240;
      const radius = px(cs.borderTopLeftRadius.split(' ')[0], Math.min(rect.width, rect.height));
      const firstChild = el.firstElementChild;
      const facts: NodeFacts = {
        tag,
        role: el.getAttribute('role')?.trim().toLowerCase() || null,
        type: tag === 'input' ? (el.getAttribute('type') ?? 'text').toLowerCase() : null,
        classTokens: Array.from(el.classList),
        display: cs.display,
        hasBox: boxed,
        width: rect.width,
        height: rect.height,
        textLength: small ? (el.textContent ?? '').trim().length : 999,
        childElementCount: el.childElementCount,
        descendantCount: el.getElementsByTagName('*').length,
        repeated: ctx.repeated,
        inNav: ctx.inNav,
        inTable: ctx.inTable,
        inButton: ctx.inButton,
        inCard: ctx.inCard,
        href: tag === 'a' && el.hasAttribute('href'),
        label: el.getAttribute('aria-label')?.trim().toLowerCase() || null,
        round: radius >= Math.min(rect.width, rect.height) * 0.45,
        image: tag === 'img' || cs.backgroundImage.includes('url(') || (el.childElementCount === 1 && firstChild?.tagName.toLowerCase() === 'img'),
      };
      const rule = ruleFor(el, tag);
      kind = rule ? { kind: rule.kind, subkind: rule.subkind } : classify(facts);
      if (kind) {
        const localId = candidates.length;
        const fixtureKey = el.getAttribute('data-ci-key') ?? undefined;
        candidates.push({
          localId,
          kind: kind.kind,
          subkind: kind.subkind,
          fingerprint: {
            structure: structureOf(el),
            style: readStyle(cs, rect),
            classes: cleanClassTokens(Array.from(el.classList)),
          },
          rect: docRect,
          selectorPath: selectorPath(el),
          ...(fixtureKey ? { fixtureKey } : {}),
        });
        elements.push(el);
      }
    }

    if (LEAF_TAGS.has(tag)) return;

    const role = el.getAttribute('role');
    const ownBg = toHexColor(cs.backgroundColor);
    const next: Omit<Ctx, 'repeated'> = {
      bg: ownBg.endsWith('00') ? ctx.bg : ownBg,
      inNav: ctx.inNav || tag === 'nav' || role === 'navigation' || role === 'tablist' || role === 'menu' || role === 'menubar',
      inTable: ctx.inTable || kind?.kind === 'table' || tag === 'table',
      inButton: ctx.inButton || kind?.kind === 'button' || kind?.kind === 'input' || kind?.kind === 'badge' || tag === 'button' || role === 'button',
      inCard: ctx.inCard || kind?.kind === 'card',
    };

    const children: Element[] = Array.from(el.children);
    if (el.shadowRoot) children.push(...Array.from(el.shadowRoot.children));

    // Repetition rule: needs every sibling's shape before visiting any of them.
    let repeated: boolean[] = [];
    if (children.length >= 2 && !next.inTable) {
      const shapes = children.map((c) => {
        const ccs = style(c);
        const box = ccs.display !== 'none' && hasBox(ccs, next.bg);
        if (!box) return { tag: c.tagName.toLowerCase(), structure: '', hasBox: false };
        const r = c.getBoundingClientRect();
        const radius = Math.round(px(ccs.borderTopLeftRadius.split(' ')[0], Math.min(r.width, r.height)));
        const boxKey = `${radius}|${visibleBorder(ccs)?.width ?? 0}|${ccs.boxShadow !== 'none' ? 1 : 0}`;
        return { tag: c.tagName.toLowerCase(), structure: structureOf(c), hasBox: true, boxKey };
      });
      repeated = findRepeatedSiblings(shapes);
    }
    children.forEach((child, i) => visit(child, { ...next, repeated: repeated[i] ?? false }));
  };

  visit(doc.body, { bg: rootBg, inNav: false, inTable: false, inButton: false, inCard: false, repeated: false });
  return { candidates, elements };
}
