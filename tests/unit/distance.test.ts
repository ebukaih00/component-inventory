import { describe, expect, it } from 'vitest';
import { compare, DEFAULT_THRESHOLDS, distance, isNearDuplicate, structureSimilarity, variantKey } from '../../src/detect';
import { baseStyle, comparable } from './helpers';

describe('variant key', () => {
  it('is equal for identical styles and ignores sub-pixel noise', () => {
    const fp = (s = {}) => ({ structure: 'button', style: { ...baseStyle, ...s }, classes: [] });
    expect(variantKey('button', null, fp())).toBe(variantKey('button', null, fp({ paddingTop: 8.1 })));
    expect(variantKey('button', null, fp())).not.toBe(variantKey('button', null, fp({ radius: 4 })));
  });
  it('ignores height and includes structure for containers', () => {
    const fp = (s = {}, structure = 'article(h3,p)') => ({ structure, style: { ...baseStyle, ...s }, classes: [] });
    expect(variantKey('card', null, fp({ height: 100 }))).toBe(variantKey('card', null, fp({ height: 140 })));
    expect(variantKey('card', null, fp())).not.toBe(variantKey('card', null, fp({}, 'article(h3)')));
  });
  it('treats a transparent border as no border', () => {
    const fp = (s = {}) => ({ structure: 'button', style: { ...baseStyle, ...s }, classes: [] });
    expect(variantKey('button', null, fp({ borderWidth: 1, borderStyle: 'solid', borderColor: '#00000000' }))).toBe(variantKey('button', null, fp()));
  });
});

describe('near-duplicates', () => {
  it('flags a radius 2px apart', () => {
    expect(isNearDuplicate(comparable({ radius: 4 }), comparable({ radius: 6 }))).toBe(true);
    expect(compare(comparable({ radius: 4 }), comparable({ radius: 6 })).map((d) => d.prop)).toEqual(['radius']);
  });
  it('flags a nearly identical colour', () => {
    expect(isNearDuplicate(comparable(), comparable({ background: '#2664eaff' }))).toBe(true);
  });
  it('does not flag different intents (primary vs danger)', () => {
    expect(isNearDuplicate(comparable(), comparable({ background: '#b91c1cff' }))).toBe(false);
  });
  it('does not flag size variants', () => {
    expect(isNearDuplicate(comparable(), comparable({ height: 44, paddingTop: 12, paddingBottom: 12, fontSize: 16 }))).toBe(false);
  });
  it('needs the same kind and subkind', () => {
    expect(isNearDuplicate(comparable({}, 'button'), comparable({ radius: 4 }, 'badge'))).toBe(false);
    expect(isNearDuplicate(comparable({}, 'input', 'text'), comparable({ radius: 4 }, 'input', 'select'))).toBe(false);
  });
  it('caps the number of small differences', () => {
    const many = { radius: 7, paddingTop: 9, fontSize: 15, background: '#2664eaff' };
    expect(isNearDuplicate(comparable(), comparable(many))).toBe(false);
    expect(isNearDuplicate(comparable(), comparable(many), { ...DEFAULT_THRESHOLDS, maxDiffs: 4 })).toBe(true);
  });
  it('allows small structure changes for containers', () => {
    expect(structureSimilarity('article(h3,p,span)', 'article(h3,p,span,a)')).toBeGreaterThan(0.75);
    expect(isNearDuplicate(comparable({}, 'card', null, 'article(h3,p,span)'), comparable({}, 'card', null, 'article(h3,p,span,a)'))).toBe(true);
    expect(isNearDuplicate(comparable({}, 'card', null, 'article(h3,p)'), comparable({}, 'card', null, 'div(img,ul(li+))'))).toBe(false);
  });
  it('ranks closeness', () => {
    const danger = comparable({ background: '#b91c1cff', radius: 0 });
    const primary = comparable();
    const secondary = comparable({ background: '#ffffffff', color: '#111111ff', borderWidth: 1, borderStyle: 'solid', borderColor: '#d1d5dbff' });
    expect(distance(danger, primary)).toBeLessThan(distance(danger, secondary));
  });
});
