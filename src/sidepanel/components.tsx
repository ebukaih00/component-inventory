/** Side panel building blocks, per DESIGN.md: list row, bucket header, thumbnail tile, count pill, diff chip, buttons. */
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { kindLabel, type Bucket, type CouldBeOneGroup, type OneOffRow, type VariantRow } from '../detect';

/* ---------- primitives ---------- */

type ButtonStyle = 'primary' | 'secondary' | 'quiet';

export function Button(props: {
  variant?: ButtonStyle;
  onClick?: (e: MouseEvent) => void;
  disabled?: boolean;
  title?: string;
  children: ComponentChildren;
  testId?: string;
}) {
  return (
    <button
      type="button"
      class={`btn btn-${props.variant ?? 'secondary'}`}
      onClick={(e) => {
        e.stopPropagation();
        props.onClick?.(e);
      }}
      disabled={props.disabled}
      title={props.title}
      data-testid={props.testId}
    >
      {props.children}
    </button>
  );
}

export function CountPill({ n, title }: { n: number; title?: string }) {
  return <span class="pill" title={title}>{n}</span>;
}

export function DiffChip({ prop, values }: { prop: string; values: string[] }) {
  return (
    <span class="chip" title={`${prop} differs`}>
      {prop} {values.join(' · ')}
    </span>
  );
}

export function Thumb({ src, label }: { src?: string; label: string }) {
  return (
    <span class="thumb">
      {src ? <img src={src} alt={label} /> : <span class="thumb-empty">No preview</span>}
    </span>
  );
}

const BUCKET_LABEL: Record<Bucket, string> = { common: 'Common', couldBeOne: 'Could be one', oneOff: 'One-off' };
const BUCKET_HINT: Record<Bucket, string> = {
  common: 'The same variant on 2 or more screens. Document these as system components.',
  couldBeOne: 'Near-duplicates, or a pattern repeated on one screen. Consolidate into one component.',
  oneOff: 'Appears once. Replace with the closest match, or keep as bespoke.',
};

export function BucketDot({ bucket }: { bucket: Bucket }) {
  return <span class={`dot dot-${bucket}`} aria-hidden="true" />;
}

export function BucketSection(props: { bucket: Bucket; count: number; children: ComponentChildren; empty: string }) {
  const [open, setOpen] = useState(true);
  return (
    <section class="bucket" data-bucket={props.bucket}>
      <button type="button" class="bucket-header" onClick={() => setOpen(!open)} aria-expanded={open} title={BUCKET_HINT[props.bucket]}>
        <BucketDot bucket={props.bucket} />
        <span class="bucket-name">{BUCKET_LABEL[props.bucket]}</span>
        <span class={`pill pill-${props.bucket}`}>{props.count}</span>
        <Chevron open={open} />
      </button>
      {open && (props.count === 0 ? <p class="bucket-empty">{props.empty}</p> : <div class="bucket-body">{props.children}</div>)}
    </section>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg class="chevron" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" style={{ transform: open ? 'rotate(90deg)' : undefined }}>
      <path d="M4.5 2.5 8 6l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.5" />
    </svg>
  );
}

/* ---------- row pieces ---------- */

export interface RowActions {
  highlight: (ids: string[]) => void;
  rename: (id: string, name: string) => void;
  ignore: (ids: string[]) => void;
  restore: (ids: string[]) => void;
  merge: (targetId: string, otherIds: string[]) => void;
  unmerge: (targetId: string, memberIds: string[]) => void;
  split: (id: string, otherIds: string[]) => void;
  /** Same-kind rows to offer in "Merge into". */
  mergeTargets: (row: VariantRow) => { id: string; name: string }[];
}

export function EditableName({ row, onRename }: { row: VariantRow; onRename: (id: string, name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);
  if (!editing) {
    return (
      <span class="name" title="Double-click to rename" onDblClick={(e) => { e.stopPropagation(); setEditing(true); }}>
        {row.name}
      </span>
    );
  }
  const commit = () => {
    const v = input.current?.value.trim();
    if (v && v !== row.name) onRename(row.id, v);
    setEditing(false);
  };
  return (
    <input
      ref={input}
      class="name-input"
      defaultValue={row.name}
      aria-label="Variant name"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') setEditing(false);
      }}
      onBlur={commit}
    />
  );
}

function screensText(row: VariantRow) {
  const n = row.screens.length;
  return n === 1 ? row.screens[0] : `${n} screens`;
}

function StyleTable({ row }: { row: VariantRow }) {
  const s = row.styleSummary;
  const entries: [string, string][] = [
    ['Font', s.font],
    ['Padding', s.padding],
    ['Radius', s.radius],
    ['Background', s.background],
    ['Text', s.color],
    ['Border', s.border],
  ];
  if (row.kind === 'button' || row.kind === 'input' || row.kind === 'badge') entries.push(['Height', s.height]);
  return (
    <dl class="style-table">
      {entries.map(([k, v]) => (
        <>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </>
      ))}
    </dl>
  );
}

