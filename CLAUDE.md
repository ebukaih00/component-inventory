# CLAUDE.md — Component Inventory

A Chrome extension (Manifest V3) that inventories the UI of **your own product** while you browse it.
Two views. **Board** (the default): the user clicks components on the page to collect them, sorts them into
groups like screenshots on a Figma board, and the extension counts where each group is used and shows how
its versions differ. **Auto-detect**: the extension scans pages itself and sorts what it finds into buckets.
The core bet is now **the person decides what a component is; the machine counts and compares**.
Detection is still useful, but as the assistant behind Find similar, not as the inventory.
Full spec: `docs/spec.md`. Visual rules: `DESIGN.md`.

## Stack

TypeScript · Vite 7 + CRXJS 3 · Preact (side panel) · IndexedDB via `idb` · Vitest · Playwright.

## Commands

| Command | What |
| --- | --- |
| `npm run dev` | Vite dev server with HMR; load `dist/` unpacked in `chrome://extensions` |
| `npm run build` | Production extension in `dist/` |
| `npm test` | Unit tests (Vitest) — fast, no browser |
| `npm run test:e2e` | Builds `dist-e2e/` and runs Playwright against the fixture site |
| `npm run typecheck` | TypeScript check |
| `npm run check` | typecheck + unit tests. Run before every commit |
| `npm run build:spike` | `dist-spike/inventory-spike.js`, the DevTools paste-in script |
| `npm run fixtures:snapshot` | Re-record `tests/snapshots/*.json` from the fixture site in Chromium |
| `npm run fixtures:serve` | Serve `fixtures/site` on :4173 to browse it by hand |

## Layout

```
src/detect/      Pure detection library: classify, fingerprint, distance, thresholds, report (buckets), export,
                 collection.ts (the board: captures, groups, versions, Find similar matching)
src/export/      Pure exports: board.ts (bucket/kind model), report-html.ts (Auto-detect report),
                 board-html.ts (Board report)
src/content/     Content script + DOM collector (the ONLY place the page DOM is read) + highlight overlay,
                 picker.ts (once / collect modes), board.ts (collect an element, Find similar)
src/background/  Service worker: record mode, permissions, screenshots, crops
src/storage/     IndexedDB (one inventory per domain)
src/sidepanel/   Review UI
src/spike/       DevTools spike entry
src/shared/      Message types
fixtures/        Fixture site + answer-key.json; fixtures/spa is an e2e-only never-quiet single-page app
tests/unit       Vitest; tests/snapshots are real-browser candidate dumps; tests/e2e Playwright
```

## Rules

- `src/detect` stays pure TypeScript: no DOM globals, no `chrome.*`. DOM reading lives in `src/content/collect.ts`.
- **Every detection change comes with a fixture test.** Plant the case in `fixtures/site`, add it to
  `fixtures/answer-key.json`, run `npm run fixtures:snapshot`, then `npm test`. The answer-key test also
  fails on any unplanted detection (false positive).
- Thresholds live only in `src/detect/thresholds.ts`. They are the spike's tuning knobs.
- UI uses only tokens from `src/styles/tokens.css`. See `DESIGN.md`.
- Hold the Out list: no token extraction, code generation, AI naming, hover/focus/disabled states,
  breakpoints, sync or accounts.
- Local-first: no network calls, ever. No `<all_urls>` in the production manifest.

## Key decisions (and why)

- **The board is the default view.** Auto-detect was noisy on real sites (unnamed "Button 2"s, previews of
  dots). On the board everything was picked by a person, so nothing needs cleaning up. Auto-detect stays as the
  second view.
- **Collecting keeps the picker on** until Esc (or Alt+Shift+C). Clicks are swallowed, so a link click collects
  the link instead of navigating; Esc pauses to click around. Hovering a button's label or icon **snaps** to
  the button (up to 4 levels, `snap()` in `picker.ts`); ↓ gets back to the part.
- **Collected = Capture; identical captures are one Version** (`styleKey`: the variant key without structure
  for containers, since cards differ in content). Collecting the same element again updates it (id = url + selector).
