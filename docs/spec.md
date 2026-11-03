# Component Inventory Extension — Build Spec

Nov 3, 2026 · @Chukwuebuka Ihueze

## Summary

Build a Chrome extension that inventories the UI of **your own product** while you browse it. It groups near-identical elements into components and variants, and flags the inconsistencies. You then export the result as a Figma board.

The core bet is clustering, not extraction. Plenty of tools already pull tokens or a single component off a page. None tell you that you have 14 buttons that should be 3.

**Size:** a small-to-medium side project, about 65 hours with Claude Code, over roughly 10 weeks at 8 hours a week (the beta is mostly waiting on testers). It starts with a 2-week detection spike that decides whether to continue.

## Problem and who it's for

Today an interface inventory is manual: screenshot every screen, paste the crops onto a canvas, then sort them by hand. The sorting is the slow part, and that is the part this tool does.

**Primary user:** a product designer setting up or cleaning up a design system on an existing product. They often have no access to the code, or the product is legacy.

**Secondary users:** agencies auditing a client's app in week one, and DS leads who need evidence ("17 button styles across 40 screens") to win time for consolidation.

**How it differs from existing tools:**

| Tool | What it does | Gap this fills |
| --- | --- | --- |
| [html.to.design](https://html.to.design/blog/from-web-to-figma) | Imports pages, or a component you pick, into Figma | You still find and sort every component yourself |
| [Browser Extractor](https://chromewebstore.google.com/detail/browser-extractor/ccfcmcgjlkdnjjkmgjahdefgfaddpjjc), [Webmimic](https://chromeboard.com/extension/webmimic-bbpgmiacfpaedefjadkebhjnoeakkono) | Extract tokens, colours, fonts and audits from a page | Built for one page and for inspiration, not a whole product inventory |
| [Magic Patterns](https://www.chatprd.ai/how-i-ai/workflows/how-to-instantly-create-reusable-components-from-a-live-website) | Turns a clicked element into a React component | Works one element at a time; it doesn't compare elements |

**Positioning line:** "Find every version of every component in your product, and see which ones should be the same."

## Core user flow

You browse normally, and the extension collects the inventory in the background.

&#91;embedded content: core flow · 4 steps, 1 loop\]

Record mode also gets around logins: it scans what you can already see, so nothing has to be crawled.

## MVP scope

The MVP covers six component kinds, inventoried across many pages, with an export to Figma. Anything that competes with existing extraction tools is left out.

**In**

- Record mode: scans each page as you browse, including logged-in pages, plus a manual "scan this page" button
- Six kinds: buttons, form inputs (text, select, checkbox, toggle), badges and tags, cards, tables, tabs and navigation
- Grouping into kind, then variant, with near-duplicates flagged as "probably the same"
- For each variant: instance count, the pages it appears on, up to 3 cropped thumbnails, and a style summary (font, padding, radius, colours)
- Review in a side panel: merge, split, rename and ignore
- Export: JSON, plus a Figma board made through a companion plugin
- Local-first: everything stays in the browser

**Out (v2 or never)**

- Token extraction, code generation and AI naming (crowded, and off the core bet)
- Hover, focus and disabled states; responsive breakpoints
- Team sync, accounts and sharing
- Pitching it as a tool for scanning other people's sites

## Output: what you see

The output is visual, not code. Every component found lands in one of three buckets, and that sorting is the main view. Component kind (button, card and so on) is a filter on top.

| Bucket | Rule | What it shows | What you do with it |
| --- | --- | --- | --- |
| Common | The same variant appears on 2 or more screens | Thumbnail, name, use count, screens | Document it as a system component |
| Could be one | Near-duplicates (slight style differences), or a pattern repeated on one screen only | The variants side by side, what differs (for example, radius 4 / 6 / 8px), total uses | Consolidate into one component with variants |
| One-off | Appears once | Thumbnail, the screen, and the closest existing component | Replace it with the closest match, or keep it as bespoke |

A summary bar on top shows screens scanned and the count in each bucket.

**Where it appears**

- **Side panel (while you work):** review the buckets, merge, split, rename or ignore, and click a row to highlight its instances on the live page.
- **Figma board (the deliverable):** one section per bucket, built by the companion plugin. It replaces the screenshots-on-a-canvas board, already sorted.
- **JSON:** only the carrier between the extension and the Figma plugin. Users can download it, but never need to read it.

## Visual style

Define one, but keep it small: a token file and a one-page `DESIGN.md`, not a full design system. Your users are designers, and a generic AI look (indigo gradients, emoji, a card for everything) costs you their trust in the first five seconds.

**Principle:** a tool, not a landing page. It should be dense and quiet, and the screenshots supply the colour.

| Area | Rule |
| --- | --- |
| Colour | 8 neutral greys, 1 accent for actions. Three bucket colours (Common green, Could be one amber, One-off grey) are the only other hues, and they mean only that |
| Type | System font stack; 11, 12, 13 and 15px; weights 400 and 500 only; tabular numbers for counts |
| Space and shape | 4px grid; radius 4px on controls, 6px on tiles; 1px borders; no shadows except menus |
| Thumbnails | On a light checkerboard, so white components stay visible; fixed height, width follows the component |
| Components | List row, bucket header, thumbnail tile, count pill, diff chip ("radius 4 · 6 · 8"), 3 button styles, scanning, empty and error states |
| Figma board | Same tokens and type scale as the side panel |

Design the side panel's key screens yourself in Figma first: the bucket list, a "could be one" group, and the empty state. Then give Claude Code the tokens and screens, and do a review pass for generic patterns before each release.

## How detection works

Detection uses rules plus style fingerprints, with no ML in the MVP. It runs in four steps per page.

1. **Pick candidates.** Walk the DOM and keep visible elements that match a kind:
   - by semantics: `button`, `input`, `select`, `table`, `[role=tab]`, `nav`
   - by repetition: sibling elements with the same structure, such as a list of cards
   - Skip full-page wrappers, plain text and anything off screen or 0×0.
2. **Fingerprint each candidate.**
   - Structure: the tags of its children, 3 levels deep, with text removed
   - Style: computed font size and weight, padding, border radius, border, background, text colour and height
   - Class tokens, with hashed CSS-in-JS names removed
3. **Group them.**
   - Kind, from the rules in step 1
   - Variant: candidates whose style fingerprints match exactly
   - Near-duplicate: variants whose style differs only slightly (for example, a radius 2px apart or a nearly identical colour) are flagged as "probably the same". This is the headline insight.
4. **Record and capture.** Save each instance's page URL, route pattern and position. Crop a thumbnail for the first 3 instances of each variant from a screenshot of the visible tab.

The distance thresholds in step 3 are the main thing the spike has to tune.

## Architecture

The system has two deliverables: a Manifest V3 Chrome extension and a small Figma plugin that reads its export. The stack is TypeScript, Vite with CRXJS, and Preact or React for the side panel.

| Part | Job |
| --- | --- |
| Content script | Picks candidates, fingerprints them and reports instances with their positions |
| Service worker | Coordinates scans on navigation, takes visible-tab screenshots and crops thumbnails |
| Side panel | Review UI: the three buckets, filtered by kind; merge, split, rename and ignore; export |
| IndexedDB | Stores one inventory per product, locally |
| Figma plugin | Imports the JSON and builds the board: a section per kind, a row per variant, with thumbnails, counts and pages |

**Data model**

- `Inventory` — id, name, domain
- `Page` — url, routePattern, scannedAt
- `Variant` — id, kind, fingerprint, styleSummary, thumbnails\[\], name, status (kept, merged or ignored), nearDuplicateOf\[\]
- `Instance` — variantId, pageId, selectorPath, rect

**Permissions:** use `activeTab` plus optional host permissions requested per product domain. Avoid blanket `<all_urls>`, which slows Chrome Web Store review and scares users.

## Phased plan and project size

This is about 65 hours of work with Claude Code; it would be around 100 without it. The figures assume about 8 hours a week alongside both jobs, so change them if your real hours differ.

&#91;embedded content: roadmap · 4 phases, 3 gates\]

Keep it this size by holding the Out list. The parts most likely to creep in are tokens, AI naming and states. Phase 1 also works well as the learn-by-doing project for your front-end block, so it doesn't have to be extra time on top.

## Building with Claude Code

Claude Code cuts most of the typing, so the plan drops to about 65 hours. What it doesn't cut is judging whether the clusters are right, tuning thresholds and running the beta.

**Set up the repo first**

- `CLAUDE.md`: what the product is, the stack, commands (dev, test, build), and rules. For example: the detection library stays pure TypeScript with no DOM globals outside the content script; every detection change comes with a fixture test.
- `DESIGN.md` plus a tokens file: the Visual style section above, with a rule to use only those tokens.
- `docs/spec.md`: this spec, exported.

**Build order (one task per session, plan mode first)**

1. Fixture site with an answer key (see Testing). This gives Claude Code something to check against.
2. Detection library: candidate picker, fingerprint, distance, bucketing. Pure functions with unit tests.
3. Spike: bundle the library into a script you paste into DevTools on real screens.
4. Extension shell: Manifest V3, Vite with CRXJS, content script, service worker.
5. Storage (IndexedDB) and record mode.
6. Side panel UI, built from your Figma screens and `DESIGN.md`.
7. Figma plugin that builds the board from the JSON.

Review each change before moving on. The detection logic is your product's value, so you need to understand it, not just accept it.

## Testing

Testing happens at five levels. The fixture site comes first because every other level depends on knowing the right answer.

| Level | What | Tool | Passes when |
| --- | --- | --- | --- |
| Fixture site | A small local site you build with planted components: shared buttons across 3 pages, 3 near-duplicate buttons, a card list on one page, a one-off. An answer key lists the expected bucket for each | Plain HTML, built by Claude Code | Exists before any detection code |
| Unit | Fingerprint, distance and bucketing functions | Vitest | Every answer-key item lands in its expected bucket |
| End to end | Load the unpacked extension, browse the fixture site in record mode, check the side panel and the JSON | Playwright | The JSON matches the answer key |
| Real products | MyFarm and Podfather screens, plus a public site with a published component list (for example, the GOV.UK Design System pages) as outside ground truth | Manual | You accept most clusters without edits |
| Users | 5 design-system designers inventory one product area each | Moderated sessions | Faster than their manual way; few corrections |

Check with Podfather and Frontier before running it on their products. Everything stays local, but it's still their UI and data.

## Risks and open questions

The biggest risk is grouping accuracy. If the clusters need heavy manual fixing, the tool saves no time over screenshots.

| Risk | Mitigation |
| --- | --- |
| Grouping is wrong on real products | The spike tests it on MyFarm and Podfather before anything else is built |
| Virtualised lists, lazy loading and modals get missed | Record mode rescans after DOM changes; the user can trigger a manual scan |
| Screenshots only cover the visible viewport and are rate-limited | Scroll each element into view and crop it; queue the captures; thumbnails stay optional |
| Screenshots of internal products contain sensitive data | Local-first, no server, a clear privacy note |
| Time: two jobs plus the Component Description Manager plugin | Finish or pause CDM first; treat this as the front-end learning project rather than an extra |

**Open questions**

- [ ] Free extension with a paid Figma export, or paid outright?
- [ ] Ship the Figma plugin separately, or fold it into the CDM plugin as one "audit, then document" suite?
- [ ] Name
- [ ] Do users need hover and focus states in v1? Ask in the user interviews.

## Success criteria and first steps

The first two weeks answer one question: does the grouping hold up on a real product?

**Criteria by phase** (proposed targets; adjust them once you have a baseline)

- Spike: on 3 or more real screens, you would accept most clusters without edits
- MVP: one product area is inventoried in under an hour, against your timed manual baseline
- Beta: 5 designers run it on their own product, and at least 3 would use it again

**First steps**

- [ ] Time your next manual inventory to get a baseline
- [ ] Write the candidate-picker and fingerprint script; run it from DevTools on 3 MyFarm screens
- [ ] Print the variant groups to the console; mark each right or wrong
- [ ] Tune the near-duplicate thresholds; rerun on 3 Podfather screens
- [ ] Decide: continue to the MVP, or stop
- [ ] Line up 5 design-system designers for interviews during Phase 1
