import { useMemo, useState } from 'preact/hooks';
import { buildReport, buildExport, KINDS, KIND_LABELS, type Kind, type VariantRow } from '../detect';
import type { PanelToContent, PanelToWorker, WorkerReply } from '../shared/messages';
import { deleteInventory, mergeVariants, renameVariant, setIgnored, splitFromGroup, unmergeInto } from '../storage/db';
import { BucketDot, BucketSection, Button, GroupBlock, OneOffListRow, VariantListRow, type RowActions } from './components';
import { useCurrentTab, useInventory } from './useInventory';

const originPattern = (url: string) => {
  const u = new URL(url);
  return `${u.protocol}//${u.hostname}/*`;
};

async function askWorker(msg: PanelToWorker): Promise<WorkerReply> {
  return (await chrome.runtime.sendMessage(msg)) ?? { ok: false, error: 'No response from the extension.' };
}

export function App() {
  const tab = useCurrentTab();
  const domain = tab?.domain ?? null;
  const { state, loading, reload, scan, setScan, previewsBlocked } = useInventory(domain, tab?.id ?? null);
  const [kind, setKind] = useState<Kind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [showIgnored, setShowIgnored] = useState(false);

  const report = useMemo(() => (state ? buildReport(state, { kind }) : null), [state, kind]);
  const kindCounts = useMemo(() => {
    const counts = new Map<Kind, number>();
    if (!state) return counts;
    const used = new Set(state.instances.map((i) => i.variantId));
    for (const v of state.variants) if (v.status === 'kept' && used.has(v.id)) counts.set(v.kind, (counts.get(v.kind) ?? 0) + 1);
    return counts;
  }, [state]);

  const flash = (msg: string) => {
    setNote(msg);
    window.setTimeout(() => setNote((n) => (n === msg ? null : n)), 3000);
  };

  /** Asks for this product's host permission (needs the click's user gesture), then runs. */
  async function withPermission(run: () => Promise<WorkerReply>) {
    if (!tab?.url) return;
    setError(null);
    const granted = await chrome.permissions.request({ origins: [originPattern(tab.url)] }).catch(() => false);
    if (!granted) {
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

  async function downloadJson() {
    if (!state) return;
    const json = JSON.stringify(buildExport(state), null, 2);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    a.download = `inventory-${state.inventory.domain}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function copyForFigma() {
    if (!state) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(buildExport(state)));
      flash('Copied. In Figma, run the Component Inventory plugin and paste.');
    } catch {
      setError('Could not copy to the clipboard. Use Download JSON instead.');
    }
  }

  async function clearInventory() {
    if (!state || !confirm(`Delete the inventory for ${state.inventory.domain}? This cannot be undone.`)) return;
    if (state.inventory.recording) await stopRecording();
    await deleteInventory(state.inventory.id);
    await reload();
  }

  /* ---------- states ---------- */

  if (!tab || !domain) {
    return (
      <Shell>
        <div class="empty">
          <p>Open a page of your product, then click the Component Inventory icon in the toolbar.</p>
          <p class="meta">Only http and https pages can be scanned.</p>
        </div>
      </Shell>
    );
  }

  const recording = state?.inventory.recording ?? false;
  const header = (
    <header class="header">
      <div class="header-top">
        <h1 class="domain" title={domain}>{domain}</h1>
        <span class="status" data-testid="status">
          {scan.state === 'scanning' ? 'Scanning…' : recording ? <><span class="rec" />Recording</> : state ? 'Paused' : ''}
        </span>
      </div>
      <div class="header-actions">
        {recording ? (
          <Button onClick={stopRecording} testId="stop">Stop recording</Button>
        ) : (
          <Button variant="primary" onClick={startRecording} testId="start">{state ? 'Resume recording' : 'Start recording'}</Button>
        )}
        <Button onClick={scanPage} disabled={scan.state === 'scanning'} testId="scan">Scan this page</Button>
      </div>
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
    </header>
  );

  if (loading) return <Shell>{header}</Shell>;

  if (!state || !report || state.pages.length === 0) {
    return (
      <Shell>
        {header}
        <div class="empty">
          <p>Nothing inventoried on {domain} yet.</p>
          <p class="meta">Start recording, then browse your product as usual. Every page you visit is scanned, including pages behind a login.</p>
        </div>
        <Footer />
      </Shell>
    );
  }

  const s = report.summary;
  const total = [...kindCounts.values()].reduce((a, b) => a + b, 0);
  return (
    <Shell>
      {header}
      <div class="summary" data-testid="summary">
        <span><b class="num">{s.screens}</b> {s.screens === 1 ? 'screen' : 'screens'}</span>
        <span><BucketDot bucket="common" /><b class="num">{s.common}</b> common</span>
        <span><BucketDot bucket="couldBeOne" /><b class="num">{s.couldBeOne}</b> could be one</span>
        <span><BucketDot bucket="oneOff" /><b class="num">{s.oneOff}</b> one-off</span>
      </div>
      <div class="filters" role="tablist" aria-label="Filter by kind">
        <FilterChip active={kind === null} onClick={() => setKind(null)} label="All" n={total} />
        {KINDS.filter((k) => kindCounts.get(k)).map((k) => (
          <FilterChip key={k} active={kind === k} onClick={() => setKind(k)} label={KIND_LABELS[k]} n={kindCounts.get(k) ?? 0} />
        ))}
      </div>
      <main class="buckets">
        <BucketSection bucket="common" count={report.common.length} empty="Nothing appears on two screens yet. Keep browsing.">
          {report.common.map((r) => <VariantListRow key={r.id} row={r} actions={actions} />)}
        </BucketSection>
        <BucketSection bucket="couldBeOne" count={report.couldBeOne.length} empty="No near-duplicates found.">
          {report.couldBeOne.map((g) => <GroupBlock key={g.id} group={g} actions={actions} />)}
        </BucketSection>
        <BucketSection bucket="oneOff" count={report.oneOff.length} empty="No one-offs.">
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
      {note && <div class="toast" role="status">{note}</div>}
      <Footer>
        <span class="meta">{s.pages} pages scanned</span>
        <span class="spacer" />
        <Button variant="quiet" onClick={clearInventory}>Delete</Button>
        <Button onClick={downloadJson} testId="download">Download JSON</Button>
        <Button variant="primary" onClick={copyForFigma} testId="copy-figma">Copy for Figma</Button>
      </Footer>
    </Shell>
  );
}

function Shell({ children }: { children: preact.ComponentChildren }) {
  return <div class="shell">{children}</div>;
}

function Footer({ children }: { children?: preact.ComponentChildren }) {
  return (
    <footer class="footer">
      <div class="footer-actions">{children}</div>
      <p class="privacy">Local only. Scans and screenshots stay in this browser; nothing is sent to a server.</p>
    </footer>
  );
}

function FilterChip(props: { active: boolean; onClick: () => void; label: string; n: number }) {
  return (
    <button type="button" role="tab" aria-selected={props.active} class={`filter ${props.active ? 'filter-on' : ''}`} onClick={props.onClick}>
      {props.label} <span class="num">{props.n}</span>
    </button>
  );
}