- **Find on this page** compares every element with the group's tag: all of a capture's stable classes, or a
  near-identical style (thresholds as near-duplicates; containers need `findStructure` similarity). Unstyled
  divs need classes. It counts matches per screen (`Group.usage`) and collects one of each new style as a
  `found` capture, so drift shows up as versions.
- **Deleting a group keeps its components** (they go back to Unsorted). Board data lives in the `groups` and
  `captures` stores (DB version 2); Delete board leaves Auto-detect's data alone.

- **Kinds:** button, link, input, badge, icon, avatar, card, alert, table, nav (tabs, breadcrumb,
  pagination), menu, dialog, progress. Icons are detected inside buttons too (icon sizes drift); images
  are only components when they're avatars.
- **Buckets:** Reused (`common`) = used 2+ times anywhere; Near-duplicates (`couldBeOne`) = look-alike
  groups only; One-off (`oneOff`) = used once. Internal keys kept their old names; labels and the one-line
  explanations live in `src/detect/labels.ts` (`BUCKETS`). A pattern repeated on one screen is Reused,
  not a merge candidate.
- **Variant = exact match** on kind + subkind + normalised style (+ structure for card/table/nav/menu/dialog).
  Height counts only for button/input/badge/icon/avatar/progress; containers grow with content. Underline
  is part of the key for links only, so other kinds' variant ids didn't change when links were added.
- **Near-duplicate** = same kind/subkind, 1–3 differing properties, each within its threshold.
  Padding counts as one property. Colours compare by ΔE over white.
- **Screens are route patterns** (`/projects/42` → `/projects/:id`).
- **Tabs and navigation are detected as containers** (`[role=tablist]`, `nav`), not per tab, so
  selected/unselected states don't become separate variants (states are out of scope).
- **Variant ids are deterministic** (hash of inventory + key), so the content script can map its
  elements to stored variants for highlighting without a round trip.
- **Thumbnails need `activeTab`.** `captureVisibleTab` refuses with host permissions alone. Opening the
  panel from the toolbar icon (or Alt+Shift+S) grants it for that tab; elsewhere the panel shows a hint.
  The e2e build alone adds `<all_urls>` because Playwright can't click the toolbar.
- **The toolbar click is handled in `action.onClicked`**, not `openPanelOnActionClick`: that behaviour
  doesn't grant `activeTab`, so the panel couldn't read the tab's URL. The handler opens the panel itself.
- Thumbnails are PNG because Figma's `createImage` takes PNG/JPEG/GIF only.
- **Cards are found by repetition of a design, not identical HTML:** boxed siblings with the same tag
  and either the same structure, or the same box shape (radius, border width, shadow; colours ignored)
  and ≥ 0.6 structure similarity. Pricing cards differ in content and the highlighted one in border
  colour; the old identical-structure rule missed all of them on heidihealth.com.
- **Hand-picked components are rules, not instances** (`Inventory.rules`, `src/detect/rules.ts`): "everything
  like this" = same tag + all its stable classes (`cleanClassTokens`) on every page; "only this element" =
  selector + path. Rules beat the classifier in the collector, so picks survive rescans and get grouped,
  bucketed and previewed like anything detected. No stable classes → only-this-element.
- **Oversized components are previewed by their leading part:** taller (wider) than the window → crop the
  top (left) part once that edge is on screen, at most as tall as wide. Scan this page scrolls them to
  `start`, and takes up to 80 screenshots.
- **Record mode rescans can't be starved.** DOM changes debounce a rescan (1.2s) but can delay it by at
  most 3s, and a URL change (SPA navigation, polled every 300ms) scans after 0.7s whatever else changes.
  Sites with tickers, video or carousels never go quiet; before this, their in-app navigations were missed.
- **A screenshot is dropped if the tab changed page while it waited** for Chrome's capture rate limit;
  otherwise crops measured on one page were cut from the next.
- **The HTML report is one file with nothing fetched:** tokens inlined, thumbnails as `data:` URLs (only
  `data:image/…;base64` is embedded), a CSP meta tag, no scripts, every user string escaped. Page URLs are
  text, not links. Vitest needs `css.include` for `tokens.css?raw`, or the tokens come through empty.