function Details({ row, actions, ignored }: { row: VariantRow; actions: RowActions; ignored?: boolean }) {
  const targets = actions.mergeTargets(row);
  const merged = row.memberIds.length - 1;
  return (
    <div class="details" onClick={(e) => e.stopPropagation()}>
      {row.thumbnails.length > 1 && (
        <div class="thumb-strip">
          {row.thumbnails.map((t, i) => <Thumb key={i} src={t} label={`${row.name} instance ${i + 1}`} />)}
        </div>
      )}
      <StyleTable row={row} />
      <div class="pages">
        {row.pages.map((p) => (
          <a key={p} href={p} target="_blank" rel="noreferrer" title={p}>{shortUrl(p)}</a>
        ))}
      </div>
      <div class="actions">
        {ignored ? (
          <Button onClick={() => actions.restore([row.id])}>Restore</Button>
        ) : (
          <>
            <Button variant="quiet" onClick={() => actions.ignore([row.id])} testId="ignore">Ignore</Button>
            {merged > 0 && <Button variant="quiet" onClick={() => actions.unmerge(row.id, row.memberIds)}>Unmerge {merged}</Button>}
            {targets.length > 0 && (
              <select
                class="select"
                aria-label="Merge into"
                value=""
                onChange={(e) => {
                  const target = (e.target as HTMLSelectElement).value;
                  if (target) actions.merge(target, [row.id]);
                }}
              >
                <option value="">Merge into…</option>
                {targets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}` || '/';
  } catch {
    return url;
  }
}

/* ---------- rows ---------- */

export function VariantListRow(props: { row: VariantRow; actions: RowActions; ignored?: boolean; extra?: ComponentChildren }) {
  const { row, actions } = props;
  const [open, setOpen] = useState(false);
  return (
    <div class={`row ${open ? 'row-open' : ''}`} data-variant={row.id}>
      <div class="row-main" role="button" tabIndex={0}
        onClick={() => { setOpen(!open); actions.highlight(row.memberIds); }}
        onKeyDown={(e) => { if (e.key === 'Enter') { setOpen(!open); actions.highlight(row.memberIds); } }}>
        <Thumb src={row.thumbnails[0]} label={row.name} />
        <div class="row-text">
          <EditableName row={row} onRename={actions.rename} />
          <span class="meta">
            {kindLabel(row.kind, row.subkind)} · {screensText(row)}
            {row.memberIds.length > 1 && ` · ${row.memberIds.length} merged`}
          </span>
          {props.extra}
        </div>
        <CountPill n={row.uses} title={`${row.uses} uses`} />
      </div>
      {open && <Details row={row} actions={actions} ignored={props.ignored} />}
    </div>
  );
}

export function GroupBlock({ group, actions }: { group: CouldBeOneGroup; actions: RowActions }) {
  const ids = group.variants.map((v) => v.id);
  if (group.reason === 'repeated-on-one-screen') {
    const row = group.variants[0];
    return (
      <VariantListRow
        row={row}
        actions={actions}
        extra={<span class="meta">Repeated {row.maxPerPage}× on one screen</span>}
      />
    );
  }
  return (
    <div class="group" data-group={group.id}>
      <div class="group-head">
        <span class="meta">{group.variants.length} variants, probably the same {kindLabel(group.kind, group.subkind).toLowerCase()}</span>
        <CountPill n={group.uses} title={`${group.uses} uses in total`} />
      </div>
      <div class="chips">
        {group.diffs.map((d) => <DiffChip key={d.prop} prop={d.prop} values={d.values} />)}
      </div>
      <div class="tiles">
        {group.variants.map((v) => (
          <div class="tile" key={v.id} data-variant={v.id} onClick={() => actions.highlight(v.memberIds)}>
            <Thumb src={v.thumbnails[0]} label={v.name} />
            <EditableName row={v} onRename={actions.rename} />
            <span class="meta">{v.uses} {v.uses === 1 ? 'use' : 'uses'} · {screensText(v)}</span>
            <span class="meta diff-values">{tileDiffs(v, group)}</span>
            <div class="tile-actions">
              <Button variant="secondary" onClick={() => actions.merge(v.id, ids)} title={`Merge the others into ${v.name}`} testId="keep-this">Keep this</Button>
              <Button variant="quiet" onClick={() => actions.split(v.id, ids)} title="Not the same: take it out of this group">Not the same</Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const SUMMARY_FIELD: Partial<Record<string, keyof VariantRow['styleSummary']>> = {
  font: 'font',
  'font size': 'font',
  weight: 'font',
  padding: 'padding',
  radius: 'radius',
  border: 'border',
  background: 'background',
  'text colour': 'color',
  height: 'height',
};

/** What this tile's value is for each property that differs in the group: "radius 6". */
function tileDiffs(v: VariantRow, group: CouldBeOneGroup): string {
  const parts = new Set<string>();
  for (const d of group.diffs) {
    const field = SUMMARY_FIELD[d.prop];
    if (field) parts.add(`${field === 'color' ? 'text' : field} ${v.styleSummary[field]}`);
  }
  return [...parts].join(' · ');
}

export function OneOffListRow({ row, actions }: { row: OneOffRow; actions: RowActions }) {
  const c = row.closest;
  return (
    <VariantListRow
      row={row}
      actions={actions}
      extra={
        c && (
          <span class="meta closest">
            Closest: {c.name}
            {c.differences.length > 0 && ` · differs in ${c.differences.join(', ')}`}
            <Button variant="quiet" onClick={() => actions.merge(c.id, [row.id])} title={`Treat as ${c.name}`}>Merge</Button>
          </span>
        )
      }
    />
  );
}
