"use client";

// One recursive component renders every record type. It asks the schema what
// may go here and shows only what is present plus a "+" offering the rest, so
// a 1856-field schema stays a short list.
//
// Layout rule: the row is the unit, and its slots never move --
//   structure (chevron or +) | remove | label | info | control | status
// Nesting indents the label only; the control column shrinks to fit, so
// controls line up on one right edge at any depth. Leaf rows carry a divider
// and branch headers a tint, so headers read as headings rather than fields.
//
// Order rule: plain fields first, collapsible branches after them. The scalar
// fields identify the node and are quick to fill; a branch expands and would
// push them out of sight.

import { useState } from "react";
import { blankFor, controlFor, fieldsOf, type Field, type Located } from "./schema";
import styles from "./tree.module.css";

type Obj = Record<string, unknown>;

const ROW = "group/row flex items-center gap-1.5 py-1.5 pr-1";
const LEAF_ROW = `${ROW} border-b border-ink-faint/10 hover:bg-ink/[0.03]`;
const HEAD_ROW = `${ROW} rounded-sm bg-ink/[0.05] hover:bg-ink/[0.08]`;
const CONTROL = "w-[17rem] min-w-[7rem]";
const LABEL = "min-w-0 max-w-[14rem] truncate text-sm text-ink-faint";
const TITLE = "min-w-0 max-w-[14rem] truncate text-sm font-medium text-ink";
const STATUS = "w-14 shrink-0 text-right text-[10px] uppercase tracking-wide";
const TAG = "shrink-0 text-[10px] uppercase tracking-wide text-warning";
const INPUT =
  "w-full rounded border bg-surface/60 px-2 py-1 text-sm text-ink focus:border-brand-500 focus:bg-surface focus:outline-none";

// Own-state styling lives in tree.module.css: Tailwind cannot scope a rule to
// the element's own <details>, which nested chevrons and tags need.

function withKey(obj: Obj, key: string, value: unknown): Obj {
  return { ...obj, [key]: value };
}

function withoutKey(obj: Obj, key: string): Obj {
  const next = { ...obj };
  delete next[key];
  return next;
}

// A required field that is still empty is the one thing the form should point
// at: it is what stands between the draft and a valid record.
function needsFilling(field: Field, value: unknown): boolean {
  return field.required && (value === undefined || value === "");
}

// How many required fields are still empty anywhere under this node, so a
// collapsed branch can say what it is hiding.
function missingIn(loc: Located, value: unknown): number {
  const control = controlFor(loc);
  if (control.kind === "array") {
    const items = Array.isArray(value) ? value : [];
    return items.reduce<number>((total, item) => total + missingIn(control.items, item), 0);
  }
  if (control.kind !== "object") return 0;
  const obj = (value ?? {}) as Obj;
  let total = 0;
  for (const field of fieldsOf(loc)) {
    const child = controlFor(field.loc);
    if (child.kind === "const") continue;
    if (child.kind === "object" || child.kind === "array") {
      if (field.required || field.key in obj) total += missingIn(field.loc, obj[field.key]);
    } else if (needsFilling(field, obj[field.key])) {
      total += 1;
    }
  }
  return total;
}

