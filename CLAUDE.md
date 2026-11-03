# CLAUDE.md — Component Inventory

A Chrome extension (Manifest V3) that inventories the UI of **your own product** while you browse it.
It groups near-identical elements into components and variants, flags inconsistencies, and exports
a Figma board through a companion plugin. The core bet is **clustering, not extraction**.
Full spec: `docs/spec.md`. Visual rules: `DESIGN.md`.

## Stack

TypeScript · Vite 7 + CRXJS 3 · Preact (side panel) · IndexedDB via `idb` · Vitest · Playwright · esbuild (Figma plugin).

## Commands

| Command | What |
| --- | --- |
| `npm run dev` | Vite dev server with HMR; load `dist/` unpacked in `chrome://extensions` |
| `npm run build` | Production extension in `dist/` |
| `npm test` | Unit tests (Vitest) — fast, no browser |
| `npm run test:e2e` | Builds `dist-e2e/` and runs Playwright against the fixture site |
| `npm run typecheck` | Extension + Figma plugin |
| `npm run check` | typecheck + unit tests. Run before every commit |
| `npm run build:spike` | `dist-spike/inventory-spike.js`, the DevTools paste-in script |
| `npm run fixtures:snapshot` | Re-record `tests/snapshots/*.json` from the fixture site in Chromium |
| `npm run fixtures:serve` | Serve `fixtures/site` on :4173 to browse it by hand |
| `npm run build:figma` | `figma-plugin/dist/` (import `figma-plugin/manifest.json` in Figma) |

## Layout

```
src/detect/      Pure detection library: classify, fingerprint, distance, thresholds, report (buckets), export
src/content/     Content script + DOM collector (the ONLY place the page DOM is read) + highlight overlay
src/background/  Service worker: record mode, permissions, screenshots, crops
src/storage/     IndexedDB (one inventory per domain)
src/sidepanel/   Review UI
src/spike/       DevTools spike entry
src/shared/      Message types
figma-plugin/    Companion plugin; board.ts is a pure model, code.ts renders it
fixtures/        Fixture site + answer-key.json
tests/unit       Vitest; tests/snapshots are real-browser candidate dumps; tests/e2e Playwright
```

## Rules

- `src/detect` stays pure TypeScript: no DOM globals, no `chrome.*`, no `URL`-dependent code reachable from
  `figma-plugin` (the Figma sandbox has no `URL`). DOM reading lives in `src/content/collect.ts`.
- **Every detection change comes with a fixture test.** Plant the case in `fixtures/site`, add it to
  `fixtures/answer-key.json`, run `npm run fixtures:snapshot`, then `npm test`. The answer-key test also
  fails on any unplanted detection (false positive).
- Thresholds live only in `src/detect/thresholds.ts`. They are the spike's tuning knobs.
- UI uses only tokens from `src/styles/tokens.css` (Figma: `figma-plugin/src/tokens.ts`). See `DESIGN.md`.
- Hold the Out list: no token extraction, code generation, AI naming, hover/focus/disabled states,
  breakpoints, sync or accounts.
- Local-first: no network calls, ever. No `<all_urls>` in the production manifest.

## Key decisions (and why)

- **Variant = exact match** on kind + subkind + normalised style (+ structure for card/table/nav).
  Height counts only for button/input/badge; containers grow with content.
- **Near-duplicate** = same kind/subkind, 1–3 differing properties, each within its threshold.
  Padding counts as one property. Colours compare by ΔE over white.
- **Screens are route patterns** (`/projects/42` → `/projects/:id`). Common needs 2+ screens.
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
