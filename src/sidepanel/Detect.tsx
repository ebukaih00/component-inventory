import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { BUCKETS, buildReport, buildExport, KINDS, KIND_LABELS, type Kind, type PickRule, type VariantRow } from '../detect';
import type { ComponentChildren } from 'preact';
import type { PanelToContent, WorkerReply } from '../shared/messages';
import { deleteInventory, mergeVariants, renameVariant, setIgnored, splitFromGroup, unmergeInto } from '../storage/db';
import { renderReportHtml, reportFileName } from '../export/report-html';
import { BucketDot, BucketSection, Button, GroupBlock, Menu, MenuItem, OneOffListRow, VariantListRow, type RowActions } from './components';
import { PickingHint, PickSheet, usePicker } from './Pick';
import { askWorker, download, plural, requestSiteAccess } from './shared';
import { useInventory, usePersisted, type SiteTab } from './useInventory';

/** Auto-detect: the extension scans pages and sorts what it finds into reused, near-duplicates and one-offs. */
export function DetectView({ tab, switcher }: { tab: SiteTab; switcher: ComponentChildren }) {
  const domain = tab.domain;
  const { state, loading, reload, scan, setScan, previewsBlocked } = useInventory(domain, tab?.id ?? null);
  const [savedKind, setKind] = usePersisted<Kind | null>(domain ? `ci:${domain}:kind` : null, null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [showIgnored, setShowIgnored] = useState(false);
  const [pick, setPick] = usePicker(tab?.id ?? null);

    const kindCounts = useMemo(() => {
    const counts = new Map<Kind, number>();
    if (!state) return counts;
    const used = new Set(state.instances.map((i) => i.variantId));
    for (const v of state.variants) if (v.status === 'kept' && used.has(v.id)) counts.set(v.kind, (counts.get(v.kind) ?? 0) + 1);
    return counts;
  }, [state]);

  // A saved filter for a kind that's no longer on the list would show an empty panel: fall back to All.
  const kind = savedKind && kindCounts.get(savedKind) ? savedKind : null;
  const report = useMemo(() => (state ? buildReport(state, { kind }) : null), [state, kind]);

  const flash = (msg: string) => {
    setNote(msg);
    window.setTimeout(() => setNote((n) => (n === msg ? null : n)), 3000);
  };

  /** Asks for this product's host permission (needs the click's user gesture), then runs. */
  async function withPermission(run: () => Promise<WorkerReply>) {
    setError(null);
    if (!(await requestSiteAccess(tab))) {
      setError(`Chrome needs permission to read ${domain} before it can be scanned.`);
      return;
    }
    const res = await run();
    if (!res.ok) setError(res.error ?? 'Something went wrong.');
  }

  const startRecording = () =>
    withPermission(() => {
      setScan({ state: 'scanning' });
      return askWorker({ type: 'start-recording', tabId: tab!.id, url: tab!.url! });
    });
  const scanPage = () => withPermission(() => askWorker({ type: 'scan-tab', tabId: tab!.id }));
  const startPicking = () =>
    withPermission(async () => {
      setPick({ mode: 'picking' });
      const res = await askWorker({ type: 'start-pick', tabId: tab!.id });
      if (!res.ok) setPick({ mode: 'idle' });
      return res;
    });
  const cancelPicking = () => {
    setPick({ mode: 'idle' });
    if (tab) chrome.tabs.sendMessage(tab.id, { type: 'pick-cancel' } satisfies PanelToContent).catch(() => undefined);
  };
  const addPicked = (rule: PickRule) =>
    withPermission(async () => {
      setPick({ mode: 'idle' });
      flash('Added. Scanning this page for it…');
      return askWorker({ type: 'add-rule', tabId: tab!.id, domain, rule });
    });
  const stopRecording = async () => {
    if (domain) await askWorker({ type: 'stop-recording', domain });
  };

  const act = (fn: () => Promise<unknown>) => async () => {
    await fn();
    await reload();
  };

  const actions: RowActions = {
    highlight: (ids) => {
      if (!tab) return;
      const msg: PanelToContent = { type: 'highlight', variantIds: ids };
      chrome.tabs
        .sendMessage(tab.id, msg)
        .then((r: { count?: number } | undefined) => {
          if (!r?.count) flash('Not on this page. Open one of its pages to see it highlighted.');
        })
        .catch(() => flash('Scan this page to highlight components on it.'));
    },
    rename: (id, name) => void act(() => renameVariant(id, name))(),
    ignore: (ids) => void act(() => setIgnored(ids, true))(),
    restore: (ids) => void act(() => setIgnored(ids, false))(),
    merge: (target, others) => void act(() => mergeVariants(target, others))(),
    unmerge: (target, members) => void act(() => unmergeInto(target, members))(),
    split: (id, others) => void act(() => splitFromGroup(id, others))(),
    mergeTargets: (row: VariantRow) => {
      if (!report) return [];
      const all = [...report.common, ...report.couldBeOne.flatMap((g) => g.variants), ...report.oneOff];
      return all.filter((r) => r.kind === row.kind && r.id !== row.id).map((r) => ({ id: r.id, name: r.name }));
    },
  };

  function downloadJson() {
    if (!state) return;
    const exp = buildExport(state);
    download(JSON.stringify(exp, null, 2), 'application/json', reportFileName(exp).replace(/\.html$/, '.json'));
  }

  function saveReport() {
    if (!state) return;
    const exp = buildExport(state);
    download(renderReportHtml(exp), 'text/html', reportFileName(exp));
    flash('Report saved. Open it in any browser, or print it to PDF.');
  }

  async function clearInventory() {
    if (!state || !confirm(`Delete the inventory for ${state.inventory.domain}? This cannot be undone.`)) return;
    if (state.inventory.recording) await stopRecording();
    await deleteInventory(state.inventory.id);
    await reload();
  }

  const recording = state?.inventory.recording ?? false;
  const header = (
    <header class="header">
      {switcher}
      <div class="header-top">
        <h1 class="domain" title={domain}>{domain}</h1>
        <span class="status" data-testid="status">
          {scan.state === 'scanning' ? 'Scanning…' : recording ? <><span class="rec" aria-hidden="true" />Recording</> : state ? 'Paused' : ''}
        </span>
      </div>
      <div class="header-actions">
        {recording ? (
          <Button onClick={stopRecording} testId="stop">Stop recording</Button>
        ) : (
          <Button variant="primary" onClick={startRecording} testId="start">{state ? 'Resume recording' : 'Start recording'}</Button>
        )}
        <Button onClick={scanPage} disabled={scan.state === 'scanning'} testId="scan">Scan this page</Button>
        <Button onClick={startPicking} disabled={pick.mode !== 'idle'} testId="pick" title="Pick something on the page that wasn’t found">Add element</Button>
      </div>
      {pick.mode === 'picking' && <PickingHint onCancel={cancelPicking} />}
      {previewsBlocked && (
        <p class="hint" data-testid="previews-blocked">
          Previews need one click on the Component Inventory icon in this tab. Click it, then Scan this page.
        </p>
      )}
      {error && (
        <div class="error" role="alert">
          <span>{error}</span>
          <Button variant="quiet" onClick={() => setError(null)}>Dismiss</Button>
        </div>
      )}
      {scan.state === 'error' && (
        <div class="error" role="alert">
          <span>{scan.message}</span>
          <Button variant="quiet" onClick={scanPage}>Retry</Button>
        </div>
      )}
      {pick.mode === 'picked' && <PickSheet picked={pick.picked} onAdd={(r) => void addPicked(r)} onCancel={() => setPick({ mode: 'idle' })} />}
    </header>
  );

  if (loading) return <>{header}</>;

  if (!state || !report || state.pages.length === 0) {
    return (
      <>
        {header}
        <div class="empty">
          <p class="empty-title">Nothing inventoried on {domain} yet.</p>
          <p class="empty-body">
            Start recording, then browse your product as usual. Every page you visit is scanned, including pages
            behind a login. Components are sorted into reused, near-duplicates and one-offs as you go.
          </p>
          <p class="meta">Local only. Scans and screenshots stay in this browser; nothing is sent to a server.</p>
        </div>
      </>
    );
  }

  const s = report.summary;
  const total = [...kindCounts.values()].reduce((a, b) => a + b, 0);
  return (
    <>
      {header}
      <div class="summary" data-testid="summary">
        <p class="summary-scope meta">
          <span class="num">{plural(s.screens, 'screen')}</span> · <span class="num">{plural(s.pages, 'page')}</span> scanned
        </p>
        <ConsistencyBar common={s.common} couldBeOne={s.couldBeOne} oneOff={s.oneOff} />
        <div class="legend">
          <span><BucketDot bucket="common" /><b class="num">{s.common}</b> {BUCKETS.common.legend}</span>
          <span><BucketDot bucket="couldBeOne" /><b class="num">{s.couldBeOne}</b> {BUCKETS.couldBeOne.legend}</span>
          <span><BucketDot bucket="oneOff" /><b class="num">{s.oneOff}</b> {BUCKETS.oneOff.legend}</span>
        </div>
      </div>
      <div class="filters" role="group" aria-label="Filter by kind">
        <FilterChip active={kind === null} onClick={() => setKind(null)} label="All" n={total} />
        {KINDS.filter((k) => kindCounts.get(k)).map((k) => (
          <FilterChip key={k} active={kind === k} onClick={() => setKind(k)} label={KIND_LABELS[k]} n={kindCounts.get(k) ?? 0} />
        ))}
      </div>
      <main class="buckets">
        <BucketSection bucket="common" storageKey={`ci:${domain}:open:common`} count={report.common.length} empty="Nothing is used twice yet. Keep browsing.">
          {report.common.map((r) => <VariantListRow key={r.id} row={r} actions={actions} />)}
        </BucketSection>
        <BucketSection bucket="couldBeOne" storageKey={`ci:${domain}:open:couldBeOne`} count={report.couldBeOne.length} empty="No near-duplicates found.">
          {report.couldBeOne.map((g) => <GroupBlock key={g.id} group={g} actions={actions} />)}
        </BucketSection>
        <BucketSection bucket="oneOff" storageKey={`ci:${domain}:open:oneOff`} count={report.oneOff.length} empty="No one-offs.">
          {report.oneOff.map((r) => <OneOffListRow key={r.id} row={r} actions={actions} />)}
        </BucketSection>
        {report.ignored.length > 0 && (
          <section class="ignored">
            <Button variant="quiet" onClick={() => setShowIgnored(!showIgnored)}>
              {showIgnored ? 'Hide' : 'Show'} {report.ignored.length} ignored
            </Button>
            {showIgnored && report.ignored.map((r) => <VariantListRow key={r.id} row={r} actions={actions} ignored />)}
          </section>
        )}
      </main>
      <footer class="footer">
        {note && <div class="toast" role="status">{note}</div>}
        <Menu label="More" testId="more">
          <MenuItem onClick={downloadJson} testId="download" hint="Raw data">Download JSON</MenuItem>
          <MenuItem onClick={clearInventory}>Delete inventory…</MenuItem>
        </Menu>
        <span class="spacer" />
        <Button variant="primary" onClick={saveReport} testId="save-report">Save report</Button>
      </footer>
    </>
  );
}

/** Share of rows per bucket: how consistent the product's UI is, at a glance. */
function ConsistencyBar(props: { common: number; couldBeOne: number; oneOff: number }) {
  const total = props.common + props.couldBeOne + props.oneOff;
  if (total === 0) return null;
  const parts = [
    ['common', props.common],
    ['couldBeOne', props.couldBeOne],
    ['oneOff', props.oneOff],
  ] as const;
  return (
    <div class="bar" aria-hidden="true">
      {parts.filter(([, n]) => n > 0).map(([b, n]) => <span key={b} class={`bar-${b}`} style={{ flexGrow: n }} />)}
    </div>
  );
}

function FilterChip(props: { active: boolean; onClick: () => void; label: string; n: number }) {
  const ref = useRef<HTMLButtonElement>(null);
  // The row scrolls sideways: keep the selected filter (possibly restored from last time) in view.
  useEffect(() => {
    if (props.active) ref.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [props.active]);
  return (
    <button ref={ref} type="button" aria-pressed={props.active} class={`filter ${props.active ? 'filter-on' : ''}`} onClick={props.onClick}>
      {props.label} <span class="num">{props.n}</span>
    </button>
  );
}
