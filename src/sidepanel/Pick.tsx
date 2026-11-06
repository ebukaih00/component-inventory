/** "Add element": pick something on the page the detector missed, say what it is, add it as a rule. */
import { useEffect, useState } from 'preact/hooks';
import { canPickSimilar, KIND_LABELS, KINDS, makeRule, type Kind, type PickRule, type PickScope } from '../detect';
import type { ContentToWorker } from '../shared/messages';
import { Button } from './components';

type PickedMsg = Extract<ContentToWorker, { type: 'picked' }>;

export type PickState = { mode: 'idle' } | { mode: 'picking' } | { mode: 'picked'; picked: PickedMsg };

/** Listens for the content script's picker results for this tab. */
export function usePicker(tabId: number | null) {
  const [pick, setPick] = useState<PickState>({ mode: 'idle' });
  useEffect(() => {
    const onMessage = (msg: ContentToWorker, sender: chrome.runtime.MessageSender) => {
      if (sender.tab?.id !== tabId) return;
      if (msg.type === 'picked') setPick({ mode: 'picked', picked: msg });
      if (msg.type === 'pick-cancelled') setPick({ mode: 'idle' });
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, [tabId]);
  useEffect(() => setPick({ mode: 'idle' }), [tabId]);
  return [pick, setPick] as const;
}

export function PickingHint({ onCancel }: { onCancel: () => void }) {
  return (
    <div class="pick-hint" role="status" data-testid="picking">
      <span>Click a component on the page. Use ↑ to select its parent if you landed on its text.</span>
      <Button variant="quiet" onClick={onCancel}>Cancel</Button>
    </div>
  );
}

export function PickSheet(props: { picked: PickedMsg; onAdd: (rule: PickRule) => void; onCancel: () => void }) {
  const { target, suggestion, label, size } = props.picked;
  const similarOk = canPickSimilar(target);
  const [kind, setKind] = useState<Kind>(suggestion);
  const [scope, setScope] = useState<PickScope>(similarOk ? 'similar' : 'this');

  return (
    <section class="pick-sheet" aria-label="Add to inventory" data-testid="pick-sheet">
      <p class="pick-title">Add to inventory</p>
      <p class="pick-target"><code>{label}</code> <span class="meta">{size}</span></p>

      <label class="pick-field">
        <span class="pick-label">What is it?</span>
        <select class="select" value={kind} onChange={(e) => setKind((e.target as HTMLSelectElement).value as Kind)} data-testid="pick-kind">
          {KINDS.map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
        </select>
      </label>

      <fieldset class="pick-field pick-scope">
        <legend class="pick-label">Find</legend>
        <label class={similarOk ? '' : 'disabled'}>
          <input type="radio" name="scope" checked={scope === 'similar'} disabled={!similarOk} onChange={() => setScope('similar')} />
          <span>
            Everything that looks like this
            <span class="meta">{similarOk ? ` · same tag and classes, on every page` : ` · this element has no stable class names`}</span>
          </span>
        </label>
        <label>
          <input type="radio" name="scope" checked={scope === 'this'} onChange={() => setScope('this')} />
          <span>Only this element <span class="meta">· on {target.path}</span></span>
        </label>
      </fieldset>

      <div class="pick-actions">
        <Button variant="quiet" onClick={props.onCancel}>Cancel</Button>
        <Button variant="primary" onClick={() => props.onAdd(makeRule(target, kind, null, scope))} testId="pick-add">
          Add {KIND_LABELS[kind].toLowerCase()}
        </Button>
      </div>
    </section>
  );
}
