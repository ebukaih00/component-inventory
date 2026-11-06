import { BoardView } from './Board';
import { DetectView } from './Detect';
import { Shell } from './shared';
import { useCurrentTab, usePersisted, type SiteTab } from './useInventory';

type View = 'board' | 'detect';

export function App() {
  const tab = useCurrentTab();
  const [view, setView] = usePersisted<View>('ci:view', 'board');

  if (tab === undefined) return <Shell>{null}</Shell>; // first paint: the tab isn't known yet

  if (!tab || !tab.domain) {
    return (
      <Shell>
        <div class="empty">
          <p class="empty-title">Open a page of your product, then click the Component Inventory icon in the toolbar.</p>
          <p class="empty-body">
            The click lets the extension see which site this tab is on. If this panel is already open, click the
            icon again while the page is showing. Only http and https pages work.
          </p>
        </div>
      </Shell>
    );
  }

  const site = tab as SiteTab;
  const switcher = <ViewSwitch view={view} onChange={setView} />;
  return (
    <Shell>
      {view === 'board' ? <BoardView key={site.domain} tab={site} switcher={switcher} /> : <DetectView key={site.domain} tab={site} switcher={switcher} />}
    </Shell>
  );
}

/** Board (you collect) or Auto-detect (the extension scans). Two buttons, one pressed. */
function ViewSwitch({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  const option = (v: View, label: string) => (
    <button type="button" class="segment" aria-pressed={view === v} onClick={() => onChange(v)} data-testid={`view-${v}`}>
      {label}
    </button>
  );
  return (
    <div class="segmented" role="group" aria-label="View">
      {option('board', 'Board')}
      {option('detect', 'Auto-detect')}
    </div>
  );
}
