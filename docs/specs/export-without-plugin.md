# Export without a plugin

Nov 2026 · status: ready to build

## Why

Today the only polished export is the Figma board, and that needs the companion plugin. A second install
is friction, and some readers (DS leads, agency clients) don't have Figma open at all.
After this change, nobody needs to install anything to share or use an inventory. The plugin becomes
the upgrade for a fully editable board.

## What changes

| Export | For | Needs | Status |
| --- | --- | --- | --- |
| **Save report** (HTML) | Sharing evidence, client audits, PDF via print | Nothing | New, default share format |
| **Copy for Figma** (SVG paste) | Getting the board into Figma | Nothing | Changed: copies SVG, not JSON |
| Figma plugin | A fully editable auto-layout board | Plugin | Kept; reads JSON |
| Download JSON | Carrier for the plugin | Nothing | Moved into a "More" menu |

**Side panel footer:** `More ▾` (Download JSON, Delete inventory) · `Save report` (secondary) ·
`Copy for Figma` (primary). The menu is the only element allowed `--shadow-menu` (DESIGN.md).
Toast after copying: "Copied. Paste into any Figma file (⌘V)."

## Build

### 1. Share one board model

Move `figma-plugin/src/board.ts` to `src/export/board.ts`, and point the plugin at its new path.
The HTML report, the SVG and the plugin all render this one model, so the three exports always agree.
Keep it pure: no DOM, no `chrome.*`, no `URL` (the Figma sandbox has none).

### 2. HTML report: `src/export/report-html.ts`

`renderReportHtml(exp: InventoryExport): string`, a pure function that returns one self-contained file.

- **Content:** header (domain, export date, screens and pages scanned); the summary bar; then three bucket
  sections in panel order. Each row shows thumbnails, name, uses, screens and the style summary.
  Could-be-one groups show diff chips and the variants side by side. One-offs show their closest match.
- **Styling:** inline the tokens (`import tokens from '../styles/tokens.css?raw'`). Same type scale and
  bucket colours as the panel. Thumbnails sit on the checkerboard.
- **Self-contained:** thumbnails stay as `data:` URLs. No scripts, no external fonts, nothing fetched.
  Add `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">`.
- **Safe:** escape every user string (names come from renames). Page URLs are text, not links.
- **Print:** an `@media print` block with no sticky elements, `break-inside: avoid` on rows and groups,
  and A4 width.
- **Download name:** `inventory-<domain>-<yyyy-mm-dd>.html`.

### 3. Go/no-go: test SVG paste in Figma first (about 1 hour)

Before building step 4, paste a hand-made SVG into Figma and check:

1. Does pasting SVG text (`text/plain`) create layers? And `image/svg+xml` via `ClipboardItem`?
2. Do `<image href="data:image/png;base64,…">` thumbnails survive the paste?
3. Does `<text>` stay editable text in Inter?

Write the results at the bottom of this file. If thumbnails don't survive, keep text and boxes, and draw
a "No preview" tile in their place. Keep the plugin as the way to get a board with images.

### 4. SVG board: `src/export/board-svg.ts`

`renderBoardSvg(board: Board): string`, a pure function with the same layout as the plugin board: a title,
then three bucket sections side by side, 560px columns, the 4px grid, and grouped by kind.

- No text measuring (it's pure): fixed column widths, single-line text, truncated by character count
  with `…`. Thumbnails are 48px tall, with width from the image's aspect ratio. The ratio is read when
  the thumbnail is cropped; store `{ w, h }` with the thumbnail.
- Each section and row is a `<g id="…">`, so it pastes as named groups.
- Copy with `navigator.clipboard.write`. Use whichever format step 3 showed works, with `text/plain` as the fallback.

## Out of scope

Saved versions and before/after diffs (v2) · CSV · PNG export · publishing the plugin to Community
(a separate task, not code) · any upload or share link (local-first).

## Tests

Follow `CLAUDE.md`: `npm run check` before every commit.

- **Unit, `tests/unit/report-html.test.ts`:** built from the fixture snapshots (see `board.test.ts`).
  Asserts:
  - the summary shows 4 screens · 7 common · 2 could be one · 5 one-off
  - a renamed variant `<script>x</script>` comes out escaped
  - the output has no `<script` and no `src="http`
  - the CSP meta tag is present
- **Unit, `tests/unit/board-svg.test.ts`:** one `<g>` per bucket section, the diff chip text
  `radius 4 · 6 · 8` is present, and long names are truncated.
- **e2e, added to `record.spec.ts`:**
  - Save report: catch the download, open it in a page, check the bucket headings and counts.
    Then check that no network requests happen when it opens.
  - Copy for Figma: grant `clipboard-read`, click, and check the clipboard starts with `<svg`.
    Load that SVG in a page to check it's well-formed.
- **Manual:** paste into a real Figma file, check the result against step 3's findings, and attach a screenshot to the PR.

## Done when

- A designer can share an inventory, or get it into Figma, without installing anything.
- The report opens offline and prints to a clean PDF.
- The panel footer matches this spec, and README, `CLAUDE.md` (key decisions) and `DESIGN.md` (menu) are updated.

## Build order (one Claude Code session each, plan mode first)

1. Board model move (no behaviour change; all tests still pass)
2. HTML report, plus the Save report button and its tests
3. Footer "More" menu
4. SVG paste go/no-go (manual; record findings here)
5. SVG board and Copy for Figma, plus tests
6. Docs updates

## Findings: SVG paste test (fill in at step 4)

- text/plain SVG →
- image/svg+xml →
- embedded PNG thumbnails →
- text editable →
