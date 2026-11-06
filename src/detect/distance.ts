/** Step 3b: compare two variants property by property. */
import { CONTAINER_KINDS, structureSimilarity } from './classify';
import { deltaE, displayColor } from './color';
import { borderString, heightMatters, normalizeStyle, paddingString } from './fingerprint';
import { DEFAULT_THRESHOLDS, type Thresholds } from './thresholds';
import type { Fingerprint, Kind, StyleProps, Subkind } from './types';

export const DIFF_PROPS = [
  'font',
  'font size',
  'weight',
  'padding',
  'radius',
  'border',
  'background',
  'text colour',
  'height',
  'shadow',
  'underline',
  'structure',
] as const;
export type DiffProp = (typeof DIFF_PROPS)[number];

export interface Comparable {
  kind: Kind;
  subkind: Subkind;
  fingerprint: Fingerprint;
}

export interface PropDiff {
  prop: DiffProp;
  /** Within the near-duplicate threshold. */
  within: boolean;
  /** 0 = equal; 1 = at the threshold; capped at 5. Categorical mismatches score 3. */
  score: number;
}

const CATEGORICAL = 3;
const CAP = 5;

function numeric(prop: DiffProp, a: number, b: number, threshold: number): PropDiff | null {
  const d = Math.abs(a - b);
  if (d === 0) return null;
  return { prop, within: d <= threshold, score: Math.min(d / threshold, CAP) };
}

function colour(prop: DiffProp, a: string, b: string, threshold: number): PropDiff | null {
  if (a === b) return null;
  const d = deltaE(a, b);
  if (d < 0.5) return null;
  return { prop, within: d <= threshold, score: Math.min(d / threshold, CAP) };
}

export { structureSimilarity };

/** Every property in which a and b differ. Empty when they are style-identical. */
export function compare(a: Comparable, b: Comparable, t: Thresholds = DEFAULT_THRESHOLDS): PropDiff[] {
  const sa = normalizeStyle(a.fingerprint.style);
  const sb = normalizeStyle(b.fingerprint.style);
  const out: (PropDiff | null)[] = [];

  out.push(sa.fontFamily === sb.fontFamily ? null : { prop: 'font', within: false, score: CATEGORICAL });
  out.push(numeric('font size', sa.fontSize, sb.fontSize, t.fontSize));
  out.push(numeric('weight', sa.fontWeight, sb.fontWeight, t.fontWeight));

  const pad = Math.max(
    Math.abs(sa.paddingTop - sb.paddingTop),
    Math.abs(sa.paddingRight - sb.paddingRight),
    Math.abs(sa.paddingBottom - sb.paddingBottom),
    Math.abs(sa.paddingLeft - sb.paddingLeft),
  );
  out.push(numeric('padding', 0, pad, t.padding));
  out.push(numeric('radius', sa.radius, sb.radius, t.radius));

  if (sa.borderStyle !== sb.borderStyle) {
    out.push({ prop: 'border', within: false, score: CATEGORICAL });
  } else if (sa.borderStyle !== 'none') {
    const w = numeric('border', sa.borderWidth, sb.borderWidth, t.borderWidth);
    const c = colour('border', sa.borderColor, sb.borderColor, t.color);
    if (w || c) {
      out.push({ prop: 'border', within: (w?.within ?? true) && (c?.within ?? true), score: Math.max(w?.score ?? 0, c?.score ?? 0) });
    }
  }

  out.push(colour('background', sa.background, sb.background, t.color));
  out.push(colour('text colour', sa.color, sb.color, t.color));
  if (heightMatters(a.kind)) out.push(numeric('height', sa.height, sb.height, t.height));
  out.push(sa.shadow === sb.shadow ? null : { prop: 'shadow', within: false, score: CATEGORICAL });
  if (a.kind === 'link' && sa.textDecoration !== sb.textDecoration) out.push({ prop: 'underline', within: true, score: 1 });

  if (CONTAINER_KINDS.has(a.kind) && a.fingerprint.structure !== b.fingerprint.structure) {
    const sim = structureSimilarity(a.fingerprint.structure, b.fingerprint.structure);
    out.push({ prop: 'structure', within: sim >= t.structure, score: Math.min((1 - sim) * 4, CAP) });
  }
  return out.filter((d): d is PropDiff => d !== null);
}

/** "Probably the same": same kind and subkind, a few small differences, nothing large. */
export function isNearDuplicate(a: Comparable, b: Comparable, t: Thresholds = DEFAULT_THRESHOLDS): boolean {
  if (a.kind !== b.kind || a.subkind !== b.subkind) return false;
  const diffs = compare(a, b, t);
  return diffs.length > 0 && diffs.length <= t.maxDiffs && diffs.every((d) => d.within);
}

/** Lower is closer. Used to suggest the closest existing component for a one-off. */
export function distance(a: Comparable, b: Comparable, t: Thresholds = DEFAULT_THRESHOLDS): number {
  if (a.kind !== b.kind) return Infinity;
  const sub = a.subkind === b.subkind ? 0 : CATEGORICAL;
  return sub + compare(a, b, t).reduce((sum, d) => sum + d.score, 0);
}

/** The display value of one property, for diff chips: "radius 4 · 6 · 8". */
export function propValue(prop: DiffProp, style: StyleProps, structure: string): string {
  const s = normalizeStyle(style);
  switch (prop) {
    case 'font': return s.fontFamily;
    case 'font size': return `${s.fontSize}`;
    case 'weight': return `${s.fontWeight}`;
    case 'padding': return paddingString(s);
    case 'radius': return `${s.radius}`;
    case 'border': return borderString(s);
    case 'background': return displayColor(s.background);
    case 'text colour': return displayColor(s.color);
    case 'height': return `${s.height}`;
    case 'shadow': return s.shadow ? 'shadow' : 'none';
    case 'underline': return s.textDecoration ?? 'none';
    case 'structure': return structure;
  }
}
