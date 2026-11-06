/**
 * Shared types for the detection library.
 * Everything in src/detect is pure TypeScript: no DOM globals, no chrome.* APIs.
 */

export const KINDS = ['button', 'link', 'input', 'badge', 'icon', 'avatar', 'card', 'alert', 'table', 'nav', 'menu', 'dialog', 'progress'] as const;
export type Kind = (typeof KINDS)[number];

/** Finer split inside a kind. Form inputs and nav need it; other kinds use null. */
export type Subkind = 'text' | 'select' | 'checkbox' | 'radio' | 'toggle' | 'tabs' | 'nav' | 'breadcrumb' | 'pagination' | null;

export const KIND_LABELS: Record<Kind, string> = {
  button: 'Button',
  link: 'Link',
  input: 'Input',
  badge: 'Badge',
  icon: 'Icon',
  avatar: 'Avatar',
  card: 'Card',
  alert: 'Alert',
  table: 'Table',
  nav: 'Navigation',
  menu: 'Menu',
  dialog: 'Dialog',
  progress: 'Progress',
};

/** Computed style, already normalised: px numbers, colours as #rrggbbaa. */
export interface StyleProps {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
  radius: number;
  borderWidth: number;
  borderStyle: string;
  borderColor: string;
  background: string;
  color: string;
  height: number;
  shadow: boolean;
  /** text-decoration-line. Only part of a link's identity. Missing in data stored before links existed. */
  textDecoration?: string;
}

export interface Fingerprint {
  /** Child tags 3 levels deep, text removed, e.g. "article(h3,p,span)". */
  structure: string;
  style: StyleProps;
  /** Class tokens with hashed CSS-in-JS names removed. */
  classes: string[];
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One element the content script picked, ready to be grouped. */
export interface Candidate {
  /** Index within the scan; lets the service worker ask for a crop of this element. */
  localId: number;
  kind: Kind;
  subkind: Subkind;
  fingerprint: Fingerprint;
  /** Document coordinates in CSS px. */
  rect: Rect;
  selectorPath: string;
  /** Value of data-ci-key, only present on the fixture site. */
  fixtureKey?: string;
}

export interface PageScan {
  url: string;
  title: string;
  scannedAt: number;
  candidates: Candidate[];
}

/* ---------- Stored data model (spec: Inventory, Page, Variant, Instance) ---------- */

export interface Inventory {
  id: string;
  name: string;
  domain: string;
  createdAt: number;
  recording: boolean;
  /** Elements the user picked by hand. Missing in inventories made before picking existed. */
  rules?: PickRule[];
  /** The board: the group Collect adds to (null or missing: Unsorted). */
  collectInto?: string | null;
}

/**
 * "This is a component": added with the element picker. Either everything with this tag and these
 * (stable) classes, on every page, or one element on one page (selector + path).
 */
export interface PickRule {
  id: string;
  kind: Kind;
  subkind: Subkind;
  tag: string;
  /** Stable class tokens (cleanClassTokens). Empty for a one-element rule. */
  classes: string[];
  /** One-element rule only: a CSS selector and the URL path it applies on. */
  selector?: string;
  path?: string;
  createdAt: number;
}

export interface Page {
  id: string;
  inventoryId: string;
  url: string;
  routePattern: string;
  title: string;
  scannedAt: number;
}

export type VariantStatus = 'kept' | 'merged' | 'ignored';

export interface StyleSummary {
  font: string;
  padding: string;
  radius: string;
  background: string;
  color: string;
  border: string;
  height: string;
}

export interface Variant {
  id: string;
  inventoryId: string;
  kind: Kind;
  subkind: Subkind;
  /** Exact grouping key: candidates with equal keys are one variant. */
  key: string;
  fingerprint: Fingerprint;
  styleSummary: StyleSummary;
  /** Up to 3 cropped thumbnails as data URLs. */
  thumbnails: string[];
  name: string;
  /** True once the user renamed it; auto names never overwrite it. */
  renamed: boolean;
  status: VariantStatus;
  /** Set when status is 'merged'. */
  mergedInto: string | null;
  /** Computed: variants this one is probably the same as. */
  nearDuplicateOf: string[];
  /** User said "not the same" (split) — never group with these. */
  notSameAs: string[];
  createdAt: number;
}

export interface Instance {
  id: string;
  inventoryId: string;
  variantId: string;
  pageId: string;
  selectorPath: string;
  rect: Rect;
  fixtureKey?: string;
}

export interface InventoryState {
  inventory: Inventory;
  pages: Page[];
  variants: Variant[];
  instances: Instance[];
}
