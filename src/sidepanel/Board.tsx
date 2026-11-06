/**
 * The board: collect components by clicking them on the page, sort them into groups, and let the
 * extension count where else each group is used and show how its versions differ.
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { buildBoardExport, KIND_LABELS, routePattern, viewBoard, type Group, type GroupView, type Version } from '../detect';
import { renderBoardHtml, boardFileName } from '../export/board-html';
import type { ContentToWorker, FindResponse, PanelToContent } from '../shared/messages';
import { createGroup, deleteBoard, deleteCaptures, deleteGroup, moveCaptures, renameGroup, setCollectInto } from '../storage/db';
import { Button, DiffChip, Menu, MenuItem, Thumb } from './components';
import { askWorker, download, flasher, plural, requestSiteAccess } from './shared';
import { useCollection, usePreviewsBlocked, type SiteTab } from './useInventory';

const DRAG_TYPE = 'application/x-component-ids';
const NEW_GROUP = '__new';

/** Collecting state of the page, as the content script reports it (Esc and the shortcut change it there). */
function useCollecting(tab: SiteTab) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const onMessage = (msg: ContentToWorker, sender: chrome.runtime.MessageSender) => {
      if (msg.type === 'collect-state' && sender.tab?.id === tab.id) setOn(msg.on);
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, [tab.id]);
  // A new page loads without the picker.
  useEffect(() => setOn(false), [tab.id, tab.url]);
  return [on, setOn] as const;
}

