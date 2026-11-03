/**
 * Shared types for the detection library.
 * Everything in src/detect is pure TypeScript: no DOM globals, no chrome.* APIs.
 */

export const KINDS = ['button', 'input', 'badge', 'card', 'table', 'nav'] as const;
export type Kind = (typeof KINDS)[number];

/** Finer split inside a kind. Form inputs and nav need it; other kinds use null. */
export type Subkind = 'text' | 'select' | 'checkbox' | 'radio' | 'toggle' | 'tabs' | 'nav' | null;

export const KIND_LABELS: Record<Kind, string> = {
  button: 'Button',
  input: 'Input',
  badge: 'Badge',
  card: 'Card',
  table: 'Table',
  nav: 'Navigation',
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
