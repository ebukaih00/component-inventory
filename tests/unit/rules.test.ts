import { describe, expect, it } from 'vitest';
import { canPickSimilar, describeRule, makeRule, matchesClassRule, type PickTarget } from '../../src/detect';

const target: PickTarget = { tag: 'div', classes: ['stat', 'card-ish'], selector: 'body > main > div:nth-of-type(2)', path: '/dashboard' };

describe('pick rules', () => {
  it('"everything like this" matches the same tag with all the classes, on any page', () => {
    const r = makeRule(target, 'card', null, 'similar', 1);
    expect(r).toMatchObject({ kind: 'card', tag: 'div', classes: ['card-ish', 'stat'] });
    expect(r.selector).toBeUndefined();
    expect(matchesClassRule(r, 'div', new Set(['stat', 'card-ish', 'extra']))).toBe(true);
    expect(matchesClassRule(r, 'div', new Set(['stat']))).toBe(false);
    expect(matchesClassRule(r, 'section', new Set(['stat', 'card-ish']))).toBe(false);
    expect(describeRule(r)).toBe('div.card-ish.stat');
  });

  it('"only this element" pins a selector on one path, and never matches by class', () => {
    const r = makeRule(target, 'card', null, 'this', 1);
    expect(r).toMatchObject({ classes: [], selector: target.selector, path: '/dashboard' });
    expect(matchesClassRule(r, 'div', new Set(['stat', 'card-ish']))).toBe(false);
    expect(describeRule(r)).toBe('div (this one on /dashboard)');
  });

  it('falls back to one element when there are no stable classes', () => {
    const bare = { ...target, classes: [] };
    expect(canPickSimilar(bare)).toBe(false);
    expect(makeRule(bare, 'card', null, 'similar', 1).selector).toBe(bare.selector);
  });

  it('gives the same rule the same id, so adding it twice replaces it', () => {
    expect(makeRule(target, 'card', null, 'similar', 1).id).toBe(makeRule(target, 'card', null, 'similar', 2).id);
    expect(makeRule(target, 'card', null, 'similar').id).not.toBe(makeRule(target, 'badge', null, 'similar').id);
  });
});
