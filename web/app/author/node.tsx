"use client";

// One recursive component renders every record type. It asks the schema what
// may go here and shows only what is present plus a "+" offering the rest, so
// a 1856-field schema stays a short list.
//
// Layout rule: the row is the unit, and its slots never move --
//   structure (chevron or +) | label | info | remove | control | state
// The label names the row and the right-hand side carries everything about the
// value: the control, whether it is still wanted, and what the validator says
// about it. Nesting indents the label only; the control column shrinks to fit,
// so controls line up on one right edge at any depth.
//
// Order rule: plain fields first, collapsible branches after them.
//
// Errors are not re-derived here. Every row asks the validator's own issue list
// what is wrong at its path, so pattern, format, length and the anyOf rules all
// surface without this file knowing any of them.

import { useState } from "react";
import { blankFor, controlFor, fieldsOf, requiredGroups, type Field, type Located } from "./schema";
import styles from "./tree.module.css";
import { SUGGESTS } from "./vocab";

type Obj = Record<string, unknown>;

// Dotted paths as lib/validate.ts reports them: "cell_spec.id", "notes.0".
export type Issues = Map<string, string[]>;

const ROW = "group/row flex items-center gap-1.5 py-1.5 pr-1";
const LEAF_ROW = `${ROW} hover:bg-ink/[0.03]`;
const HEAD_ROW = `${ROW} rounded-sm bg-ink/[0.05] hover:bg-ink/[0.08]`;
const DIVIDED = "border-b border-ink-faint/10";
const CONTROL = "w-[17rem] min-w-[7rem]";
const STATE = "w-16 shrink-0 pl-1.5 text-[10px] uppercase leading-tight tracking-wide";
const LABEL = "min-w-0 max-w-[14rem] truncate text-sm text-ink-faint";
const TITLE = "min-w-0 max-w-[14rem] truncate text-sm font-medium text-ink";
const TAG = "shrink-0 text-[10px] uppercase tracking-wide text-warning";
const INPUT =
  "w-full rounded border bg-surface/60 px-2 py-1 text-sm text-ink focus:border-brand-500 focus:bg-surface focus:outline-none";

// A schema `format` names a closed shape the browser already knows how to
// collect, so the control becomes the right one instead of a bare text box.
// `date-time` is deliberately absent: the native picker yields "2026-09-17T10:30"
// with no offset, which the format then rejects -- a worse box than a plain one.
const INPUT_TYPE: Record<string, string> = { uri: "url", email: "email", date: "date" };

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

function join(path: string, key: string | number): string {
  return path ? `${path}.${key}` : String(key);
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === "";
}

