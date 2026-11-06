/**
 * The board as one self-contained HTML file: each group with its versions side by side, what
 * differs between them, and where they're used. Same rules as the inventory report: no scripts,
 * nothing fetched, data: images only, every string escaped.
 */
import tokens from '../styles/tokens.css?raw';
import { styleSummary, type BoardExport, type ExportVersion } from '../detect';
import { KIND_LABELS } from '../detect/types';
import { CSP, esc, HEX, SAFE_IMAGE } from './report-html';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function boardFileName(exp: BoardExport): string {
  return `board-${exp.domain}-${exp.exportedAt.slice(0, 10)}.html`;
}

export function renderBoardHtml(exp: BoardExport): string {
  const date = exp.exportedAt.slice(0, 10);
  const domain = esc(exp.domain);
  const s = exp.summary;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Component board · ${domain} · ${date}</title>
<style>
${tokens}
${CSS}
</style>
</head>
<body>
<main class="report">
<header class="report-header">
<p class="eyebrow">Component board</p>
<h1>${domain}</h1>
<p class="meta" data-testid="summary">Exported ${date} · ${plural(s.groups, 'group')} · ${plural(s.captures, 'component')} collected · ${plural(s.screens, 'screen')}</p>
</header>
${overview(exp)}
${exp.groups.map((g) => `<section class="group">
<h2>${esc(g.name)} <span class="count num">${plural(g.versions.length, 'version')}</span></h2>
<p class="meta">${g.uses > 0 ? `${plural(g.uses, 'use')} on ${plural(g.screens.length, 'screen')}: <span class="mono">${g.screens.map(esc).join('  ')}</span>` : 'Not counted yet'}</p>
${g.differs.length ? `<div class="chips">${g.differs.map((d) => `<span class="chip">${esc(d.prop)} ${esc(d.values.join(' · '))}</span>`).join('')}</div>` : ''}
${g.versions.length ? `<div class="tiles">${g.versions.map(tile).join('')}</div>` : '<p class="empty">Empty group.</p>'}
</section>`).join('\n')}
${exp.unsorted.length ? `<section class="group unsorted"><h2>Unsorted <span class="count num">${exp.unsorted.length}</span></h2><div class="tiles">${exp.unsorted.map(tile).join('')}</div></section>` : ''}
<footer class="report-footer meta">Made with Component Inventory. Generated in the browser; nothing in this file was uploaded.</footer>
</main>
</body>
</html>
`;
}

/** One sentence: how many groups, and which ones have drifted into several versions. */
function overview(exp: BoardExport): string {
  const drifted = exp.groups.filter((g) => g.versions.length > 1);
  const lead = `${plural(exp.summary.groups, 'group')} collected across ${plural(exp.summary.screens, 'screen')}.`;
  const rest = drifted.length
    ? ` ${drifted.length === 1 ? 'One comes' : `${drifted.length} come`} in more than one version: ${drifted.map((g) => `${esc(g.name)} (${g.versions.length})`).join(', ')}.`
    : exp.groups.length ? ' Every group is consistent: one version each.' : '';
  return `<section class="overview"><p class="takeaway">${esc(lead)}${rest}</p></section>`;
}

function tile(v: ExportVersion): string {
  const name = `${KIND_LABELS[v.kind]}${v.classes.length ? ` .${v.classes.slice(0, 2).join('.')}` : ''}`;
  const src = v.thumbnail && SAFE_IMAGE.test(v.thumbnail) ? v.thumbnail : null;
  const s = styleSummary(v.style);
  const parts = [
    ['Font', s.font], ['Padding', s.padding], ['Radius', s.radius], ['Background', s.background], ['Text', s.color], ['Border', s.border],
  ];
  return `<div class="tile">
${src ? `<span class="thumb"><img src="${src}" alt="${esc(name)}"></span>` : '<span class="thumb thumb-empty">No preview</span>'}
<p class="name">${esc(name)}${v.collected > 1 ? ` <span class="meta num">×${v.collected}</span>` : ''}</p>
<p class="meta mono">${v.screens.map(esc).join('  ')}</p>
${v.values.length ? `<p class="diff">${v.values.map((x) => esc(`${x.prop} ${x.value}`)).join(' · ')}</p>` : ''}
<dl class="style">${parts.map(([l, val]) => `<div><dt>${l}</dt><dd>${swatch(val)}${esc(val)}</dd></div>`).join('')}</dl>
</div>`;
}

function swatch(value: string): string {
  const hex = value.match(HEX)?.[0];
  return hex ? `<i class="swatch" style="background: ${hex}"></i>` : '';
}

/* Tokens only — see DESIGN.md. */
const CSS = `
* { box-sizing: border-box; }
html, body { margin: 0; }
body { font: var(--weight-regular) var(--text-12) / 1.45 var(--font); color: var(--grey-7); background: var(--grey-1); -webkit-font-smoothing: antialiased; }
p { margin: 0; }
.report { max-width: 1080px; margin: 0 auto; padding: var(--space-6); background: var(--grey-0); min-height: 100vh; border-left: var(--border); border-right: var(--border); }
.num { font-variant-numeric: tabular-nums; }
.meta { font-size: var(--text-11); color: var(--grey-5); }
.mono { font-family: var(--font-mono); }
.report-header { display: flex; flex-direction: column; gap: 2px; padding-bottom: var(--space-4); }
.eyebrow { font-size: var(--text-11); color: var(--grey-5); }
h1 { margin: 0; font-size: var(--text-15); font-weight: var(--weight-medium); }
.overview { padding: var(--space-4); border: var(--border); border-radius: var(--radius-tile); }
.takeaway { font-size: var(--text-13); max-width: 60em; text-wrap: pretty; }
.group { margin-top: var(--space-6); padding-top: var(--space-4); border-top: var(--border); display: flex; flex-direction: column; gap: var(--space-1); }
h2 { display: flex; align-items: baseline; gap: var(--space-2); margin: 0; font-size: var(--text-15); font-weight: var(--weight-medium); text-wrap: balance; }
.count { font-size: var(--text-12); font-weight: var(--weight-regular); color: var(--grey-5); }
.chips { display: flex; flex-wrap: wrap; gap: var(--space-1); margin-top: var(--space-1); }
.chip { font-size: var(--text-11); padding: 1px 6px; border-radius: var(--radius-control); background: var(--bucket-couldbeone-soft); color: var(--grey-7); font-variant-numeric: tabular-nums; }
.tiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-5) var(--space-4); margin-top: var(--space-3); }
.tile { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.thumb { display: flex; align-items: center; justify-content: center; width: 100%; height: 140px; margin-bottom: var(--space-2); padding: var(--space-2); border: var(--border); border-radius: var(--radius-tile); background: var(--checker); overflow: hidden; }
.thumb img { display: block; max-width: 100%; max-height: 100%; object-fit: contain; }
.thumb-empty { background: var(--grey-1); border-style: dashed; font-size: var(--text-11); color: var(--grey-5); }
.name { font-size: var(--text-13); font-weight: var(--weight-medium); overflow-wrap: anywhere; }
.diff { font-family: var(--font-mono); font-size: var(--text-11); color: var(--grey-7); }
.style { display: flex; flex-wrap: wrap; gap: 2px var(--space-3); margin: var(--space-1) 0 0; font-size: var(--text-11); }
.style div { display: inline-flex; align-items: center; gap: var(--space-1); min-width: 0; }
.style dt { color: var(--grey-5); }
.style dd { margin: 0; display: inline-flex; align-items: center; gap: 4px; font-family: var(--font-mono); overflow-wrap: anywhere; }
.swatch { display: inline-block; flex: none; width: 10px; height: 10px; border-radius: 2px; border: 1px solid var(--grey-3); }
.empty { color: var(--grey-5); }
.report-footer { margin-top: var(--space-6); padding-top: var(--space-3); border-top: var(--border); }
@media (max-width: 720px) {
  .report { padding: var(--space-4); border: 0; }
  .tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media print {
  @page { size: A4; margin: 12mm; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { background: var(--grey-0); }
  .report { max-width: none; padding: 0; border: 0; min-height: 0; }
  .tile, .overview { break-inside: avoid; }
  h2 { break-after: avoid; }
}
`;
