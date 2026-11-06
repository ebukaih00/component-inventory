# DESIGN.md — Component Inventory

**A tool, not a landing page.** Dense and quiet; the screenshots supply the colour.
Tokens live in `src/styles/tokens.css`.
Use only those tokens. Never hard-code a colour, size or radius in a component.

## Colour

| Token | Use |
| --- | --- |
| `--grey-0` … `--grey-7` | Everything: backgrounds (0–2), borders (3–4), secondary text (5–6), primary text (7) |
| `--accent` | Actions only: primary button, focus ring, selected filter, links |
| `--bucket-common` (green) | The **Reused** bucket — dot, bar segment. Nowhere else |
| `--bucket-couldbeone` (amber) | The **Near-duplicates** bucket and its diff chips. Nowhere else |
| `--bucket-oneoff` (grey) | The **One-off** bucket |

No gradients, no emoji, no extra hues. Errors use grey-7 text on `--bucket-couldbeone-soft`
with a plain-language message.

## Type

System font stack. Sizes 11 / 12 / 13 / 15 px only. Weights 400 and 500 only.
Counts always use `font-variant-numeric: tabular-nums`.

| Size | Use |
| --- | --- |
| 15 / 500 | Panel title (domain) |
| 13 / 500 | Bucket headers, variant names |
| 12 / 400 | Body, buttons, list rows |
| 11 / 400 | Meta: pages, diff chips, count pills, style summary |

## Space and shape

4px grid (`--space-1` … `--space-6`). Radius 4px on controls, 6px on tiles.
1px borders. No shadows except menus (`--shadow-menu`).

## Thumbnails

Always on the light checkerboard (`--checker`) so white components stay visible.
Fixed height (`--thumb-height`, 48px); width follows the component, capped by the row.

## Components

| Component | Rules |
| --- | --- |
| Summary | Scope line ("4 screens · 4 pages scanned"), then the **consistency bar**, then the bucket legend. The bar is the panel's signature: one segment per bucket, sized by count, 6px tall, 2px gaps. Counts appear here once; nowhere else repeats them as pills |
| List row | 1px top border, 8px vertical padding, hover `--grey-1`. Click (or Enter/Space) highlights instances on the page and opens details. Uses sit right-aligned as "**5** uses" |
| Row details | Indented to the text column. Style values in mono; any colour value gets a 10px swatch |
| Bucket header | Colour dot + 13/500 label + plain grey count. Collapsible. Below it, always visible when open, the bucket's one-line meaning and next step (11px, `--grey-6`, from `BUCKETS` in `labels.ts`) |
| Near-duplicate group | Headline in plain words ("3 buttons that look almost the same"), diff chips, then borderless tiles: thumbnail (a button), name, the differing value in mono, uses |
| Thumbnail tile | Checkerboard, 6px radius, 1px border. No preview: `--grey-1`, dashed border |
| Count pill | HTML report only. 11px, tabular nums, `--grey-2` background, 4px radius |
| Diff chip | "radius 4 · 6 · 8" — 11px, `--bucket-couldbeone-soft` background |
| Kind filter | Borderless text toggles (`aria-pressed`), 28px; selected uses `--accent-soft`. One row that scrolls sideways, fading at the right edge; the selected one scrolls into view |
| Buttons | 3 styles: **primary** (accent fill), **secondary** (1px border), **quiet** (text only, no padding, so it lines up with text) |
| Footer | **More** menu (Download JSON, Delete inventory) on the left, one primary action (**Save report**) on the right. The menu is the only element with `--shadow-menu`, besides the toast |
| Toast | Anchored just above the footer; rises in over 160ms |
| View switch | Top of the header: two segments (Board, Auto-detect) on `--grey-1`; the pressed one is `--grey-0` with a 1px `--grey-3` ring. Same weight in both states |
| Board group | Name (13/500, double-click to rename) with an **Edit** menu that opens downwards; meta line "2 versions · 5 uses on 3 screens"; diff chips; tiles; one secondary **Find on this page**. A drop target: `--accent-soft` with a 1px inset accent ring while dragging over it |
| Board tile | 80px checkerboard thumbnail (a button: outlines it on the page), kind + classes, screens in mono, the differing values in mono, then **Move to** and **Remove**. Draggable |
| Unsorted | Same as a group on `--grey-1`, always first. Shown only when something is unsorted |
| States | Scanning (inline progress text), empty (one sentence + one primary action; the privacy line lives here), error (message + retry) |

## Interaction details

- **Press:** buttons scale to `0.96` on `:active` (150ms ease-out, transform only).
- **Hit areas:** at least ~40px tall on desktop. Buttons extend theirs with a `::before` (`inset: -6px 0`;
  quiet buttons `-10px -5px`), never wide enough to reach a neighbour (gaps are 8–12px).
- **Stacking:** only `--z-sticky` (header, footer) and `--z-overlay` (menu, toast). No other z-index.
- **Remembered state:** collapsed buckets and the kind filter persist per site (`localStorage`) and are read
  before first paint. The panel renders nothing until it knows the tab, so it never flashes a wrong screen.
- **Text:** real punctuation (… ’ ×), `text-wrap: balance` on titles, `pretty` on hints.

## Motion

Only on feedback: menu pop (120ms), toast rise (160ms), chevron turn (150ms), colour transitions on hover (120ms),
the recording dot's slow pulse. All `ease-out`, transform/opacity only. `prefers-reduced-motion` turns all of it off.

## Review pass before each release

Look for: indigo/purple, gradients, emoji, cards-in-cards, shadows, centred hero text,
more than one accent, font sizes outside the scale.
