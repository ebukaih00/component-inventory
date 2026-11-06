/**
 * The board, page side: describe a clicked element, screenshot it, and find more like a group's
 * components on this page.
 */
import { cleanClassTokens, matchAny, styleKey, type CaptureDraft, type Matcher } from '../detect';
import type { CollectResponse, ContentToWorker, FindResponse, WorkerToContent } from '../shared/messages';
import { isShown, OVERLAY_HOST_ID, readStyle, selectorPath, structureOf } from './collect';
import { bringIntoView, cropRect, nextFrames } from './geometry';
import { clearHighlight, highlight } from './overlay';
import { describe, suggest } from './picker';

const send = <T>(msg: ContentToWorker) => chrome.runtime.sendMessage(msg) as Promise<T>;

/** At most this many elements of a tag are compared per Find, so huge pages stay responsive. */
const MAX_COMPARED = 4000;
/** And at most this many new versions are collected per Find. */
const MAX_NEW_VERSIONS = 12;

export function draftOf(el: Element): CaptureDraft {
  const r = el.getBoundingClientRect();
  return {
    kind: suggest(el),
    tag: el.tagName.toLowerCase(),
    classes: cleanClassTokens(Array.from(el.classList)),
    selector: selectorPath(el),
    url: location.href,
    title: document.title,
    fingerprint: { structure: structureOf(el), style: readStyle(getComputedStyle(el), r), classes: cleanClassTokens(Array.from(el.classList)) },
    width: Math.round(r.width),
    height: Math.round(r.height),
    label: describe(el),
  };
}

/** Screenshot the element and store it. Resolves with the line to confirm on the page. */
export async function collectElement(el: Element, opts: { source: 'picked' | 'found'; groupId?: string | null; kind?: Matcher['kind'] }): Promise<CollectResponse> {
  const draft = draftOf(el);
  if (opts.kind) draft.kind = opts.kind; // found by a group: compare as the group's kind
  clearHighlight();
  await bringIntoView(el);
  await nextFrames(); // let the picker outline disappear before the screenshot
  const res = await send<CollectResponse>({ type: 'collect', draft, rect: cropRect(el), dpr: devicePixelRatio, source: opts.source, groupId: opts.groupId });
  if (!res?.ok) throw new Error(res?.error ?? 'Couldn’t add this one');
  return res;
}

export function collectedLine(res: CollectResponse): string {
  const where = res.groupName ? `to ${res.groupName}` : 'to Unsorted';
  const verb = res.added ? 'Added' : 'Already collected, updated';
  return `${verb} ${where}${res.preview ? '' : ' · no preview (click the extension icon once to allow screenshots)'}`;
}

/** Every element on the page that matches the group, outermost only, in page order. */
function findMatches(matchers: Matcher[]): { el: Element; same: boolean; key: string }[] {
  const tags = [...new Set(matchers.map((m) => m.tag))];
  const kind = matchers[0].kind;
  const out: { el: Element; same: boolean; key: string }[] = [];
  for (const tag of tags) {
    const els = Array.from(document.getElementsByTagName(tag)).slice(0, MAX_COMPARED);
    for (const el of els) {
      if (el.closest(`[id^="${OVERLAY_HOST_ID}"]`)) continue;
      const cs = getComputedStyle(el);
      if (!isShown(el, cs)) continue;
      const r = el.getBoundingClientRect();
      const fingerprint = { structure: structureOf(el), style: readStyle(cs, r), classes: cleanClassTokens(Array.from(el.classList)) };
      const m = matchAny(matchers.filter((x) => x.tag === tag), { tag, classes: fingerprint.classes, fingerprint });
      if (m) out.push({ el, same: m === 'same', key: styleKey({ kind, fingerprint }) });
    }
  }
  // A match inside another match (a card in a card) counts once.
  const kept = out.filter((a) => !out.some((b) => b !== a && b.el.contains(a.el)));
  return kept.sort((a, b) => (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
}

export async function findSimilar(msg: Extract<WorkerToContent, { type: 'find-similar' }>): Promise<Omit<FindResponse, 'route'>> {
  if (msg.matchers.length === 0) return { ok: true, count: 0, added: 0 };
  const matches = findMatches(msg.matchers);
  const known = new Set(msg.known);
  const start = { x: scrollX, y: scrollY };
  let added = 0;
  try {
    for (const m of matches) {
      if (known.has(m.key) || added >= MAX_NEW_VERSIONS) continue;
      known.add(m.key);
      const res = await collectElement(m.el, { source: 'found', groupId: msg.groupId, kind: msg.matchers[0].kind }).catch(() => null);
      if (res?.added) added++;
    }
  } finally {
    if (added) scrollTo({ left: start.x, top: start.y, behavior: 'instant' as ScrollBehavior });
  }
  highlight(matches.map((m) => m.el));
  return { ok: true, count: matches.length, added };
}

export function highlightSelectors(selectors: string[]): number {
  const els: Element[] = [];
  for (const s of selectors) {
    try {
      const el = document.querySelector(s);
      if (el && !els.includes(el)) els.push(el);
    } catch {
      /* a selector from an older layout */
    }
  }
  return highlight(els);
}
