/**
 * Step 1 of detection: decide whether an element is a candidate, and of which kind.
 * The content script turns each DOM element into NodeFacts; these rules stay pure.
 */
import type { Kind, Subkind } from './types';

export interface NodeFacts {
  tag: string; // lower case
  role: string | null;
  /** input[type], lower case. */
  type: string | null;
  classTokens: string[];
  display: string;
  /** Has its own background, a visible border or a shadow. */
  hasBox: boolean;
  width: number;
  height: number;
  /** Trimmed text length of the whole element. */
  textLength: number;
  childElementCount: number;
  descendantCount: number;
  /** Set by findRepeatedSiblings: a sibling has the same structure. */
  repeated: boolean;
  inNav: boolean;
  inTable: boolean;
  inButton: boolean;
  inCard: boolean;
  /** a[href]. */
  href: boolean;
  /** aria-label, lower case. */
  label: string | null;
  /** border-radius is at least ~half the shorter side. */
  round: boolean;
  /** An img, a background image, or a single img child. */
  image: boolean;
}

export interface Classification {
  kind: Kind;
  subkind: Subkind;
}

const TEXT_INPUT_TYPES = new Set(['', 'text', 'email', 'password', 'search', 'number', 'tel', 'url', 'date', 'datetime-local', 'month', 'time', 'week']);
const BUTTON_INPUT_TYPES = new Set(['button', 'submit', 'reset']);
const NOT_BUTTON_ROLES = new Set(['tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'treeitem', 'switch', 'checkbox', 'radio']);

const tokenRe = (words: string) => new RegExp(`(^|[-_])(${words})([-_]|$|s$)`, 'i');
const BUTTON_CLASS = tokenRe('btn|button');
const BADGE_CLASS = tokenRe('badge|tag|chip|pill|lozenge|status|label');
const CARD_CLASS = tokenRe('card|tile|panel');
const ALERT_CLASS = tokenRe('alert|banner|callout|notice|toast|snackbar|flash');
const AVATAR_CLASS = tokenRe('avatar');
const ICON_CLASS = /^(icon|fa|fas|far|fab|bi|mdi|material-icons|material-symbols-\w+|material-symbols|glyphicon)(-|$)/i;
const BREADCRUMB = /breadcrumb/i;
const PAGINATION = /pagination|pager/i;

const hasToken = (f: NodeFacts, re: RegExp) => f.classTokens.some((t) => re.test(t));
const isInline = (display: string) => display.startsWith('inline');

export function classify(f: NodeFacts): Classification | null {
  const { tag, role } = f;
  const squareish = f.width > 0 && f.height > 0 && f.width / f.height >= 0.75 && f.width / f.height <= 1.33;

  // Icons: small square SVGs and icon-font glyphs, anywhere (inside buttons too: icon sizes drift).
  if (tag === 'svg') return squareish && f.width >= 8 && f.width <= 48 ? { kind: 'icon', subkind: null } : null;
  if ((tag === 'i' || tag === 'span') && f.childElementCount === 0 && hasToken(f, ICON_CLASS) && f.width <= 48 && f.height <= 48) {
    return { kind: 'icon', subkind: null };
  }

  // Overlays, while they are open on screen
  if (tag === 'dialog' || role === 'dialog' || role === 'alertdialog') return { kind: 'dialog', subkind: null };
  if (role === 'menu') return f.inButton ? null : { kind: 'menu', subkind: null };

  // Progress
  if (tag === 'progress' || tag === 'meter' || role === 'progressbar' || role === 'meter') return { kind: 'progress', subkind: null };

  // Tables
  if (tag === 'table' || role === 'table' || role === 'grid') {
    return f.inTable ? null : { kind: 'table', subkind: null };
  }
  if (f.inTable) return null; // rows, cells and their contents belong to the table

  // Tabs and navigation (containers)
  if (role === 'tablist') return { kind: 'nav', subkind: 'tabs' };
  const navLike = tag === 'nav' || role === 'navigation' || ((tag === 'ol' || tag === 'ul') && !f.inNav);
  const named = `${f.label ?? ''} ${f.classTokens.join(' ')}`;
  if (navLike && !f.inNav && BREADCRUMB.test(named)) return { kind: 'nav', subkind: 'breadcrumb' };
  if (navLike && !f.inNav && PAGINATION.test(named)) return { kind: 'nav', subkind: 'pagination' };
  if (tag === 'nav' || role === 'navigation') return f.inNav ? null : { kind: 'nav', subkind: 'nav' };

  // Form inputs
  if (role === 'switch') return { kind: 'input', subkind: 'toggle' };
  if (tag === 'select' || role === 'combobox' || role === 'listbox') return { kind: 'input', subkind: 'select' };
  if (tag === 'textarea' || role === 'textbox' || role === 'searchbox') return { kind: 'input', subkind: 'text' };
  if (tag === 'input') {
    const type = f.type ?? '';
    if (type === 'checkbox') return { kind: 'input', subkind: 'checkbox' };
    if (type === 'radio') return { kind: 'input', subkind: 'radio' };
    if (TEXT_INPUT_TYPES.has(type)) return { kind: 'input', subkind: 'text' };
    if (BUTTON_INPUT_TYPES.has(type)) return f.inButton ? null : { kind: 'button', subkind: null };
    return null; // hidden, file, range, colour, image
  }
  if (role === 'checkbox') return { kind: 'input', subkind: 'checkbox' };
  if (role === 'radio') return { kind: 'input', subkind: 'radio' };

  // Buttons
  if (role && NOT_BUTTON_ROLES.has(role)) return null;
  if (!f.inButton) {
    if (tag === 'button' || role === 'button') return { kind: 'button', subkind: null };
    if (tag === 'a' && hasToken(f, BUTTON_CLASS) && f.hasBox) return { kind: 'button', subkind: null };
  }
  if (f.inButton) return null;

  // Avatars: round and square, with a picture or initials (or say so)
  const avatarSize = squareish && f.width >= 20 && f.width <= 128;
  if (avatarSize && (hasToken(f, AVATAR_CLASS) || (f.round && (f.image || (f.textLength >= 1 && f.textLength <= 2 && f.width >= 24))))) {
    return { kind: 'avatar', subkind: null };
  }
  if (tag === 'img') return null; // other images are content, not components

  // Alerts and banners: a wide box that announces itself
  if (f.hasBox && f.width >= 160 && !f.inCard && (role === 'alert' || role === 'status' || hasToken(f, ALERT_CLASS))) {
    return { kind: 'alert', subkind: null };
  }

  // Badges and tags: small, inline, boxed, short text
  const smallText = f.textLength > 0 && f.textLength <= 30 && f.height <= 32 && f.width <= 240 && f.childElementCount <= 2;
  if (tag !== 'label' && smallText && f.hasBox) {
    if (hasToken(f, BADGE_CLASS) || isInline(f.display)) return { kind: 'badge', subkind: null };
  }

  // Cards: a boxed container that repeats, or says it is a card
  if (f.hasBox && !f.inNav && !f.inCard && f.width >= 80 && f.height >= 40 && f.descendantCount >= 2) {
    if (f.repeated || hasToken(f, CARD_CLASS)) return { kind: 'card', subkind: null };
  }

  // Text links: a[href] without a box (boxed ones are buttons, badges or cards above)
  if (tag === 'a' && f.href && !f.inNav && !f.hasBox && f.textLength >= 1 && f.textLength <= 120 && f.height <= 40) {
    return { kind: 'link', subkind: null };
  }
  return null;
}

/** Kinds whose variants are split by structure as well as style (their content defines them). */
export const CONTAINER_KINDS: ReadonlySet<Kind> = new Set<Kind>(['card', 'table', 'nav', 'menu', 'dialog']);

export interface SiblingShape {
  tag: string;
  structure: string;
  hasBox: boolean;
  /** The box's shape, without colours: radius, border width, shadow. A highlighted card keeps it. */
  boxKey?: string;
}

function tokens(structure: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of structure.split(/[(),+]+/).filter(Boolean)) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
}

/** Dice coefficient over tag multisets: 1 = same tags, 0 = nothing in common. */
export function structureSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const ta = tokens(a);
  const tb = tokens(b);
  let common = 0;
  let total = 0;
  for (const [t, n] of ta) {
    common += Math.min(n, tb.get(t) ?? 0);
    total += n;
  }
  for (const n of tb.values()) total += n;
  return total === 0 ? 1 : (2 * common) / total;
}

/** How alike two siblings' contents must be to count as repeats of one design (pricing plans vary). */
const SIBLING_SIMILARITY = 0.6;

/**
 * Repetition rule: at least two boxed siblings with the same tag that look like one design: the same
 * structure, or the same box shape (radius, border, shadow) with broadly similar contents. Content
 * differences such as a "Most popular" line or a longer feature list don't break the repetition.
 * Returns a flag per sibling.
 */
export function findRepeatedSiblings(siblings: SiblingShape[]): boolean[] {
  const ok = siblings.map((s) => s.hasBox && s.structure.includes('('));
  const alike = (a: SiblingShape, b: SiblingShape) =>
    a.tag === b.tag &&
    (a.structure === b.structure ||
      (a.boxKey !== undefined && a.boxKey === b.boxKey && structureSimilarity(a.structure, b.structure) >= SIBLING_SIMILARITY));
  return siblings.map((s, i) => ok[i] && siblings.some((o, j) => j !== i && ok[j] && alike(s, o)));
}
