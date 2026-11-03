# Component Inventory

> Find every version of every component in your product, and see which ones should be the same.

A Chrome extension that inventories your product's UI while you browse it. It sorts every button,
input, badge, card, table and tab/nav it finds into three buckets:

| Bucket | Rule |
| --- | --- |
| **Common** | The same variant appears on 2 or more screens |
| **Could be one** | Near-duplicates (for example radius 4 · 6 · 8), or a pattern repeated on one screen only |
| **One-off** | Appears once; shows the closest existing component |

Review in the side panel (merge, split, rename, ignore, click to highlight on the page), then export
to a Figma board with the companion plugin. Everything stays in your browser.

## Install (development)

```bash
npm install
```

```bash
npm run build
```

Then open `chrome://extensions`, turn on Developer mode, choose **Load unpacked** and pick `dist/`.

## Use

1. Open your product and click the **Component Inventory** toolbar icon. The side panel opens.
2. **Start recording.** Chrome asks for access to that one domain. Browse as usual, including logged-in
   pages: each page is scanned when it loads and again after the DOM changes.
3. Or use **Scan this page** (or Alt+Shift+S) for a one-off scan. A manual scan also scrolls through the
   page to capture previews.
4. Review: click a row to outline its instances on the page. Double-click a name to rename it. In a
   *Could be one* group, **Keep this** merges the others into that variant, and **Not the same** splits one out.
   **Ignore** hides a row, and you can restore it later.
5. **Copy for Figma**, then in Figma run the plugin and paste. Or use **Download JSON**.

Previews come from screenshots of the visible tab. Chrome only allows these in a tab where you clicked
the toolbar icon or used the shortcut. If previews are missing, the panel tells you.

## Figma plugin

```bash
npm run build:figma
```

In Figma: *Plugins → Development → Import plugin from manifest…* → `figma-plugin/manifest.json`.
The board has one section per bucket, grouped by kind, with a row per variant (thumbnails, uses, screens,
style summary). The plugin has no network access.

## Detection spike

```bash
npm run build:spike
```

Paste `dist-spike/inventory-spike.js` into DevTools on a real screen, then:

```js
__ci.scan()                 // scan, group, print buckets
__ci.highlight('v_…')       // outline a variant's instances
__ci.mark('v_…', true)      // record a cluster as right/wrong; __ci.score() for the tally
__ci.thresholds.radius = 2; __ci.report()   // retune without rescanning
__ci.save(); /* next page */ __ci.load(); __ci.scan()   // build up several pages (same origin)
```

## Tests

| Level | Command |
| --- | --- |
| Unit, including the fixture answer key | `npm test` |
| End to end (unpacked extension + fixture site) | `npm run test:e2e` |

Fixture site: `fixtures/site`, answer key: `fixtures/answer-key.json`.

## Privacy

No server and no network requests. Scans, screenshots and edits are stored in the extension's
IndexedDB on this machine. Host access is requested per domain, only when you record or scan it.

See `CLAUDE.md` for architecture and conventions, `DESIGN.md` for the visual rules, `docs/spec.md` for the spec.
