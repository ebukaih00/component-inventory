/**
 * HTML report: one self-contained file to share an inventory. Opens offline, prints to PDF.
 * Pure: returns a string. No scripts, nothing fetched; thumbnails stay as data: URLs.
 */
import tokens from '../styles/tokens.css?raw';
import type { InventoryExport } from '../detect/export';
import { BUCKETS } from '../detect/labels';
import { buildBoard, type BoardItem, type BoardRow, type BoardSection } from './board';

export const CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'";

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** Only inline raster images; anything else renders as "No preview". */
export const SAFE_IMAGE = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/;
/** The only thing ever written into a style attribute: a validated hex colour. */
export const HEX = /#[0-9a-f]{6}(?:[0-9a-f]{2})?\b/i;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function reportFileName(exp: InventoryExport): string {
  return `inventory-${exp.inventory.domain}-${exp.exportedAt.slice(0, 10)}.html`;
}

export function renderReportHtml(exp: InventoryExport): string {
  const board = buildBoard(exp);
  const s = exp.summary;
  const date = exp.exportedAt.slice(0, 10);
  const domain = esc(exp.inventory.domain);
  const groupedVersions = exp.buckets.couldBeOne.reduce((n, g) => n + g.variants.length, 0);
  const versions = s.common + groupedVersions + s.oneOff;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Component inventory · ${domain} · ${date}</title>
<style>
${tokens}
${CSS}
</style>
</head>
<body>
<main class="report">
<header class="report-header">
<p class="eyebrow">Component inventory</p>
<h1>${domain}</h1>
<p class="meta">Exported ${date} · ${plural(s.screens, 'screen')} · ${plural(s.pages, 'page')} scanned</p>
</header>
<section class="overview">
<p class="takeaway">${takeaway(versions, s.screens, groupedVersions, s.couldBeOne, s.oneOff)}</p>
${bar(s.common, s.couldBeOne, s.oneOff)}
<div class="summary" data-testid="summary">${[
    `<span><b class="num">${s.screens}</b> ${s.screens === 1 ? 'screen' : 'screens'}</span>`,
    `<span><i class="dot dot-common"></i><b class="num">${s.common}</b> ${BUCKETS.common.legend}</span>`,
    `<span><i class="dot dot-couldBeOne"></i><b class="num">${s.couldBeOne}</b> ${BUCKETS.couldBeOne.legend}</span>`,
    `<span><i class="dot dot-oneOff"></i><b class="num">${s.oneOff}</b> ${BUCKETS.oneOff.legend}</span>`,
  ].join(' ')}</div>
</section>
${board.sections.map(section).join('\n')}
${pages(exp)}
<footer class="report-footer meta">Made with Component Inventory. Generated in the browser; nothing in this file was uploaded.</footer>
</main>
</body>
</html>
`;
}

function takeaway(versions: number, screens: number, grouped: number, groups: number, oneOffs: number): string {
  const found = `${plural(versions, 'component version')} found across ${plural(screens, 'screen')}.`;
  const merge = groups > 0 ? ` ${grouped} of them look almost the same and could become ${plural(groups, 'component')}.` : '';
  const once = oneOffs > 0 ? ` ${oneOffs} ${oneOffs === 1 ? 'is' : 'are'} used only once.` : '';
  return found + merge + once;
}

function bar(common: number, couldBeOne: number, oneOff: number): string {
  const parts = ([['common', common], ['couldBeOne', couldBeOne], ['oneOff', oneOff]] as const).filter(([, n]) => n > 0);
  if (parts.length === 0) return '';
  return `<div class="bar" aria-hidden="true">${parts.map(([b, n]) => `<span class="bar-${b}" style="flex-grow: ${n}"></span>`).join('')}</div>`;
}

function section(sec: BoardSection): string {
  const body = sec.kinds.length
    ? sec.kinds
        .map((k) => `<div class="kind"><h3>${esc(k.label)} <span class="num">${k.items.length}</span></h3>${k.items.map((it) => (sec.bucket === 'couldBeOne' ? group(it) : rows(it))).join('')}</div>`)
        .join('')
    : `<p class="empty">Nothing in this bucket.</p>`;
  return `<section class="bucket" id="${sec.bucket}">
<h2><i class="dot dot-${sec.bucket}"></i>${esc(sec.title)} <span class="count num">${sec.count}</span></h2>
<p class="hint">${esc(sec.hint)}</p>
${body}
</section>`;
}

function uses(r: BoardRow): string {
  const n = Number.parseInt(r.meta, 10) || 0;
  return `<p class="uses"><b class="num">${n}</b> ${n === 1 ? 'use' : 'uses'}</p>`;
}

/** "3 uses · /pricing" → "/pricing"; the count is shown on its own. */
const where = (r: BoardRow) => r.meta.replace(/^\d+ uses? · /, '');

function rows(item: BoardItem): string {
  return item.rows
    .map(
      (r) => `<div class="row">
${thumb(r)}
<div class="row-text">${text(r)}</div>
${uses(r)}
</div>`,
    )
    .join('');
}

function group(item: BoardItem): string {
  return `<div class="group">
${item.caption ? `<p class="caption">${esc(item.caption.replace(/ · \d+ uses$/, ''))}</p>` : ''}
${item.chips.length ? `<div class="chips">${item.chips.map((c) => `<span class="chip">${esc(c)}</span>`).join('')}</div>` : ''}
<div class="tiles">${item.rows.map((r) => `<div class="tile">${thumb(r)}${text(r, true)}</div>`).join('')}</div>
</div>`;
}

function text(r: BoardRow, withUses = false): string {
  const screens = r.screens.length > 1 ? `<p class="screens">${r.screens.map((x) => `<span>${esc(x)}</span>`).join('')}</p>` : '';
  return `<p class="name">${esc(r.name)}</p>
<p class="meta">${withUses ? esc(r.meta) : esc(where(r))}</p>
${screens}
<dl class="style">${r.styleParts.map((p) => `<div><dt>${esc(p.label)}</dt><dd>${swatch(p.value)}${esc(p.value)}</dd></div>`).join('')}</dl>
${r.note ? `<p class="note">${esc(r.note)}</p>` : ''}`;
}

function swatch(value: string): string {
  const hex = value.match(HEX)?.[0];
  return hex ? `<i class="swatch" style="background: ${hex}"></i>` : '';
}

/** One representative thumbnail per row, in a fixed box: it can never push into the text. */
function thumb(r: BoardRow): string {
  const src = r.thumbnails.find((t) => SAFE_IMAGE.test(t));
  return src
    ? `<span class="thumb"><img src="${src}" alt="${esc(r.name)}"></span>`
    : `<span class="thumb thumb-empty">No preview</span>`;
}

function pages(exp: InventoryExport): string {
  if (exp.pages.length === 0) return '';
  const list = exp.pages
    .map((p) => `<tr><td class="mono">${esc(p.routePattern)}</td><td>${esc(p.title)}</td><td class="mono url">${esc(p.url)}</td></tr>`)
    .join('');
  return `<section class="bucket pages" id="pages">
<h2>Pages scanned <span class="count num">${exp.pages.length}</span></h2>
<table><thead><tr><th>Screen</th><th>Title</th><th>URL</th></tr></thead><tbody>${list}</tbody></table>
</section>`;
}

/* Tokens only — see DESIGN.md. Same type scale and bucket colours as the side panel. */
const CSS = `
* { box-sizing: border-box; }
html, body { margin: 0; }
body { font: var(--weight-regular) var(--text-12) / 1.45 var(--font); color: var(--grey-7); background: var(--grey-1); -webkit-font-smoothing: antialiased; }
p { margin: 0; }
.report { max-width: 920px; margin: 0 auto; padding: var(--space-6); background: var(--grey-0); min-height: 100vh; border-left: var(--border); border-right: var(--border); }
.num { font-variant-numeric: tabular-nums; }
.meta { font-size: var(--text-11); color: var(--grey-5); }
.mono { font-family: var(--font-mono); }

/* Header */
.report-header { display: flex; flex-direction: column; gap: 2px; padding-bottom: var(--space-4); }
.eyebrow { font-size: var(--text-11); color: var(--grey-5); }
h1 { margin: 0; font-size: var(--text-15); font-weight: var(--weight-medium); }

/* Overview: takeaway, consistency bar, legend */
.overview { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-4); border: var(--border); border-radius: var(--radius-tile); }
.takeaway { font-size: var(--text-13); max-width: 60em; }
.bar { display: flex; gap: 2px; height: 6px; }
.bar span { min-width: 6px; border-radius: 2px; }
.bar-common { background: var(--bucket-common); }
.bar-couldBeOne { background: var(--bucket-couldbeone); }
.bar-oneOff { background: var(--bucket-oneoff); }
.summary { display: flex; flex-wrap: wrap; gap: var(--space-1) var(--space-4); color: var(--grey-6); }
.summary span { display: inline-flex; align-items: center; gap: 6px; }
.summary b { font-weight: var(--weight-medium); color: var(--grey-7); margin-right: -2px; }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 4px; flex: none; }
.dot-common { background: var(--bucket-common); }
.dot-couldBeOne { background: var(--bucket-couldbeone); }
.dot-oneOff { background: var(--bucket-oneoff); }

