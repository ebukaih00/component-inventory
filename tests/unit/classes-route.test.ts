import { describe, expect, it } from 'vitest';
import { cleanClassTokens, formatStructure, normalizeUrl, routePattern } from '../../src/detect';

describe('class tokens', () => {
  it('drops hashed CSS-in-JS names and keeps meaningful ones', () => {
    expect(cleanClassTokens(['btn', 'btn-primary', 'css-1x2y3z', 'sc-bdVaJa', 'kDjEaB', 'e1x2y3z0', 'jsx-123456', 'navItem', 'Button'])).toEqual(
      ['Button', 'btn', 'btn-primary', 'navItem'],
    );
  });
  it('strips CSS Modules suffixes', () => {
    expect(cleanClassTokens(['Button_primary__x7Yz2', 'card_title__3aB9c'])).toEqual(['Button_primary', 'card_title']);
  });
  it('keeps BEM names', () => {
    expect(cleanClassTokens(['card__title', 'card--active'])).toEqual(['card--active', 'card__title']);
  });
});

describe('route patterns', () => {
  it.each([
    ['https://app.test/projects/42/edit', '/projects/:id/edit'],
    ['https://app.test/u/3f2c1b2a-1111-4c4c-8888-123456789abc', '/u/:id'],
    ['https://app.test/invoices/inv-20231', '/invoices/:slug'],
    ['https://app.test/reports/2026-11-03', '/reports/:date'],
    ['https://app.test/commits/8f3a91c2d', '/commits/:id'],
    ['https://app.test/settings?tab=billing', '/settings'],
    ['https://app.test/index.html', '/'],
    ['https://app.test/', '/'],
  ])('%s → %s', (url, pattern) => expect(routePattern(url)).toBe(pattern));

  it('drops the hash but keeps the query', () => {
    expect(normalizeUrl('https://app.test/a?x=1#top')).toBe('https://app.test/a?x=1');
  });
});

describe('structure', () => {
  it('removes text, goes 3 levels deep and collapses repeats', () => {
    const tree = {
      tag: 'table',
      children: [
        { tag: 'thead', children: [{ tag: 'tr', children: [{ tag: 'th', children: [] }, { tag: 'th', children: [] }] }] },
        { tag: 'tbody', children: [1, 2, 3].map(() => ({ tag: 'tr', children: [{ tag: 'td', children: [{ tag: 'a', children: [] }] }] })) },
      ],
    };
    expect(formatStructure(tree)).toBe('table(thead(tr(th+)),tbody(tr(td)+))');
  });
});
