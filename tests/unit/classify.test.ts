import { describe, expect, it } from 'vitest';
import { classify, findRepeatedSiblings, type NodeFacts } from '../../src/detect';

const facts = (f: Partial<NodeFacts>): NodeFacts => ({
  tag: 'div', role: null, type: null, classTokens: [], display: 'block', hasBox: false,
  width: 100, height: 30, textLength: 5, childElementCount: 0, descendantCount: 0, repeated: false,
  inNav: false, inTable: false, inButton: false, inCard: false, ...f,
});

describe('classify', () => {
  it('finds semantic kinds', () => {
    expect(classify(facts({ tag: 'button' }))).toEqual({ kind: 'button', subkind: null });
    expect(classify(facts({ tag: 'input', type: 'submit' }))).toEqual({ kind: 'button', subkind: null });
    expect(classify(facts({ tag: 'input', type: 'email' }))).toEqual({ kind: 'input', subkind: 'text' });
    expect(classify(facts({ tag: 'input', type: 'checkbox' }))).toEqual({ kind: 'input', subkind: 'checkbox' });
    expect(classify(facts({ tag: 'select' }))).toEqual({ kind: 'input', subkind: 'select' });
    expect(classify(facts({ tag: 'button', role: 'switch' }))).toEqual({ kind: 'input', subkind: 'toggle' });
    expect(classify(facts({ tag: 'table' }))).toEqual({ kind: 'table', subkind: null });
    expect(classify(facts({ tag: 'div', role: 'tablist' }))).toEqual({ kind: 'nav', subkind: 'tabs' });
    expect(classify(facts({ tag: 'nav' }))).toEqual({ kind: 'nav', subkind: 'nav' });
  });

  it('treats links styled as buttons as buttons', () => {
    expect(classify(facts({ tag: 'a', classTokens: ['btn', 'btn-primary'], hasBox: true }))?.kind).toBe('button');
    expect(classify(facts({ tag: 'a', classTokens: ['nav-link'] }))).toBeNull();
  });

  it('excludes tabs, menu items, nested buttons and table internals', () => {
    expect(classify(facts({ tag: 'button', role: 'tab' }))).toBeNull();
    expect(classify(facts({ tag: 'button', inButton: true }))).toBeNull();
    expect(classify(facts({ tag: 'button', inTable: true }))).toBeNull();
    expect(classify(facts({ tag: 'input', type: 'hidden' }))).toBeNull();
  });

  it('finds badges by class or by look', () => {
    expect(classify(facts({ tag: 'span', classTokens: ['badge'], hasBox: true, display: 'block' }))?.kind).toBe('badge');
    expect(classify(facts({ tag: 'span', display: 'inline-block', hasBox: true }))?.kind).toBe('badge');
    expect(classify(facts({ tag: 'span', display: 'inline-block', hasBox: false }))).toBeNull();
    expect(classify(facts({ tag: 'span', display: 'inline', hasBox: true, textLength: 80 }))).toBeNull();
    expect(classify(facts({ tag: 'label', display: 'inline', hasBox: true }))).toBeNull();
  });

  it('finds cards by repetition or class, never plain wrappers', () => {
    const card = { hasBox: true, width: 280, height: 120, descendantCount: 3, textLength: 999 };
    expect(classify(facts({ ...card, repeated: true }))?.kind).toBe('card');
    expect(classify(facts({ ...card, classTokens: ['product-card'] }))?.kind).toBe('card');
    expect(classify(facts({ ...card }))).toBeNull();
    expect(classify(facts({ ...card, hasBox: false, repeated: true }))).toBeNull();
  });
});

describe('repetition', () => {
  it('flags boxed siblings that share a structure', () => {
    const card = { tag: 'article', structure: 'article(h3,p)', hasBox: true };
    expect(findRepeatedSiblings([card, card, { tag: 'div', structure: 'div(p)', hasBox: true }])).toEqual([true, true, false]);
    expect(findRepeatedSiblings([{ ...card, hasBox: false }, { ...card, hasBox: false }])).toEqual([false, false]);
  });
});
