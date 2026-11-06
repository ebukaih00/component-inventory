# Component Inventory

> Find every version of every component in your product, and see which ones should be the same.

A Chrome extension for auditing your product's UI while you browse it. Two ways to work:

- **Board** (default): click the components you see to collect them, and sort them into groups, like
  screenshots on a Figma board but without the screenshots. For each group, **Find on this page** counts where
  it's used and collects the versions that look different, and the group shows what differs ("radius 4 · 8").
- **Auto-detect**: the extension scans pages itself. It finds buttons, links, inputs,
badges, icons, avatars, cards, alerts and banners, tables, navigation (including tabs, breadcrumbs and
pagination), menus, dialogs and progress bars, and sorts every version into three buckets:

| Bucket | Rule | What to do |
| --- | --- | --- |
| **Reused** | The same variant is used 2 or more times, anywhere | Document it as a component |
| **Near-duplicates** | Variants that look almost the same (for example radius 4 · 6 · 8) | Merge each group into one component |
| **One-off** | Used once; shows the closest existing component | Swap it for the closest match, or keep it |

Menus and dialogs are inventoried when they are open on screen during a scan.

Review in the side panel (merge, split, rename, ignore, click to highlight on the page), then save a
report to share. Everything stays in your browser.

## Install (development)

```bash
npm install
```

`npm install` also builds the extension into `dist/` (the `prepare` script). The project root has no
`manifest.json`; it is generated from `manifest.config.ts` into `dist/`.

Open `chrome://extensions`, turn on Developer mode, choose **Load unpacked** and pick `dist/`, not the
project root. While you work, run `npm run dev` to keep `dist/` up to date, then reload the extension card.

## Use the board

1. Open your product and click the toolbar icon. The panel opens on **Board**.
2. **Collect**, then click components on the page. Each one is screenshotted and lands in **Unsorted** (or the
   group picked under **Add to**). Clicking a button's text or icon picks the button; ↑ selects the parent.
   Esc pauses so you can click around; Alt+Shift+C starts and stops collecting.
3. Make groups (**Add to → New group…**), and drag components into them or use **Move to**.
4. On any page, **Find on this page** in a group counts the matches there, outlines them, and collects each new
   version. The group shows versions, uses per screen, and the properties that differ.
5. **Save report** downloads one self-contained HTML board. **More → Download JSON** gives the raw data.

## Use Auto-detect

1. Open your product and click the **Component Inventory** toolbar icon. The side panel opens.
2. **Start recording.** Chrome asks for access to that one domain. Browse as usual, including logged-in
   pages: each page is scanned when it loads and again after the DOM changes.
3. Or use **Scan this page** (or Alt+Shift+S) for a one-off scan. A manual scan also scrolls through the
   page to capture previews.
4. Review: click a row to outline its instances on the page. Double-click a name to rename it. In a
   *Could be one* group, **Keep this** merges the others into that variant, and **Not the same** splits one out.
   **Ignore** hides a row, and you can restore it later.
5. Missed something? **Add element**, then click it on the page (↑ selects the parent). Say what it is, and
   whether to find everything that looks like it (same tag and classes, every page) or only that element.
   It's saved as a rule for the site and applied on every scan.
6. **Save report** downloads one self-contained HTML file: the summary, the three buckets with thumbnails,
   and the pages scanned. It opens offline in any browser and prints to PDF. **Download JSON** gives the raw data.

Previews come from screenshots of the visible tab. Components taller or wider than the window get a
preview of their top or left part; **Scan this page** scrolls to anything still missing one. Chrome only allows these in a tab where you clicked
the toolbar icon or used the shortcut. If previews are missing, the panel tells you.

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