// Everything wrong at this path or anywhere beneath it, so a collapsed branch
// can say what it is hiding.
function countUnder(issues: Issues, path: string): number {
  let total = 0;
  for (const [at, messages] of issues) {
    if (at === path || at.startsWith(`${path}.`)) total += messages.length;
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

// What the validator says, under the control it is about rather than under the
// label, so the complaint sits with the thing complained about.
function Problem({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div className="flex pb-1 pr-1">
      <span className="flex-1" />
      <p className={`${CONTROL} text-[11px] leading-snug text-warning`}>{message}</p>
      <span className="w-16 shrink-0" />
    </div>
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
            className={`${ROW} ${DIVIDED} w-full text-left last:border-0 hover:bg-brand-500/10`}
          >
            <span className="w-3 shrink-0 text-center text-sm text-brandtext">+</span>
            <span className={`${LABEL} text-ink`} title={field.label}>
              {field.label}
            </span>
            <Info text={field.help} />
            <span className="flex-1" />
            <span className={`${CONTROL} truncate text-xs text-ink-faint/60`}>{field.help}</span>
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

  return (
    <input
      type={control.kind === "text" ? (INPUT_TYPE[control.format ?? ""] ?? "text") : "text"}
      list={SUGGESTS[field.key]}
      className={cls}
      value={String(value ?? "")}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

// A collapsible row with children under it: objects and arrays differ only in
// what they hold, so both use this. Tinted and undivided, so it reads as a
// heading over the rows it contains. Its count stays on the left, because it
// describes what opening the section would reveal rather than a value.
//
// Only the first level of nesting starts open; anything deeper waits to be
// asked for. The initial state is frozen at mount so that a later re-render
// never yanks a branch shut under the reader.
function Branch({
  title,
  help,
  note,
  problems,
  startOpen,
  onRemove,
  children,
}: {
  title: React.ReactNode;
  help?: string;
  note?: string;
  problems?: number;
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
        {problems ? <span className={`${TAG} ${styles.hideWhenOpen}`}>{problems} to fix</span> : null}
        <span className="flex-1" />
        <span className={`${CONTROL} text-xs text-ink-faint/50`}>{note}</span>
        <span className="w-16 shrink-0" />
      </summary>
      <Nested>{children}</Nested>
    </details>
  );
}

function ArrayBranch({
  field,
  value,
  path,
  depth,
  issues,
  onChange,
  onRemove,
  startOpen,
}: {
  field: Field;
  value: unknown[];
  path: string;
  depth: number;
  issues: Issues;
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
      problems={countUnder(issues, path)}
      startOpen={startOpen}
      onRemove={onRemove}
    >
      {value.map((item, index) => {
        const itemPath = join(path, index);
        const problem = issues.get(itemPath)?.[0];
        return itemIsObject ? (
          // An item exists because someone asked for it, so it starts open.
          <Branch key={index} title={index + 1} problems={countUnder(issues, itemPath)} startOpen onRemove={() => drop(index)}>
            <ObjectNode
              loc={control.items}
              value={(item ?? {}) as Obj}
              path={itemPath}
              depth={depth + 1}
              issues={issues}
              onChange={(next) => replace(index, next)}
            />
          </Branch>
        ) : (
          <div key={index} className={DIVIDED}>
            <div className={LEAF_ROW}>
              <Chevron hidden />
              <span className={`${LABEL} tabular-nums`}>{index + 1}</span>
              <Info />
              <Remove onClick={() => drop(index)} />
              <span className="flex-1" />
              <div className={CONTROL}>
                <Leaf field={{ ...field, loc: control.items }} value={item} onChange={(next) => replace(index, next)} flagged={!!problem} />
              </div>
              <span className={STATE} />
            </div>
            <Problem message={problem} />
          </div>
        );
      })}
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
  issues,
  path = "",
  depth = 0,
}: {
  loc: Located;
  value: Obj;
  onChange: (next: Obj) => void;
  issues: Issues;
  path?: string;
  depth?: number;
}) {
  // Branches a reader has just asked for start open even when they sit deeper
  // than the one level shown by default.
  const [opened, setOpened] = useState<string[]>([]);

  const fields = fieldsOf(loc);
  // A value the schema fixes is already set and not worth a row.
  const editable = fields.filter((field) => controlFor(field.loc).kind !== "const");
  const byKey = (key: string) => editable.find((field) => field.key === key);

  // A choice the schema states as "one of these": the row is the choice, so its
  // label is a selector rather than a name. The member on show is owned by that
  // row; any further members the record also carries stay ordinary rows, so
  // nothing a record holds is ever hidden.
  const groups = requiredGroups(loc).map((keys) => ({ keys, chosen: keys.find((key) => key in value) }));
  const owned = new Set(groups.map((group) => group.chosen).filter(Boolean) as string[]);

  const shown = editable.filter((field) => (field.required || field.key in value) && !owned.has(field.key));
  const addable = editable.filter((field) => !(field.key in value));

  const isBranch = (field: Field) => ["object", "array"].includes(controlFor(field.loc).kind);
  const ordered = [...shown.filter((f) => !isBranch(f)), ...shown.filter(isBranch)];

  function add(field: Field) {
    onChange(withKey(value, field.key, blankFor(field.loc)));
    if (isBranch(field)) setOpened((keys) => [...keys, field.key]);
  }

  // Switching the selector moves the row to another member of its group.
  function choose(group: string[], nextKey: string) {
    const current = group.find((key) => key in value);
    let next = current ? withoutKey(value, current) : { ...value };
    const field = nextKey ? byKey(nextKey) : undefined;
    onChange(field ? withKey(next, field.key, blankFor(field.loc)) : next);
  }

  return (
    <div>
      {groups.map((group) => {
        const field = group.chosen ? byKey(group.chosen) : undefined;
        const here = field ? join(path, field.key) : "";
        const current = field ? value[field.key] : undefined;
        const problem = field ? issues.get(here)?.[0] : undefined;
        const awaited = !field || (isEmpty(current) && !!problem);
        return (
          <div key={group.keys.join()} className={DIVIDED}>
            <div className={LEAF_ROW}>
              <Chevron hidden />
              <select
                value={group.chosen ?? ""}
                onChange={(e) => choose(group.keys, e.target.value)}
                title="Which of these the record states"
                className={`${LABEL} rounded border border-transparent bg-transparent py-0.5 hover:border-border focus:border-brand-500 focus:outline-none`}
              >
                <option value="">choose…</option>
                {group.keys.map((key) => (
                  <option key={key} value={key}>
                    {byKey(key)?.label ?? key}
                  </option>
                ))}
              </select>
              <Info text={field?.help} />
              <Remove onClick={group.chosen ? () => choose(group.keys, "") : undefined} />
              <span className="flex-1" />
              <div className={CONTROL}>
                {field ? (
                  <Leaf field={field} value={current} onChange={(next) => onChange(withKey(value, field.key, next))} flagged={awaited} />
                ) : (
                  <p className="px-2 py-1 text-xs text-ink-faint/60">choose one on the left</p>
                )}
              </div>
              <span className={`${STATE} ${awaited ? "text-warning" : "text-transparent"}`}>required</span>
            </div>
            <Problem message={awaited ? undefined : problem} />
          </div>
        );
      })}

      {ordered.map((field) => {
        const control = controlFor(field.loc);
        const here = join(path, field.key);
        const set = (next: unknown) => onChange(withKey(value, field.key, next));
        const remove = field.required ? undefined : () => onChange(withoutKey(value, field.key));
        const startOpen = depth === 0 || opened.includes(field.key);

        if (control.kind === "object") {
          return (
            <Branch
              key={field.key}
              title={field.label}
              help={field.help}
              problems={countUnder(issues, here)}
              startOpen={startOpen}
              onRemove={remove}
            >
              <ObjectNode
                loc={field.loc}
                value={(value[field.key] ?? {}) as Obj}
                path={here}
                depth={depth + 1}
                issues={issues}
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
              path={here}
              depth={depth}
              issues={issues}
              startOpen={startOpen}
              onChange={set}
              onRemove={remove}
            />
          );
        }

        // An empty box that something is waiting on says so in one word. The
        // validator's own sentence is kept for a value that is present but
        // wrong, where the reason actually needs explaining.
        const current = value[field.key];
        const problem = issues.get(here)?.[0];
        const awaited = isEmpty(current) && (field.required || !!problem);
        return (
          <div key={field.key} className={DIVIDED}>
            <div className={LEAF_ROW}>
              <Chevron hidden />
              <Label field={field} />
              <Info text={field.help} />
              <Remove onClick={remove} />
              <span className="flex-1" />
              <div className={CONTROL}>
                <Leaf field={field} value={current} onChange={set} flagged={awaited || !!problem} />
              </div>
              <span className={`${STATE} ${awaited ? "text-warning" : "text-transparent"}`}>required</span>
            </div>
            <Problem message={awaited ? undefined : problem} />
          </div>
        );
      })}

      <AddField options={addable} onAdd={add} />
    </div>
  );
}

function Label({ field }: { field: Field }) {
  return (
    <span className={LABEL} title={field.label}>
      {field.label}
    </span>
  );
}
