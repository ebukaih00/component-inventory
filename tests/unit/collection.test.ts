import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildBoardExport, makeCapture, matchElement, viewBoard, type CaptureDraft, type Kind, type StyleProps } from '../../src/detect';
import { renderBoardHtml } from '../../src/export/board-html';
import {
  createGroup, db, deleteBoard, deleteGroup, loadCollection, moveCaptures, putCapture, resetDbConnection, setCollectInto, setGroupUsage,
} from '../../src/storage/db';
import { baseStyle } from './helpers';

const INV = 'inv_app.test';
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

function draft(over: { style?: Partial<StyleProps>; tag?: string; classes?: string[]; kind?: Kind; url?: string; selector?: string; structure?: string } = {}): CaptureDraft {
  const tag = over.tag ?? 'button';
  return {
    kind: over.kind ?? 'button',
    tag,
    classes: over.classes ?? ['btn'],
    selector: over.selector ?? `body > ${tag}`,
    url: over.url ?? 'https://app.test/projects/42',
    title: 'Projects',
    fingerprint: { structure: over.structure ?? tag, style: { ...baseStyle, ...over.style }, classes: over.classes ?? ['btn'] },
    width: 100,
    height: 36,
    label: `${tag}.btn`,
  };
}

const matcher = (d: CaptureDraft) => ({ kind: d.kind, tag: d.tag, classes: d.classes, fingerprint: d.fingerprint });
const cand = (d: CaptureDraft) => ({ tag: d.tag, classes: d.classes, fingerprint: d.fingerprint });

describe('Find similar: matchElement', () => {
  it('same classes and style is the same component; same classes, other style is another version', () => {
    expect(matchElement(matcher(draft()), cand(draft()))).toBe('same');
    expect(matchElement(matcher(draft()), cand(draft({ style: { radius: 12, background: '#000000ff' } })))).toBe('similar');
  });

  it('without shared classes, a look-alike is a version and anything else is unrelated', () => {
    const m = matcher(draft({ classes: [] }));
    expect(matchElement(m, cand(draft({ classes: ['x'], style: { radius: 8 } })))).toBe('similar');
    expect(matchElement(m, cand(draft({ classes: ['x'], style: { fontSize: 20, background: '#ff0000ff', radius: 20 } })))).toBeNull();
    expect(matchElement(m, cand(draft({ tag: 'a', classes: [] })))).toBeNull();
  });

  it('an unstyled div needs its classes: style alone would match half the page', () => {
    const plain = { background: '#00000000', borderStyle: 'none', shadow: false };
    const m = matcher(draft({ tag: 'div', kind: 'card', classes: [], style: plain, structure: 'div(span,span)' }));
    expect(matchElement(m, cand(draft({ tag: 'div', classes: [], style: plain, structure: 'div(span,span)' })))).toBeNull();
    const withClass = matcher(draft({ tag: 'div', kind: 'card', classes: ['stat'], style: plain, structure: 'div(span,span)' }));
    expect(matchElement(withClass, cand(draft({ tag: 'div', classes: ['stat', 'big'], style: plain, structure: 'div(span,span)' })))).toBe('same');
  });

  it('cards must share most of their structure', () => {
    const m = matcher(draft({ tag: 'div', kind: 'card', classes: ['card'], structure: 'div(h3,p,button)' }));
    expect(matchElement(m, cand(draft({ tag: 'div', classes: ['card'], structure: 'div(h3,p,p,button)' })))).toBe('same');
    expect(matchElement(m, cand(draft({ tag: 'div', classes: ['card'], structure: 'div(table(tr+))' })))).toBeNull();
  });
});