export function BoardView({ tab, switcher }: { tab: SiteTab; switcher: ComponentChildren }) {
  const { domain } = tab;
  const { state, loading, reload } = useCollection(domain);
  const [collecting, setCollecting] = useCollecting(tab);
  const previewsBlocked = usePreviewsBlocked(tab.id);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const [finding, setFinding] = useState<string | null>(null);
  const flash = flasher(setNote);
  const board = useMemo(() => (state ? viewBoard(state) : null), [state]);
  const groups = board?.groups.map((g) => g.group) ?? [];
  const into = groups.some((g) => g.id === state?.inventory.collectInto) ? state!.inventory.collectInto! : '';

  // Leaving the board (or the panel) stops collecting, so the page isn't left with a dead picker.
  useEffect(() => () => void askWorker({ type: 'set-collecting', tabId: tab.id, on: false }).catch(() => undefined), [tab.id]);

  const run = (fn: () => Promise<unknown>) => async () => {
    await fn();
    await reload();
  };

  async function startCollecting() {
    setError(null);
    if (!(await requestSiteAccess(tab))) {
      setError(`Chrome needs permission to read ${domain} before you can collect from it.`);
      return;
    }
    setCollecting(true);
    const res = await askWorker({ type: 'set-collecting', tabId: tab.id, on: true });
    if (!res.ok) {
      setCollecting(false);
      setError(res.error ?? 'Couldn’t start collecting on this page. Reload it and try again.');
    }
  }
  const stopCollecting = async () => {
    setCollecting(false);
    await askWorker({ type: 'set-collecting', tabId: tab.id, on: false }).catch(() => undefined);
  };

  async function newGroup(name: string, thenCollectInto: boolean) {
    const g = await createGroup(domain, name);
    if (thenCollectInto) await setCollectInto(domain, g.id);
    setNaming(false);
    await reload();
    return g;
  }

  async function find(g: Group) {
    setError(null);
    if (!(await requestSiteAccess(tab))) return;
    setFinding(g.id);
    try {
      const res = await askWorker<FindResponse>({ type: 'find-similar', tabId: tab.id, groupId: g.id });
      if (!res.ok) setError(res.error ?? 'Couldn’t search this page.');
      else if (res.count === 0) flash(`No ${g.name} on this page.`);
      else flash(`${plural(res.count, 'match', 'matches')} on ${res.route}${res.added ? ` · ${plural(res.added, 'new version')} added` : ''}`);
    } finally {
      setFinding(null);
    }
  }

  function highlight(v: Version) {
    const here = routePattern(tab.url ?? '');
    const selectors = v.captures.filter((c) => c.route === here).map((c) => c.selector);
    if (selectors.length === 0) {
      flash(`Collected on ${v.screens.join(', ')}. Open that page to see it.`);
      return;
    }
    chrome.tabs
      .sendMessage(tab.id, { type: 'highlight-selectors', selectors } satisfies PanelToContent)
      .then((r: { count?: number } | undefined) => !r?.count && flash('It’s not on the page any more.'))
      .catch(() => flash('Click Collect once on this page to see it highlighted.'));
  }

  const move = (ids: string[], groupId: string | null) => void run(() => moveCaptures(ids, groupId))();
  const tileActions: TileActions = {
    groups,
    move,
    remove: (ids) => void run(() => deleteCaptures(ids))(),
    highlight,
  };

  function saveReport() {
    if (!state) return;
    const exp = buildBoardExport(state);
    download(renderBoardHtml(exp), 'text/html', boardFileName(exp));
    flash('Report saved. Open it in any browser, or print it to PDF.');
  }
  function downloadJson() {
    if (!state) return;
    const exp = buildBoardExport(state);
    download(JSON.stringify(exp, null, 2), 'application/json', boardFileName(exp).replace(/\.html$/, '.json'));
  }
  async function clearBoard() {
    if (!state || !confirm(`Delete the board for ${domain}? Groups and collected components can’t be recovered.`)) return;
    await deleteBoard(state.inventory.id);
    await reload();
  }

  const header = (
    <header class="header">
      {switcher}
      <div class="header-top">
        <h1 class="domain" title={domain}>{domain}</h1>
        <span class="status" data-testid="status">{collecting ? <><span class="rec" aria-hidden="true" />Collecting</> : ''}</span>
      </div>
      <div class="header-actions">
        {collecting ? (
          <Button onClick={stopCollecting} testId="collect-stop">Stop collecting</Button>
        ) : (
          <Button variant="primary" onClick={startCollecting} testId="collect">Collect</Button>
        )}
        <label class="add-to">
          <span class="meta">Add to</span>
          <select
            class="select"
            value={into}
            data-testid="add-to"
            onChange={(e) => {
              const v = (e.target as HTMLSelectElement).value;
              if (v === NEW_GROUP) {
                (e.target as HTMLSelectElement).value = into;
                setNaming(true);
              } else void run(() => setCollectInto(domain, v || null))();
            }}
          >
            <option value="">Unsorted</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            <option value={NEW_GROUP}>New group…</option>
          </select>
        </label>
      </div>
      {naming && <NewGroupForm onCreate={(n) => void newGroup(n, true)} onCancel={() => setNaming(false)} />}
      {collecting && (
        <p class="pick-hint" role="status" data-testid="collecting">
          <span>Click components on the page to add them. ↑ selects the parent. Esc pauses so you can click around; <kbd>⌥⇧C</kbd> resumes.</span>
        </p>
      )}
      {previewsBlocked && (
        <p class="hint" data-testid="previews-blocked">Previews need one click on the Component Inventory icon in this tab. Click it, then collect again.</p>
      )}
      {error && (
        <div class="error" role="alert">
          <span>{error}</span>
          <Button variant="quiet" onClick={() => setError(null)}>Dismiss</Button>
        </div>
      )}
    </header>
  );

  if (loading) return <>{header}</>;

  const empty = !board || (board.groups.length === 0 && board.unsorted.length === 0);
  return (
    <>
      {header}
      {empty ? (
        <div class="empty">
          <p class="empty-title">Collect the components you see</p>
          <p class="empty-body">
            Click <b>Collect</b>, then click buttons, cards, inputs, anything, as you move through {domain}. Sort them
            into groups like screenshots on a Figma board. For each group, <b>Find on this page</b> counts where it’s
            used and picks up versions that look different.
          </p>
          <p class="meta">Local only. Screenshots stay in this browser; nothing is sent to a server.</p>
        </div>
      ) : (
        <main class="board" data-testid="board">
          <p class="board-summary meta" data-testid="board-summary">
            <span class="num">{plural(board.summary.groups, 'group')}</span> · <span class="num">{plural(board.summary.captures, 'component')}</span> collected
            · <span class="num">{plural(board.summary.screens, 'screen')}</span>
          </p>
          {board.unsorted.length > 0 && (
            <DropZone class="board-section unsorted" onDrop={(ids) => move(ids, null)} testId="unsorted">
              <div class="group-head">
                <h2 class="group-name">Unsorted <span class="bucket-count num">{board.unsorted.length}</span></h2>
              </div>
              <p class="bucket-hint flush">Drag into a group, or use Move to.</p>
              <div class="tiles board-tiles">
                {board.unsorted.map((v) => <VersionTile key={v.key} version={v} groupId={null} actions={tileActions} />)}
              </div>
            </DropZone>
          )}
          {board.groups.map((g) => (
            <GroupSection
              key={g.group.id}
              view={g}
              actions={tileActions}
              finding={finding === g.group.id}
              onFind={() => void find(g.group)}
              onRename={(name) => void run(() => renameGroup(g.group.id, name))()}
              onDelete={() => void run(() => deleteGroup(g.group.id))()}
            />
          ))}
          <div class="board-add">
            {naming ? null : <Button variant="quiet" onClick={() => setNaming(true)} testId="new-group">New group</Button>}
          </div>
        </main>
      )}
      <footer class="footer">
        {note && <div class="toast" role="status" data-testid="toast">{note}</div>}
        <Menu label="More" testId="more">
          <MenuItem onClick={downloadJson} testId="download" hint="Raw data">Download JSON</MenuItem>
          <MenuItem onClick={() => void clearBoard()}>Delete board…</MenuItem>
        </Menu>
        <span class="spacer" />
        <Button variant="primary" onClick={saveReport} disabled={empty} testId="save-report">Save report</Button>
      </footer>
    </>
  );
}

