/** Side panel building blocks, per DESIGN.md: list row, bucket header, thumbnail tile, count pill, diff chip, buttons. */
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { usePersisted } from './useInventory';
import { BUCKETS, kindLabel, type Bucket, type CouldBeOneGroup, type OneOffRow, type VariantRow } from '../detect';

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

export function Uses({ n }: { n: number }) {
  return (
    <span class="uses" title={`${n} ${n === 1 ? 'use' : 'uses'}`}>
      <b class="num">{n}</b> {n === 1 ? 'use' : 'uses'}
    </span>
  );
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

export function BucketDot({ bucket }: { bucket: Bucket }) {
  return <span class={`dot dot-${bucket}`} aria-hidden="true" />;
}

/** Collapsible bucket. Open/closed is remembered per site (storageKey), so it survives closing the panel. */
export function BucketSection(props: { bucket: Bucket; count: number; children: ComponentChildren; empty: string; storageKey: string }) {
  const [isOpen, setOpen] = usePersisted(props.storageKey, true);
  const toggle = () => setOpen(!isOpen);
  return (
    <section class="bucket" data-bucket={props.bucket}>
      <button type="button" class="bucket-header" onClick={toggle} aria-expanded={isOpen}>
        <BucketDot bucket={props.bucket} />
        <span class="bucket-name">{BUCKETS[props.bucket].label}</span>
        <span class="bucket-count num">{props.count}</span>
        <Chevron open={isOpen} />
      </button>
      {isOpen && (
        <>
          <p class="bucket-hint">{BUCKETS[props.bucket].hint}</p>
          {props.count === 0 ? <p class="bucket-empty">{props.empty}</p> : <div class="bucket-body">{props.children}</div>}
        </>
      )}
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
      {entries.map(([k, v]) => {
        const hex = v.match(/#[0-9a-f]{6}(?:[0-9a-f]{2})?\b/i)?.[0];
        return (
          <>
            <dt>{k}</dt>
            <dd>{hex && <span class="swatch" style={{ background: hex }} aria-hidden="true" />}{v}</dd>
          </>
        );
      })}
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
        aria-expanded={open}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
          e.preventDefault();
          setOpen(!open);
          actions.highlight(row.memberIds);
        }}>
        <Thumb src={row.thumbnails[0]} label={row.name} />
        <div class="row-text">
          <EditableName row={row} onRename={actions.rename} />
          <span class="meta">
            {kindLabel(row.kind, row.subkind)} · {screensText(row)}
            {row.memberIds.length > 1 && ` · ${row.memberIds.length} merged`}
          </span>
          {props.extra}
        </div>
        <Uses n={row.uses} />
      </div>
      {open && <Details row={row} actions={actions} ignored={props.ignored} />}
    </div>
  );
}

export function GroupBlock({ group, actions }: { group: CouldBeOneGroup; actions: RowActions }) {
  const ids = group.variants.map((v) => v.id);
  return (
    <div class="group" data-group={group.id}>
      <div class="group-head">
        <span class="group-title">
          {group.variants.length} {kindPlural(kindLabel(group.kind, group.subkind))} that look almost the same
        </span>
        <Uses n={group.uses} />
      </div>
      <div class="chips">
        {group.diffs.map((d) => <DiffChip key={d.prop} prop={d.prop} values={d.values} />)}
      </div>
      <div class="tiles">
        {group.variants.map((v) => (
          <div class="tile" key={v.id} data-variant={v.id}>
            <button type="button" class="thumb-button" onClick={() => actions.highlight(v.memberIds)} aria-label={`Show ${v.name} on the page`}>
              <Thumb src={v.thumbnails[0]} label={v.name} />
            </button>
            <EditableName row={v} onRename={actions.rename} />
            <span class="diff-values">{tileDiffs(v, group)}</span>
            <span class="meta">{v.uses} {v.uses === 1 ? 'use' : 'uses'} · {screensText(v)}</span>
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

/** "Button" → "buttons", "Navigation" → "navigations"; good enough for the kinds we detect. */
function kindPlural(label: string): string {
  const l = label.toLowerCase();
  return l.endsWith('s') ? l : `${l}s`;
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

function differsText(diffs: string[]): string {
  if (diffs.length <= 2) return `differs in ${diffs.join(' and ')}`;
  return `differs in ${diffs[0]}, ${diffs[1]} and ${diffs.length - 2} more`;
}

export function OneOffListRow({ row, actions }: { row: OneOffRow; actions: RowActions }) {
  const c = row.closest;
  return (
    <VariantListRow
      row={row}
      actions={actions}
      extra={
        c && (
          <span class="closest">
            <span class="meta" title={c.differences.length ? `Differs in ${c.differences.join(', ')}` : undefined}>
              Closest: <span class="closest-name">{c.name}</span>
              {c.differences.length > 0 && ` · ${differsText(c.differences)}`}
            </span>
            <Button variant="quiet" onClick={() => actions.merge(c.id, [row.id])} title={`Treat as ${c.name}`}>Merge</Button>
          </span>
        )
      }
    />
  );
}

/* ---------- menu ---------- */

/** A small popover menu: opens upwards from the footer, or `down` below its button. Escape and outside clicks close it. */
export function Menu(props: { label: string; testId?: string; children: ComponentChildren; down?: boolean }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const items = () => [...(wrap.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
    items()[0]?.focus();
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const list = items();
        const i = list.indexOf(document.activeElement as HTMLButtonElement);
        list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div class="menu-wrap" ref={wrap}>
      <button
        ref={trigger}
        type="button"
        class="btn btn-secondary"
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid={props.testId}
        onClick={() => setOpen(!open)}
      >
        {props.label}
      </button>
      {open && (
        <div class={`menu ${props.down ? 'menu-down' : ''}`} role="menu" onClick={() => setOpen(false)}>
          {props.children}
        </div>
      )}
    </div>
  );
}

export function MenuItem(props: { onClick: () => void; children: ComponentChildren; testId?: string; hint?: string }) {
  return (
    <button type="button" role="menuitem" class="menu-item" onClick={props.onClick} data-testid={props.testId}>
      <span>{props.children}</span>
      {props.hint && <span class="menu-hint">{props.hint}</span>}
    </button>
  );
}