describe('board view', () => {
  const group = { id: 'g1', inventoryId: INV, name: 'Primary button', createdAt: 1, usage: {} as Record<string, number> };
  const caps = [
    makeCapture(INV, draft({ selector: 'a' }), 'g1', 'picked', PNG, 1),
    makeCapture(INV, draft({ selector: 'b', url: 'https://app.test/settings' }), 'g1', 'picked', null, 2),
    makeCapture(INV, draft({ selector: 'c', style: { radius: 8 } }), 'g1', 'picked', PNG, 3),
    makeCapture(INV, draft({ selector: 'd', style: { radius: 4, paddingLeft: 12, paddingRight: 12 } }), null, 'picked', null, 4),
  ];

  it('collapses identical captures into versions and lists what differs', () => {
    const b = viewBoard({ groups: [group], captures: caps });
    const g = b.groups[0];
    expect(g.versions.map((v) => v.captures.length)).toEqual([2, 1]);
    expect(g.versions[0].screens).toEqual(['/projects/:id', '/settings']);
    expect(g.differs).toEqual([{ prop: 'radius', values: ['6', '8'] }]);
    expect(g.versions[1].values).toEqual([{ prop: 'radius', value: '8' }]);
    expect(b.unsorted).toHaveLength(1);
    expect(b.summary).toEqual({ groups: 1, versions: 2, captures: 4, screens: 2 });
  });

  it('uses: what Find counted per screen, never less than what was collected there', () => {
    const g = viewBoard({ groups: [{ ...group, usage: { '/projects/:id': 7, '/billing': 3 } }], captures: caps }).groups[0];
    expect(g.uses).toBe(7 + 1 + 3);
    expect(g.screens).toEqual(['/billing', '/projects/:id', '/settings']);
  });

  it('a capture whose group is gone shows in Unsorted', () => {
    expect(viewBoard({ groups: [], captures: caps }).unsorted.flatMap((v) => v.captures)).toHaveLength(4);
  });
});

describe('board storage', () => {
  beforeEach(async () => {
    (await db()).close();
    indexedDB.deleteDatabase('component-inventory');
    resetDbConnection();
  });

  it('groups, moves, re-collects without duplicates, and deleting a group keeps its components', async () => {
    const g = await createGroup('app.test', 'Buttons', 10);
    await setCollectInto('app.test', g.id);
    const c = makeCapture(INV, draft(), g.id, 'picked', PNG, 1);
    expect((await putCapture(c)).added).toBe(true);
    expect((await putCapture({ ...c, thumbnail: null, createdAt: 99 })).added).toBe(false);
    let s = (await loadCollection(INV))!;
    expect(s.captures).toHaveLength(1);
    expect(s.captures[0]).toMatchObject({ createdAt: 1, thumbnail: PNG }); // keeps the first date and preview
    expect(s.inventory.collectInto).toBe(g.id);

    await setGroupUsage(g.id, '/projects/:id', 5);
    await moveCaptures([c.id], null);
    await moveCaptures([c.id], g.id);
    await deleteGroup(g.id);
    s = (await loadCollection(INV))!;
    expect(s.groups).toHaveLength(0);
    expect(s.captures[0].groupId).toBeNull();
    expect(s.inventory.collectInto).toBeNull();

    await deleteBoard(INV);
    expect((await loadCollection(INV))!.captures).toHaveLength(0);
  });
});

describe('board report', () => {
  const state = {
    inventory: { id: INV, name: 'app.test', domain: 'app.test', createdAt: 0, recording: false },
    groups: [{ id: 'g1', inventoryId: INV, name: 'Primary <b>button</b>', createdAt: 1, usage: { '/projects/:id': 4 } }],
    captures: [
      makeCapture(INV, draft({ selector: 'a' }), 'g1', 'picked', PNG, 1),
      makeCapture(INV, draft({ selector: 'b', style: { radius: 8, background: '#ff0000ff' } }), 'g1', 'found', 'data:image/svg+xml;base64,PHN2Zz4=', 2),
    ],
  };
  const html = renderBoardHtml(buildBoardExport(state, new Date('2026-11-05T00:00:00Z')));

  it('shows each group with its versions and differences', () => {
    expect(html).toContain('1 group · 2 components collected · 1 screen');
    expect(html).toContain('<span class="chip">radius 6 · 8</span>');
    expect(html).toContain('4 uses on 1 screen');
    expect(html).toMatch(/One comes in more than one version: Primary &lt;b&gt;button&lt;\/b&gt; \(2\)/);
  });

  it('is self-contained and escapes user strings', () => {
    expect(html).toContain("default-src 'none'");
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain('<b>button</b>');
    expect(html).not.toContain('data:image/svg+xml'); // only raster data: images are embedded
    expect(html.match(/<img /g)).toHaveLength(1);
  });
});
