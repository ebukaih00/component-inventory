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

const hasToken = (f: NodeFacts, re: RegExp) => f.classTokens.some((t) => re.test(t));
const isInline = (display: string) => display.startsWith('inline');

export function classify(f: NodeFacts): Classification | null {
  const { tag, role } = f;

  // Tables
  if (tag === 'table' || role === 'table' || role === 'grid') {
    return f.inTable ? null : { kind: 'table', subkind: null };
  }
  if (f.inTable) return null; // rows, cells and their contents belong to the table

  // Tabs and navigation (containers)
  if (role === 'tablist') return { kind: 'nav', subkind: 'tabs' };
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

  // Badges and tags: small, inline, boxed, short text
  const smallText = f.textLength > 0 && f.textLength <= 30 && f.height <= 32 && f.width <= 240 && f.childElementCount <= 2;
  if (tag !== 'label' && smallText && f.hasBox) {
    if (hasToken(f, BADGE_CLASS) || isInline(f.display)) return { kind: 'badge', subkind: null };
  }

  // Cards: a boxed container that repeats, or says it is a card
  if (f.hasBox && !f.inNav && !f.inCard && f.width >= 80 && f.height >= 40 && f.descendantCount >= 2) {
    if (f.repeated || hasToken(f, CARD_CLASS)) return { kind: 'card', subkind: null };
  }
  return null;
}

/** Kinds whose variants are split by structure as well as style (their content defines them). */
export const CONTAINER_KINDS: ReadonlySet<Kind> = new Set<Kind>(['card', 'table', 'nav']);

export interface SiblingShape {
  tag: string;
  structure: string;
  hasBox: boolean;
}

/**
 * Repetition rule: sibling elements with the same tag and structure, at least two of them,
 * each with a visual box. Returns a flag per sibling.
 */
export function findRepeatedSiblings(siblings: SiblingShape[]): boolean[] {
  const counts = new Map<string, number>();
  const keyOf = (s: SiblingShape) => `${s.tag}|${s.structure}`;
  for (const s of siblings) {
    if (!s.hasBox || !s.structure.includes('(')) continue;
    counts.set(keyOf(s), (counts.get(keyOf(s)) ?? 0) + 1);
  }
  return siblings.map((s) => s.hasBox && (counts.get(keyOf(s)) ?? 0) >= 2);
}
