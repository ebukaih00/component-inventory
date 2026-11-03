# DESIGN.md — Component Inventory

**A tool, not a landing page.** Dense and quiet; the screenshots supply the colour.
Tokens live in `src/styles/tokens.css` (side panel) and `figma-plugin/src/tokens.ts` (board).
Use only those tokens. Never hard-code a colour, size or radius in a component.

## Colour

| Token | Use |
| --- | --- |
| `--grey-0` … `--grey-7` | Everything: backgrounds (0–2), borders (3–4), secondary text (5–6), primary text (7) |
| `--accent` | Actions only: primary button, focus ring, selected filter, links |
| `--bucket-common` (green) | The **Common** bucket — header dot, count pill. Nowhere else |
| `--bucket-couldbeone` (amber) | The **Could be one** bucket and its diff chips. Nowhere else |
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
| List row | 1px bottom border, 8px vertical padding, hover `--grey-1`. Click highlights instances on the page |
| Bucket header | Colour dot + 13/500 label + count pill. Collapsible |
| Thumbnail tile | Checkerboard, 6px radius, 1px border |
| Count pill | 11px, tabular nums, `--grey-2` background, 4px radius |
| Diff chip | "radius 4 · 6 · 8" — 11px, `--bucket-couldbeone-soft` background |
| Buttons | 3 styles: **primary** (accent fill), **secondary** (1px border), **quiet** (text only) |
| States | Scanning (inline progress text), empty (one sentence + one primary action), error (message + retry) |

## Figma board

Same tokens and type scale as the side panel (Inter stands in for the system stack).
One section per bucket; inside, a row per variant with thumbnails, count and pages.

## Review pass before each release

Look for: indigo/purple, gradients, emoji, cards-in-cards, shadows, centred hero text,
more than one accent, font sizes outside the scale.