// Rotates when its own <details> opens, so one glyph shows both states.
function Chevron({ hidden }: { hidden?: boolean }) {
  if (hidden) return <span className="w-3 shrink-0" />;
  return (
    <svg viewBox="0 0 12 12" aria-hidden className={`w-3 shrink-0 ${styles.chevron}`}>
      <path d="M4.5 2.5l3.5 3.5-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// The schema's description, one hover away. Kept off the row itself: with one
// per field, printed descriptions drown the fields they explain.
function Info({ text }: { text?: string }) {
  if (!text) return <span className="w-3 shrink-0" />;
  return (
    <span className="group/info relative w-3 shrink-0 cursor-help text-ink-faint/40 hover:text-ink-faint">
      <svg viewBox="0 0 16 16" aria-hidden className="w-3">
        <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <path d="M8 7.2v4M8 4.6v.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
      <span className="pointer-events-none absolute left-5 top-0 z-20 hidden w-80 rounded border border-border bg-surface p-2 text-xs leading-snug text-ink shadow-lg group-hover/info:block">
        {text}
      </span>
    </span>
  );
}

function Label({ field }: { field: Field }) {
  return (
    <span className={LABEL} title={field.label}>
      {field.label}
    </span>
  );
}

// Always visible and big enough to hit. Rows that cannot be removed reserve
// the same slot so nothing shifts.
function Remove({ onClick }: { onClick?: () => void }) {
  if (!onClick) return <span className="w-6 shrink-0" />;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Remove"
      title="Remove"
      className="h-6 w-6 shrink-0 rounded text-base leading-none text-ink-faint/50 hover:bg-error/10 hover:text-error"
    >
      ×
    </button>
  );
}

function Nested({ children }: { children: React.ReactNode }) {
  return <div className="ml-[7px] border-l border-ink-faint/15 pl-5">{children}</div>;
}

// The picker: every field the schema allows here that is not present yet.
// Nothing else can be added, which keeps the record legal by construction.
// Open, it is visibly its own zone -- tinted, behind a brand rail -- so a list
// of things that could exist is never read as a list of things that do. It
// closes on choosing, because the chosen field is now a row below it.
function AddField({ options, onAdd }: { options: Field[]; onAdd: (field: Field) => void }) {
  const [open, setOpen] = useState(false);
  if (options.length === 0) return null;

  return (
    <details open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary
        className={`${ROW} cursor-pointer list-none rounded-sm text-brandtext marker:hidden hover:bg-ink/[0.03] ${styles.tintWhenOpen}`}
      >
        <Chevron />
        <span className="text-sm">
          add <span className="text-ink-faint/60">({options.length})</span>
        </span>
        <span className="flex-1" />
      </summary>
      <div className="mb-2 ml-[7px] max-h-72 overflow-y-auto border-l-2 border-brand-500/40 bg-brand-500/[0.04] pl-5">
        {options.map((field) => (
          <button
            key={field.key}
            type="button"
            onClick={() => {
              onAdd(field);
              setOpen(false);
            }}
            className={`${ROW} w-full border-b border-ink-faint/[0.07] text-left last:border-0 hover:bg-brand-500/10`}
          >
            <span className="w-3 shrink-0 text-center text-sm text-brandtext">+</span>
            <span className={`${LABEL} text-ink`} title={field.label}>
              {field.label}
            </span>
            <Info text={field.help} />
            <span className="flex-1" />
            <span className={`${CONTROL} truncate text-xs text-ink-faint/60`}>{field.help}</span>
            <span className="w-14 shrink-0" />
          </button>
        ))}
      </div>
    </details>
  );
}

function Leaf({
  field,
  value,
  onChange,
  flagged,
}: {
  field: Field;
  value: unknown;
  onChange: (next: unknown) => void;
  flagged?: boolean;
}) {
  const control = controlFor(field.loc);
  const cls = `${INPUT} ${flagged ? "border-warning/60" : "border-border"}`;

  if (control.kind === "select") {
    return (
      <select className={cls} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {control.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }

  if (control.kind === "boolean") {
    return (
      <input
        type="checkbox"
        checked={value === true}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-border bg-surface"
      />
    );
  }

  if (control.kind === "number") {
    // Keep what was typed when it is not a number yet. Storing NaN would be a
    // lie; the raw string lets the validator say "expected a number" instead.
    return (
      <input
        type="text"
        inputMode="decimal"
        className={cls}
        value={value === undefined ? "" : String(value)}
        onChange={(e) => {
          const raw = e.target.value;
          const parsed = Number(raw);
          onChange(raw.trim() !== "" && Number.isFinite(parsed) ? parsed : raw);
        }}
      />
    );
  }

  return <input type="text" className={cls} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
}

// A collapsible row with children under it: objects and arrays differ only in
// what they hold, so both use this. Tinted, undivided, and with remove at the
// far right -- the left of a header belongs to its chevron alone.
//
// Only the first level of nesting starts open; anything deeper waits to be
// asked for. The initial state is frozen at mount so that a later re-render
// never yanks a branch shut under the reader.
function Branch({
  title,
  help,
  note,
  missing,
  startOpen,
  onRemove,
  children,
}: {
  title: React.ReactNode;
  help?: string;
  note?: string;
  missing?: number;
  startOpen?: boolean;
  onRemove?: () => void;
  children: React.ReactNode;
}) {
  const [initiallyOpen] = useState(!!startOpen);
  return (
    <details open={initiallyOpen} className="mt-1">
      <summary className={`${HEAD_ROW} cursor-pointer list-none marker:hidden`}>
        <Chevron />
        <span className={TITLE}>{title}</span>
        <Info text={help} />
        <Remove onClick={onRemove} />
        {missing ? <span className={`${TAG} ${styles.hideWhenOpen}`}>{missing} required</span> : null}
        <span className="flex-1" />
        <span className={`${CONTROL} text-xs text-ink-faint/50`}>{note}</span>
      </summary>
      <Nested>{children}</Nested>
    </details>
  );
}

function ArrayBranch({
  field,
  value,
  depth,
  onChange,
  onRemove,
  startOpen,
}: {
  field: Field;
  value: unknown[];
  depth: number;
  onChange: (next: unknown[]) => void;
  onRemove?: () => void;
  startOpen?: boolean;
}) {
  const control = controlFor(field.loc);
  if (control.kind !== "array") return null;
  const itemIsObject = controlFor(control.items).kind === "object";
  const replace = (index: number, next: unknown) => onChange(value.map((item, i) => (i === index ? next : item)));
  const drop = (index: number) => onChange(value.filter((_, i) => i !== index));

  return (
    <Branch
      title={field.label}
      help={field.help}
      note={value.length ? `${value.length} item${value.length === 1 ? "" : "s"}` : undefined}
      missing={missingIn(field.loc, value)}
      startOpen={startOpen}
      onRemove={onRemove}
    >
      {value.map((item, index) =>
        itemIsObject ? (
          // An item exists because someone asked for it, so it starts open.
          <Branch key={index} title={index + 1} missing={missingIn(control.items, item)} startOpen onRemove={() => drop(index)}>
            <ObjectNode
              loc={control.items}
              value={(item ?? {}) as Obj}
              depth={depth + 1}
              onChange={(next) => replace(index, next)}
            />
          </Branch>
        ) : (
          <div key={index} className={LEAF_ROW}>
            <Chevron hidden />
            <span className={`${LABEL} tabular-nums`}>{index + 1}</span>
            <Info />
            <Remove onClick={() => drop(index)} />
            <span className="flex-1" />
            <div className={CONTROL}>
              <Leaf field={{ ...field, loc: control.items }} value={item} onChange={(next) => replace(index, next)} />
            </div>
            <span className="w-14 shrink-0" />
          </div>
        ),
      )}
      <button
        type="button"
        onClick={() => onChange([...value, blankFor(control.items)])}
        className="flex items-center gap-1.5 py-1.5 text-sm text-brandtext"
      >
        <span className="w-3 shrink-0 text-center">+</span>
        add item
      </button>
    </Branch>
  );
}

export function ObjectNode({
  loc,
  value,
  onChange,
  depth = 0,
}: {
  loc: Located;
  value: Obj;
  onChange: (next: Obj) => void;
  depth?: number;
}) {
  // Branches a reader has just asked for start open even when they sit deeper
  // than the one level shown by default.
  const [opened, setOpened] = useState<string[]>([]);

  const fields = fieldsOf(loc);
  // A value the schema fixes is already set and not worth a row.
  const editable = fields.filter((field) => controlFor(field.loc).kind !== "const");
  const shown = editable.filter((field) => field.required || field.key in value);
  const addable = editable.filter((field) => !(field.key in value));

  const isBranch = (field: Field) => ["object", "array"].includes(controlFor(field.loc).kind);
  const ordered = [...shown.filter((f) => !isBranch(f)), ...shown.filter(isBranch)];

  function add(field: Field) {
    onChange(withKey(value, field.key, blankFor(field.loc)));
    if (isBranch(field)) setOpened((keys) => [...keys, field.key]);
  }

  return (
    <div>
      {ordered.map((field) => {
        const control = controlFor(field.loc);
        const set = (next: unknown) => onChange(withKey(value, field.key, next));
        const remove = field.required ? undefined : () => onChange(withoutKey(value, field.key));
        const startOpen = depth === 0 || opened.includes(field.key);

        if (control.kind === "object") {
          return (
            <Branch
              key={field.key}
              title={field.label}
              help={field.help}
              missing={missingIn(field.loc, value[field.key])}
              startOpen={startOpen}
              onRemove={remove}
            >
              <ObjectNode
                loc={field.loc}
                value={(value[field.key] ?? {}) as Obj}
                depth={depth + 1}
                onChange={set}
              />
            </Branch>
          );
        }

        if (control.kind === "array") {
          return (
            <ArrayBranch
              key={field.key}
              field={field}
              value={(value[field.key] ?? []) as unknown[]}
              depth={depth}
              startOpen={startOpen}
              onChange={set}
              onRemove={remove}
            />
          );
        }

        const flagged = needsFilling(field, value[field.key]);
        return (
          <div key={field.key} className={LEAF_ROW}>
            <Chevron hidden />
            <Label field={field} />
            <Info text={field.help} />
            <Remove onClick={remove} />
            <span className="flex-1" />
            <div className={CONTROL}>
              <Leaf field={field} value={value[field.key]} onChange={set} flagged={flagged} />
            </div>
            <span className={`${STATUS} ${flagged ? "text-warning" : "text-transparent"}`}>{flagged ? "required" : ""}</span>
          </div>
        );
      })}

      <AddField options={addable} onAdd={add} />
    </div>
  );
}
