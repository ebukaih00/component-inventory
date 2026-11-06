import { describe, expect, it } from 'vitest';
import { classify, findRepeatedSiblings, type NodeFacts } from '../../src/detect';

const facts = (f: Partial<NodeFacts>): NodeFacts => ({
  tag: 'div', role: null, type: null, classTokens: [], display: 'block', hasBox: false,
  width: 100, height: 30, textLength: 5, childElementCount: 0, descendantCount: 0, repeated: false,
  inNav: false, inTable: false, inButton: false, inCard: false, href: false, label: null, round: false, image: false, ...f,
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

describe('classify: more kinds', () => {
  const k = (f: Partial<NodeFacts>) => classify(facts(f));

  it('finds text links, but not nav links, boxed links or anchors without href', () => {
    expect(k({ tag: 'a', href: true, display: 'inline', height: 18 })).toEqual({ kind: 'link', subkind: null });
    expect(k({ tag: 'a', href: true, inNav: true })).toBeNull();
    expect(k({ tag: 'a', href: false })).toBeNull();
    expect(k({ tag: 'a', href: true, hasBox: true, classTokens: ['btn'] })?.kind).toBe('button');
  });

  it('finds icons: small square SVGs and icon fonts, even inside buttons', () => {
    expect(k({ tag: 'svg', width: 16, height: 16 })).toEqual({ kind: 'icon', subkind: null });
    expect(k({ tag: 'svg', width: 16, height: 16, inButton: true })?.kind).toBe('icon');
    expect(k({ tag: 'svg', width: 120, height: 32 })).toBeNull(); // a logo
    expect(k({ tag: 'i', classTokens: ['fa', 'fa-user'], width: 14, height: 14 })?.kind).toBe('icon');
  });

  it('finds avatars: round and square with a picture or initials', () => {
    expect(k({ tag: 'img', round: true, image: true, width: 32, height: 32 })).toEqual({ kind: 'avatar', subkind: null });
    expect(k({ tag: 'span', round: true, hasBox: true, textLength: 2, width: 40, height: 40 })?.kind).toBe('avatar');
    expect(k({ tag: 'div', classTokens: ['user-avatar'], width: 28, height: 28 })?.kind).toBe('avatar');
    expect(k({ tag: 'img', round: false, image: true, width: 300, height: 200 })).toBeNull(); // content image
    expect(k({ tag: 'span', round: true, hasBox: true, textLength: 1, width: 18, height: 18 })?.kind).not.toBe('avatar'); // count bubble
  });

  it('finds alerts and banners: wide boxes with an alert role or class', () => {
    expect(k({ role: 'alert', hasBox: true, width: 600, height: 48, textLength: 999 })).toEqual({ kind: 'alert', subkind: null });
    expect(k({ classTokens: ['callout', 'callout-warning'], hasBox: true, width: 400, height: 60 })?.kind).toBe('alert');
    expect(k({ role: 'status', hasBox: false, width: 400 })).toBeNull(); // a bare live region
  });

  it('finds open dialogs and menus, and progress bars', () => {
    expect(k({ tag: 'dialog' })).toEqual({ kind: 'dialog', subkind: null });
    expect(k({ role: 'alertdialog' })?.kind).toBe('dialog');
    expect(k({ role: 'menu' })).toEqual({ kind: 'menu', subkind: null });
    expect(k({ tag: 'progress' })).toEqual({ kind: 'progress', subkind: null });
    expect(k({ role: 'progressbar' })?.kind).toBe('progress');
  });

  it('tells breadcrumbs and pagination apart from navigation', () => {
    expect(k({ tag: 'nav', label: 'breadcrumb' })).toEqual({ kind: 'nav', subkind: 'breadcrumb' });
    expect(k({ tag: 'ol', classTokens: ['breadcrumbs'] })).toEqual({ kind: 'nav', subkind: 'breadcrumb' });
    expect(k({ tag: 'nav', label: 'pagination' })).toEqual({ kind: 'nav', subkind: 'pagination' });
    expect(k({ tag: 'ul', classTokens: ['pagination'] })?.subkind).toBe('pagination');
    expect(k({ tag: 'nav', label: 'main' })).toEqual({ kind: 'nav', subkind: 'nav' });
    expect(k({ tag: 'ul' })).toBeNull();
  });
});

describe('repetition: one design with different contents', () => {
  it('counts siblings with the same box shape and broadly similar contents as repeats', () => {
    const box = '12|1|0';
    const plain = { tag: 'div', structure: 'div(h3,p,ul(li+))', hasBox: true, boxKey: box };
    const popular = { tag: 'div', structure: 'div(p,h3,p,ul(li+))', hasBox: true, boxKey: box };
    const other = { tag: 'div', structure: 'div(h3,p,p,ul(li+))', hasBox: true, boxKey: box };
    expect(findRepeatedSiblings([plain, popular, other])).toEqual([true, true, true]);
  });

  it('needs the same box shape when the contents differ', () => {
    const a = { tag: 'div', structure: 'div(h3,p,ul(li+))', hasBox: true, boxKey: '12|1|0' };
    const b = { tag: 'div', structure: 'div(p,h3,p,ul(li+))', hasBox: true, boxKey: '0|0|1' };
    expect(findRepeatedSiblings([a, b])).toEqual([false, false]);
  });

  it('does not treat unrelated boxes as repeats', () => {
    const a = { tag: 'div', structure: 'div(h3,p,ul(li+))', hasBox: true, boxKey: '8|1|0' };
    const b = { tag: 'div', structure: 'div(form(label,input,button))', hasBox: true, boxKey: '8|1|0' };
    expect(findRepeatedSiblings([a, b])).toEqual([false, false]);
  });
});
