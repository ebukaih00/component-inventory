/** Hand-picked components (the element picker). Pure: the collector does the DOM side. */
import { hash } from './hash';
import type { Kind, PickRule, Subkind } from './types';

export interface PickTarget {
  tag: string;
  /** cleanClassTokens of the element. */
  classes: string[];
  selector: string;
  path: string;
}

/** Everything like the picked element (needs stable classes), or just that one element. */
export type PickScope = 'similar' | 'this';

export function canPickSimilar(t: PickTarget): boolean {
  return t.classes.length > 0;
}

export function makeRule(t: PickTarget, kind: Kind, subkind: Subkind, scope: PickScope, now = Date.now()): PickRule {
  const similar = scope === 'similar' && canPickSimilar(t);
  const classes = similar ? [...t.classes].sort() : [];
  const where = similar ? classes.join('.') : `${t.path}|${t.selector}`;
  return {
    id: `r_${hash(`${t.tag}|${where}|${kind}|${subkind ?? '-'}`)}`,
    kind,
    subkind,
    tag: t.tag,
    classes,
    ...(similar ? {} : { selector: t.selector, path: t.path }),
    createdAt: now,
  };
}

/** Class rule: same tag, and the element has every one of the rule's classes. */
export function matchesClassRule(rule: PickRule, tag: string, classes: ReadonlySet<string>): boolean {
  return !rule.selector && rule.classes.length > 0 && rule.tag === tag && rule.classes.every((c) => classes.has(c));
}

/** "div.plan.plan-popular" or "div (this one on /pricing)". */
export function describeRule(rule: PickRule): string {
  return rule.selector ? `${rule.tag} (this one on ${rule.path})` : `${rule.tag}.${rule.classes.join('.')}`;
}