/* Buckets */
.bucket { margin-top: var(--space-6); }
h2 { display: flex; align-items: center; gap: var(--space-2); margin: 0; font-size: var(--text-13); font-weight: var(--weight-medium); }
.count { font-weight: var(--weight-regular); color: var(--grey-5); }
.hint { margin: 2px 0 var(--space-2) calc(8px + var(--space-2)); font-size: var(--text-11); color: var(--grey-6); }
.empty { color: var(--grey-5); margin-left: calc(8px + var(--space-2)); }

.kind { border-top: var(--border); }
h3 { margin: 0; padding: var(--space-3) 0 var(--space-1); font-size: var(--text-11); font-weight: var(--weight-medium); color: var(--grey-6); }
h3 .num { font-weight: var(--weight-regular); color: var(--grey-5); }

/* Row: thumbnail | text | uses */
.row { display: grid; grid-template-columns: 200px minmax(0, 1fr) 64px; gap: var(--space-4); align-items: start; padding: var(--space-3) 0; border-top: var(--border); }
.kind > h3 + .row { border-top: 0; }
.row-text, .tile { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.name { font-size: var(--text-13); font-weight: var(--weight-medium); overflow-wrap: anywhere; }
.uses { text-align: right; font-size: var(--text-11); color: var(--grey-5); white-space: nowrap; }
.uses b { font-size: var(--text-13); font-weight: var(--weight-medium); color: var(--grey-7); }
.screens { display: flex; flex-wrap: wrap; gap: 0 var(--space-2); font-family: var(--font-mono); font-size: var(--text-11); color: var(--grey-6); }
.note { margin-top: var(--space-1); font-size: var(--text-11); color: var(--grey-7); }

/* Style: labelled values, colours with a swatch */
.style { display: flex; flex-wrap: wrap; gap: 2px var(--space-3); margin: var(--space-1) 0 0; font-size: var(--text-11); }
.style div { display: inline-flex; align-items: center; gap: var(--space-1); min-width: 0; }
.style dt { color: var(--grey-5); }
.style dd { margin: 0; display: inline-flex; align-items: center; gap: 4px; font-family: var(--font-mono); color: var(--grey-7); overflow-wrap: anywhere; }
.swatch { display: inline-block; flex: none; width: 10px; height: 10px; border-radius: 2px; border: 1px solid var(--grey-3); }

/* Thumbnail: fixed box, checkerboard, image contained */
.thumb { display: flex; align-items: center; justify-content: center; width: 100%; height: 72px; padding: var(--space-2); border: var(--border); border-radius: var(--radius-tile); background: var(--checker); overflow: hidden; }
.thumb img { display: block; max-width: 100%; max-height: 100%; object-fit: contain; }
.thumb-empty { background: var(--grey-1); border-style: dashed; font-size: var(--text-11); color: var(--grey-5); }

/* Near-duplicate group */
.group { padding: var(--space-3) 0 var(--space-4); border-top: var(--border); }
.kind > h3 + .group { border-top: 0; }
.caption { font-size: var(--text-13); font-weight: var(--weight-medium); }
.chips { display: flex; flex-wrap: wrap; gap: var(--space-1); margin: var(--space-2) 0 var(--space-3); }
.chip { font-size: var(--text-11); padding: 1px 6px; border-radius: var(--radius-control); background: var(--bucket-couldbeone-soft); color: var(--grey-7); font-variant-numeric: tabular-nums; }
.tiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-4); }
.tile .thumb { margin-bottom: var(--space-2); }

/* Pages */
.pages table { width: 100%; margin-top: var(--space-2); border-collapse: collapse; font-size: var(--text-11); }
.pages th { text-align: left; font-weight: var(--weight-medium); color: var(--grey-6); }
.pages th, .pages td { padding: var(--space-1) var(--space-2) var(--space-1) 0; border-top: var(--border); vertical-align: top; }
.pages .url { color: var(--grey-6); overflow-wrap: anywhere; }

.report-footer { margin-top: var(--space-6); padding-top: var(--space-3); border-top: var(--border); }

@media (max-width: 640px) {
  .report { padding: var(--space-4); border: 0; }
  .row { grid-template-columns: 120px minmax(0, 1fr); }
  .uses { grid-column: 2; text-align: left; }
  .tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media print {
  @page { size: A4; margin: 12mm; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { background: var(--grey-0); }
  .report { max-width: none; padding: 0; border: 0; min-height: 0; }
  .row, .group, .tile, .overview, tr { break-inside: avoid; }
  h2, h3 { break-after: avoid; }
}
`;