/* ---------- pieces ---------- */

function NewGroupForm(props: { onCreate: (name: string) => void; onCancel: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  return (
    <form
      class="new-group"
      onSubmit={(e) => {
        e.preventDefault();
        const name = input.current?.value.trim();
        if (name) props.onCreate(name);
      }}
    >
      <input
        ref={input}
        class="text-input"
        placeholder="Group name, e.g. Primary button"
        aria-label="New group name"
        data-testid="group-name"
        onKeyDown={(e) => e.key === 'Escape' && props.onCancel()}
      />
      <Button variant="quiet" onClick={props.onCancel}>Cancel</Button>
      <button type="submit" class="btn btn-primary" data-testid="group-create">Create</button>
    </form>
  );
}

function DropZone(props: { class: string; onDrop: (ids: string[]) => void; children: ComponentChildren; testId?: string; label?: string }) {
  const [over, setOver] = useState(false);
  return (
    <section
      class={`${props.class} ${over ? 'drop-on' : ''}`}
      data-testid={props.testId}
      data-group={props.label}
      onDragOver={(e) => {
        if (!e.dataTransfer?.types.includes(DRAG_TYPE)) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!(e.currentTarget as Node).contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(e) => {
        setOver(false);
        const raw = e.dataTransfer?.getData(DRAG_TYPE);
        if (!raw) return;
        e.preventDefault();
        props.onDrop(JSON.parse(raw) as string[]);
      }}
    >
      {props.children}
    </section>
  );
}

function GroupSection(props: {
  view: GroupView;
  actions: TileActions;
  finding: boolean;
  onFind: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const { group, versions, differs, uses, screens } = props.view;
  const [editing, setEditing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);
  const commit = () => {
    const v = input.current?.value.trim();
    if (v && v !== group.name) props.onRename(v);
    setEditing(false);
  };

  return (
    <DropZone class="board-section" onDrop={(ids) => props.actions.move(ids, group.id)} testId="group" label={group.name}>
      <div class="group-head">
        {editing ? (
          <input
            ref={input}
            class="name-input"
            defaultValue={group.name}
            aria-label="Group name"
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') setEditing(false);
            }}
            onBlur={commit}
          />
        ) : (
          <h2 class="group-name" title="Double-click to rename" onDblClick={() => setEditing(true)}>{group.name}</h2>
        )}
        <GroupMenu onRename={() => setEditing(true)} onDelete={props.onDelete} />
      </div>
      <p class="group-meta meta" data-testid="group-meta">
        <span class="num">{plural(versions.length, 'version')}</span>
        {uses > 0 && <> · <span class="num">{plural(uses, 'use')}</span> on <span class="num">{plural(screens.length, 'screen')}</span></>}
      </p>
      {differs.length > 0 && (
        <div class="chips" data-testid="differs">
          {differs.map((d) => <DiffChip key={d.prop} prop={d.prop} values={d.values} />)}
        </div>
      )}
      {versions.length > 0 ? (
        <div class="tiles board-tiles">
          {versions.map((v) => <VersionTile key={v.key} version={v} groupId={group.id} actions={props.actions} />)}
        </div>
      ) : (
        <p class="bucket-empty flush">Drop components here, or choose this group under Add to and click them on the page.</p>
      )}
      {versions.length > 0 && (
        <div class="group-actions">
          <Button onClick={props.onFind} disabled={props.finding} testId="find" title="Count this component on the page, and collect versions that look different">
            {props.finding ? 'Finding…' : 'Find on this page'}
          </Button>
        </div>
      )}
    </DropZone>
  );
}

/** Rename and delete, tucked away: they're rare next to Find. */
function GroupMenu(props: { onRename: () => void; onDelete: () => void }) {
  return (
    <div class="group-menu">
      <Menu label="Edit" testId="group-edit" down>
        <MenuItem onClick={props.onRename}>Rename</MenuItem>
        <MenuItem onClick={props.onDelete} hint="Keeps its components" testId="group-delete">Delete group</MenuItem>
      </Menu>
    </div>
  );
}

interface TileActions {
  groups: Group[];
  move: (ids: string[], groupId: string | null) => void;
  remove: (ids: string[]) => void;
  highlight: (v: Version) => void;
}

function VersionTile({ version: v, groupId, actions }: { version: Version; groupId: string | null; actions: TileActions }) {
  const c = v.captures[0];
  const ids = v.captures.map((x) => x.id);
  const label = `${KIND_LABELS[c.kind]}${c.classes.length ? ` .${c.classes.slice(0, 2).join('.')}` : ''}`;
  return (
    <div
      class="tile board-tile"
      draggable
      data-testid="tile"
      onDragStart={(e) => {
        e.dataTransfer?.setData(DRAG_TYPE, JSON.stringify(ids));
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      }}
    >
      <button type="button" class="thumb-button" onClick={() => actions.highlight(v)} title="Show it on the page">
        <Thumb src={v.thumbnail ?? undefined} label={label} />
      </button>
      <p class="tile-title">
        <span class="tile-name">{label}</span>
        {v.captures.length > 1 && <span class="meta num">×{v.captures.length}</span>}
        {c.source === 'found' && <span class="meta" title="Added by Find on this page">found</span>}
      </p>
      <p class="meta mono tile-screens">{v.screens.join('  ')}</p>
      {v.values.length > 0 && <p class="diff-values">{v.values.map((x) => `${x.prop} ${x.value}`).join(' · ')}</p>}
      <div class="tile-actions">
        <select
          class="select"
          aria-label="Move to"
          value=""
          data-testid="move-to"
          onChange={(e) => {
            const to = (e.target as HTMLSelectElement).value;
            (e.target as HTMLSelectElement).value = '';
            if (to) actions.move(ids, to === 'unsorted' ? null : to);
          }}
        >
          <option value="" disabled>Move to…</option>
          {groupId !== null && <option value="unsorted">Unsorted</option>}
          {actions.groups.filter((g) => g.id !== groupId).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        <Button variant="quiet" onClick={() => actions.remove(ids)}>Remove</Button>
      </div>
    </div>
  );
}
