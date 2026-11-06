/**
 * The board: components the user collects by hand and sorts into groups, like screenshots on a
 * Figma board. Pure: the content script reads the DOM, this decides what matches and what differs.
 */
import { CONTAINER_KINDS, structureSimilarity } from './classify';
import { isTransparent } from './color';
import { compare, propValue, type DiffProp } from './distance';
import { normalizeStyle, variantKey } from './fingerprint';
import { hash } from './hash';
import { normalizeUrl, routePattern } from './route';
import { DEFAULT_THRESHOLDS, type Thresholds } from './thresholds';
import type { Fingerprint, Inventory, Kind, StyleProps } from './types';

export interface Group {
  id: string;
  inventoryId: string;
  name: string;
  createdAt: number;
  /** Route pattern → how many matches "Find on this page" counted there last time. */
  usage: Record<string, number>;
}

/** One element the user clicked (or Find similar added), with its screenshot. */
export interface Capture {
  id: string;
  inventoryId: string;
  /** null: still in Unsorted. */
  groupId: string | null;
  kind: Kind;
  tag: string;
  /** Stable class tokens (cleanClassTokens). */
  classes: string[];
  selector: string;
  url: string;
  route: string;
  title: string;
  fingerprint: Fingerprint;
  width: number;
  height: number;
  thumbnail: string | null;
  source: 'picked' | 'found';
  createdAt: number;
}

/** What the content script knows about an element. The worker turns it into a Capture. */
export interface CaptureDraft {
  kind: Kind;
  tag: string;
  classes: string[];
  selector: string;
  url: string;
  title: string;
  fingerprint: Fingerprint;
  width: number;
  height: number;
  /** "button.btn.btn-primary", for messages. */
  label: string;
}

export interface CollectionState {
  inventory: Inventory;
  groups: Group[];
  captures: Capture[];
}

export function groupId(inventoryId: string, name: string, now: number): string {
  return `g_${hash(`${inventoryId}::${name}::${now}`)}`;
}

/** Collecting the same element twice updates it instead of adding a copy. */
export function captureId(inventoryId: string, url: string, selector: string): string {
  return `c_${hash(`${inventoryId}::${normalizeUrl(url)}::${selector}`)}`;
}

export function makeCapture(inventoryId: string, draft: CaptureDraft, groupId: string | null, source: Capture['source'], thumbnail: string | null, now = Date.now()): Capture {
  const { label: _label, ...rest } = draft;
  return {
    ...rest,
    id: captureId(inventoryId, draft.url, draft.selector),
    inventoryId,
    groupId,
    url: normalizeUrl(draft.url),
    route: routePattern(draft.url),
    thumbnail,
    source,
    createdAt: now,
  };
}

/** Captures with equal keys look exactly the same: one version. Structure only splits containers. */
export function styleKey(c: Pick<Capture, 'kind' | 'fingerprint'>): string {
  return variantKey(c.kind, null, CONTAINER_KINDS.has(c.kind) ? { ...c.fingerprint, structure: '-' } : c.fingerprint);
}

/* ---------- Find similar ---------- */

/** What the content script compares each element on the page against. */
export interface Matcher {
  kind: Kind;
  tag: string;
  classes: string[];
  fingerprint: Fingerprint;
}

export interface MatchCandidate {
  tag: string;
  classes: string[];
  fingerprint: Fingerprint;
}

export type Match = 'same' | 'similar' | null;

function hasVisibleBox(s: StyleProps): boolean {
  const n = normalizeStyle(s);
  return !isTransparent(n.background) || n.borderStyle !== 'none' || n.shadow;
}

/** Tags that are components on their own, box or not. */
const SELF_EVIDENT = new Set(['a', 'button', 'input', 'select', 'textarea', 'svg', 'img']);

/**
 * Is this element on the page the collected component ('same': looks identical), another version
 * of it ('similar'), or unrelated? Same tag always; then either every one of its stable classes,
 * or a near-identical style. A plain unstyled div needs its classes: style alone matches half the page.
 */
export function matchElement(m: Matcher, c: MatchCandidate, t: Thresholds = DEFAULT_THRESHOLDS): Match {
  if (m.tag !== c.tag) return null;
  if (CONTAINER_KINDS.has(m.kind) && structureSimilarity(m.fingerprint.structure, c.fingerprint.structure) < t.findStructure) return null;
  const same = styleKey(m) === styleKey({ kind: m.kind, fingerprint: c.fingerprint });
  const classes = new Set(c.classes);
  if (m.classes.length > 0 && m.classes.every((x) => classes.has(x))) return same ? 'same' : 'similar';
  if (!SELF_EVIDENT.has(m.tag) && !hasVisibleBox(m.fingerprint.style)) return null;
  if (same) return 'same';
  const diffs = compare({ kind: m.kind, subkind: null, fingerprint: m.fingerprint }, { kind: m.kind, subkind: null, fingerprint: c.fingerprint }, t)
    .filter((d) => d.prop !== 'structure');
  return diffs.length > 0 && diffs.length <= t.maxDiffs && diffs.every((d) => d.within) ? 'similar' : null;
}

/** The best match against any of a group's captures. */
export function matchAny(matchers: Matcher[], c: MatchCandidate, t: Thresholds = DEFAULT_THRESHOLDS): Match {
  let best: Match = null;
  for (const m of matchers) {
    const r = matchElement(m, c, t);
    if (r === 'same') return 'same';
    best ??= r;
  }
  return best;
}

/* ---------- reading a group ---------- */

