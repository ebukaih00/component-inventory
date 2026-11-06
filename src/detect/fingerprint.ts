/** Step 2: fingerprints. Structure strings, normalised style, and the exact variant key. */
import { CONTAINER_KINDS } from './classify';
import { displayColor, isTransparent } from './color';
import { hash } from './hash';
import type { Fingerprint, Kind, StyleProps, StyleSummary, Subkind } from './types';

export interface TagTree {
  tag: string;
  children: TagTree[];
}

/**
 * "article(h3,p,span)". Text is ignored; runs of identical siblings collapse to "tr+"
 * so a table with 3 rows and one with 30 rows share a structure.
 */
export function formatStructure(node: TagTree, depth = 3): string {
  if (depth === 0 || node.children.length === 0) return node.tag;
  const parts: string[] = [];
  for (const child of node.children) {
    const s = formatStructure(child, depth - 1);
    const last = parts[parts.length - 1];
    if (last === s || last === `${s}+`) parts[parts.length - 1] = `${s}+`;
    else parts.push(s);
  }
  return `${node.tag}(${parts.join(',')})`;
}

const round = (n: number) => Math.round(n * 2) / 2; // to 0.5px

export function normalizeStyle(s: StyleProps): StyleProps {
  const noBorder = s.borderWidth <= 0 || s.borderStyle === 'none' || s.borderStyle === 'hidden' || isTransparent(s.borderColor);
  return {
    fontFamily: s.fontFamily.split(',')[0].replace(/["']/g, '').trim().toLowerCase(),
    fontSize: round(s.fontSize),
    fontWeight: Math.round(s.fontWeight),
    paddingTop: round(s.paddingTop),
    paddingRight: round(s.paddingRight),
    paddingBottom: round(s.paddingBottom),
    paddingLeft: round(s.paddingLeft),
    radius: round(s.radius),
    borderWidth: noBorder ? 0 : round(s.borderWidth),
    borderStyle: noBorder ? 'none' : s.borderStyle,
    borderColor: noBorder ? '#00000000' : s.borderColor.toLowerCase(),
    background: isTransparent(s.background) ? '#00000000' : s.background.toLowerCase(),
    color: s.color.toLowerCase(),
    height: round(s.height),
    shadow: s.shadow,
    textDecoration: s.textDecoration?.includes('underline') ? 'underline' : 'none',
  };
}

/** Kinds whose height is part of their identity. Containers grow with their content. */
export function heightMatters(kind: Kind): boolean {
  return kind === 'button' || kind === 'input' || kind === 'badge' || kind === 'icon' || kind === 'avatar' || kind === 'progress';
}

/** Candidates whose keys are equal are the same variant. */
export function variantKey(kind: Kind, subkind: Subkind, fp: Fingerprint): string {
  const s = normalizeStyle(fp.style);
  const style = [
    s.fontFamily, s.fontSize, s.fontWeight,
    s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft,
    s.radius, s.borderWidth, s.borderStyle, s.borderColor,
    s.background, s.color, heightMatters(kind) ? s.height : '-', s.shadow ? 1 : 0,
  ].join('|');
  const structure = CONTAINER_KINDS.has(kind) ? fp.structure : '-';
  // Underline only defines links; other kinds' keys (and stored variant ids) stay as they were.
  const decoration = kind === 'link' ? `|${s.textDecoration}` : '';
  return `${kind}|${subkind ?? '-'}|${style}|${structure}${decoration}`;
}

export function variantId(inventoryId: string, key: string): string {
  return `v_${hash(`${inventoryId}::${key}`)}`;
}

const px = (n: number) => `${n}`;

export function paddingString(s: StyleProps): string {
  const { paddingTop: t, paddingRight: r, paddingBottom: b, paddingLeft: l } = s;
  if (t === r && r === b && b === l) return px(t);
  if (t === b && r === l) return `${px(t)} ${px(r)}`;
  return `${px(t)} ${px(r)} ${px(b)} ${px(l)}`;
}

export function borderString(s: StyleProps): string {
  return s.borderStyle === 'none' ? 'none' : `${s.borderWidth}px ${s.borderStyle} ${displayColor(s.borderColor)}`;
}

export function styleSummary(style: StyleProps): StyleSummary {
  const s = normalizeStyle(style);
  return {
    font: `${s.fontFamily} ${s.fontSize}/${s.fontWeight}`,
    padding: paddingString(s),
    radius: s.radius >= 1000 ? 'full' : px(s.radius), // 9999px pills stored before radii were capped
    background: displayColor(s.background),
    color: displayColor(s.color),
    border: borderString(s),
    height: px(s.height),
  };
}
