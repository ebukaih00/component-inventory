import { describe, expect, it } from 'vitest';
import { renderReportHtml, reportFileName } from '../../src/export/report-html';
import { fixtureExport } from './fixture-export';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

describe('HTML report', () => {
  const exp = fixtureExport();
  const html = renderReportHtml(exp);

  it('shows the summary and the three buckets', () => {
    const summary = html.match(/<div class="summary"[\s\S]*?<\/div>/)![0].replace(/<[^>]+>/g, '');
    expect(summary).toMatch(/5 screens\s*13 reused\s*2 near-duplicates\s*13 one-off/);
    for (const id of ['common', 'couldBeOne', 'oneOff', 'pages']) expect(html).toContain(`<section class="bucket${id === 'pages' ? ' pages' : ''}" id="${id}">`);
    expect(html).toContain('<span class="chip">radius 4 · 6 · 8</span>');
    expect(html).toContain('Closest: Button 1');
  });

  it('is self-contained: CSP, no scripts, nothing remote', () => {
    expect(html).toContain(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">`);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/(src|href)="https?:/i);
    expect(html).toContain('--bucket-common:'); // tokens are inlined
  });

  it('escapes user strings', () => {
    const e = structuredClone(exp);
    e.buckets.common[0].name = '<script>x</script>';
    e.pages[0].title = '"><img src=x onerror=alert(1)>';
    const out = renderReportHtml(e);
    expect(out).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(out).not.toContain('<script>x</script>');
    expect(out).not.toContain('<img src=x');
  });

  it('only embeds data: image thumbnails', () => {
    const e = structuredClone(exp);
    e.buckets.common[0].thumbnails = [PNG, 'https://evil.test/x.png', 'data:text/html;base64,PHNjcmlwdD4='];
    const out = renderReportHtml(e);
    expect(out).toContain(`src="${PNG}"`);
    expect(out).not.toContain('evil.test');
    expect(out).not.toContain('data:text/html');
  });

  it('only writes validated hex colours into swatch styles', () => {
    const e = structuredClone(exp);
    e.buckets.common[0].styleSummary.background = '#2563eb; background-image: url(https://evil.test/x)';
    e.buckets.common[0].styleSummary.color = 'red;}</style><script>x</script>';
    const out = renderReportHtml(e);
    expect(out).toContain('style="background: #2563eb"');
    expect(out).not.toMatch(/style="[^"]*evil\.test/); // shown as escaped text, never in a style attribute
    expect(out).not.toMatch(/<script/i);
  });

  it('opens with a plain-language takeaway', () => {
    expect(html).toMatch(/component versions found across 5 screens\. \d+ of them look almost the same and could become 2 components\. 13 are used only once\./);
  });

  it('names the file by domain and export date', () => {
    expect(reportFileName(exp)).toBe('inventory-fixture.test-2026-11-03.html');
  });
});