export interface Version {
  key: string;
  captures: Capture[];
  thumbnail: string | null;
  screens: string[];
  /** This version's value for each property that differs within the group. */
  values: { prop: DiffProp; value: string }[];
}

export interface GroupView {
  group: Group;
  versions: Version[];
  /** Properties that differ between versions, with every distinct value: "radius 4 · 6 · 8". */
  differs: { prop: DiffProp; values: string[] }[];
  uses: number;
  screens: string[];
}

/** Shown in chips; structure is noise for a board (cards differ in content). */
const SHOWN: DiffProp[] = ['font', 'font size', 'weight', 'padding', 'radius', 'border', 'background', 'text colour', 'height', 'shadow', 'underline'];

const uniq = <T>(xs: T[]) => [...new Set(xs)];

export function versionsOf(captures: Capture[]): Version[] {
  const byKey = new Map<string, Capture[]>();
  for (const c of [...captures].sort((a, b) => a.createdAt - b.createdAt)) {
    const k = styleKey(c);
    byKey.set(k, [...(byKey.get(k) ?? []), c]);
  }
  return [...byKey.entries()]
    .map(([key, cs]) => ({
      key,
      captures: cs,
      thumbnail: cs.find((c) => c.thumbnail)?.thumbnail ?? null,
      screens: uniq(cs.map((c) => c.route)).sort(),
      values: [],
    }))
    .sort((a, b) => b.captures.length - a.captures.length);
}

export function viewGroup(group: Group, captures: Capture[]): GroupView {
  const versions = versionsOf(captures);
  const reps = versions.map((v) => v.captures[0]);
  const props = new Set<DiffProp>();
  for (let i = 1; i < reps.length; i++) {
    for (const d of compare({ ...reps[0], subkind: null }, { ...reps[i], subkind: null })) props.add(d.prop);
  }
  const differs = SHOWN.filter((p) => props.has(p)).map((prop) => ({
    prop,
    values: uniq(reps.map((r) => propValue(prop, r.fingerprint.style, r.fingerprint.structure))),
  }));
  for (const v of versions) {
    const r = v.captures[0];
    v.values = differs.map((d) => ({ prop: d.prop, value: propValue(d.prop, r.fingerprint.style, r.fingerprint.structure) }));
  }
  // Uses: per screen, what Find counted there, or at least what was collected there.
  const perScreen = new Map<string, number>();
  for (const c of captures) perScreen.set(c.route, (perScreen.get(c.route) ?? 0) + 1);
  for (const [route, n] of Object.entries(group.usage)) perScreen.set(route, Math.max(n, perScreen.get(route) ?? 0));
  const screens = [...perScreen.entries()].filter(([, n]) => n > 0).map(([r]) => r).sort();
  return { group, versions, differs, uses: [...perScreen.values()].reduce((a, b) => a + b, 0), screens };
}

export interface BoardView {
  groups: GroupView[];
  unsorted: Version[];
  summary: { groups: number; versions: number; captures: number; screens: number };
}

export function viewBoard(state: Pick<CollectionState, 'groups' | 'captures'>): BoardView {
  const groups = [...state.groups]
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((g) => viewGroup(g, state.captures.filter((c) => c.groupId === g.id)));
  const ids = new Set(state.groups.map((g) => g.id));
  // A capture whose group was deleted elsewhere falls back to Unsorted rather than vanishing.
  const unsorted = state.captures.filter((c) => !c.groupId || !ids.has(c.groupId));
  const screens = uniq([...state.captures.map((c) => c.route), ...groups.flatMap((g) => g.screens)]);
  return {
    groups,
    unsorted: versionsOf(unsorted).sort((a, b) => b.captures[0].createdAt - a.captures[0].createdAt),
    summary: {
      groups: groups.length,
      versions: groups.reduce((n, g) => n + g.versions.length, 0),
      captures: state.captures.length,
      screens: screens.length,
    },
  };
}

/* ---------- export ---------- */

export interface BoardExport {
  schema: 'component-board/1';
  exportedAt: string;
  domain: string;
  summary: BoardView['summary'];
  groups: {
    name: string;
    uses: number;
    screens: string[];
    differs: { prop: string; values: string[] }[];
    versions: ExportVersion[];
  }[];
  unsorted: ExportVersion[];
}

export interface ExportVersion {
  kind: Kind;
  tag: string;
  classes: string[];
  collected: number;
  screens: string[];
  values: { prop: string; value: string }[];
  style: StyleProps;
  thumbnail: string | null;
  elements: { url: string; selector: string }[];
}

function exportVersion(v: Version): ExportVersion {
  const c = v.captures[0];
  return {
    kind: c.kind,
    tag: c.tag,
    classes: c.classes,
    collected: v.captures.length,
    screens: v.screens,
    values: v.values,
    style: normalizeStyle(c.fingerprint.style),
    thumbnail: v.thumbnail,
    elements: v.captures.map((x) => ({ url: x.url, selector: x.selector })),
  };
}

export function buildBoardExport(state: CollectionState, now = new Date()): BoardExport {
  const board = viewBoard(state);
  return {
    schema: 'component-board/1',
    exportedAt: now.toISOString(),
    domain: state.inventory.domain,
    summary: board.summary,
    groups: board.groups.map((g) => ({
      name: g.group.name,
      uses: g.uses,
      screens: g.screens,
      differs: g.differs,
      versions: g.versions.map(exportVersion),
    })),
    unsorted: board.unsorted.map(exportVersion),
  };
}
