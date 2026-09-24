"use client";

// One recursive component renders every record type. It asks the schema what
// may go here and shows only what is present plus a "+" offering the rest, so
// a 1856-field schema stays a short list.
//
// Layout rule: the row is the unit, and its slots never move --
//   structure (chevron or +) | label | remove | info | control | state
// The label names the row and the right-hand side carries everything about the
// value: the control, whether it is still wanted, and what the validator says
// about it. Nesting indents the label only; the control column shrinks to fit,
// so controls line up on one right edge at any depth. Every row that holds a
// value is one ValueRow, whatever names it -- a field, an index, a map key, or
// a selector -- so the shape is defined once.
//
// Order rule: what cannot collapse, then choices that can, then ordinary
// sections. A choice about this node sits between its values and its parts.
//
// Errors are not re-derived here. Every row asks the validator's own issue list
// what is wrong at its path, so pattern, format, length and the anyOf rules all
// surface without this file knowing any of them.

import { useState } from "react";
import { blankFor, controlFor, fieldsOf, join, requiredGroups, type Field, type Located } from "./schema";
import styles from "./tree.module.css";
import { PROPERTY_LIST, SUGGESTS } from "./vocab";

type Obj = Record<string, unknown>;

// Dotted paths as lib/validate.ts reports them: "cell_spec.id", "notes.0".
type Issues = Map<string, string[]>;

// Something the page wants to add under one row: the content, and optionally a
// line explaining it, which the tree shows through the same icon every other
// explanation uses.
type After = (path: string) => { content: React.ReactNode; help?: string } | null;

const ROW = "group/row flex items-center gap-1.5 py-1.5 pr-1";
const LEAF_ROW = `${ROW} hover:bg-ink/[0.03]`;
const DIVIDED = "border-b border-ink-faint/10";
const HEAD_ROW = `${ROW} ${DIVIDED} rounded-sm pl-2 hover:bg-ink/[0.04]`;
const CONTROL = "w-[16rem] min-w-[7rem]";
const NAME = "min-w-0 max-w-[14rem] truncate text-sm";
const LABEL = `${NAME} text-ink-faint`;
const TITLE = `${NAME} font-medium text-ink`;
const SMALL = "text-[10px] uppercase tracking-wide";
const STATE = `w-16 shrink-0 pl-1.5 leading-tight ${SMALL}`;
const TAG = `shrink-0 text-warning ${SMALL}`;
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

// The schema's description, one hover away, and sitting beside the control it
// describes rather than beside the label: the question is always "what do I put
// in this box". Kept to an icon because one printed description per field drowns
// the fields it explains.
// Reachable by keyboard as well as by pointer, and the same sentence rides on
// `title` so it survives for a screen reader and for anyone the hover panel
// never reaches.
function Info({ text }: { text?: string }) {
  if (!text) return <span className="w-3.5 shrink-0" />;
  return (
    <span
      tabIndex={0}
      title={text}
      className="group/info relative w-3.5 shrink-0 cursor-help text-ink-faint/20 outline-none transition-colors group-hover/row:text-ink-faint/60 hover:!text-ink-faint focus-visible:!text-ink-faint"
    >
      <svg viewBox="0 0 16 16" aria-hidden className="w-3.5">
        <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <path
          d="M6.1 6.1a1.9 1.9 0 1 1 2.5 1.8c-.4.15-.6.5-.6.9v.3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
        <circle cx="8" cy="11.6" r="0.75" fill="currentColor" />
      </svg>
      <span
        aria-hidden
        className="pointer-events-none absolute right-5 top-0 z-20 hidden w-80 rounded border border-border bg-surface p-2 text-xs leading-snug text-ink shadow-lg group-hover/info:block group-focus/info:block"
      >
        {text}
      </span>
    </span>
  );
}

// A line under the control it is about, rather than under the label, so what is
// said sits with the thing it is said about. Carries either the validator's
// complaint or a neutral note the page attached to this path.
function UnderControl({ text, children }: { text?: string; children?: React.ReactNode }) {
  if (!text && !children) return null;
  return (
    <div className="flex pb-1 pr-1">
      <span className="flex-1" />
      <div className={`${CONTROL} text-[11px] leading-snug ${text ? "text-warning" : "text-ink-faint"}`}>
        {text ?? children}
      </div>
      <span className="w-16 shrink-0" />
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

// Every row that carries a value, whatever names it on the left. Keeping the
// one shape here is what stops a change to rows having to be made four times.
function ValueRow({
  label,
  help,
  onRemove,
  wanted,
  problem,
  extra,
  children,
}: {
  label: React.ReactNode;
  help?: string;
  onRemove?: () => void;
  wanted?: boolean;
  problem?: string;
  extra?: { content: React.ReactNode; help?: string } | null;
  children: React.ReactNode;
}) {
  return (
    <div className={DIVIDED}>
      <div className={LEAF_ROW}>
        <Chevron hidden />
        {label}
        <Remove onClick={onRemove} />
        <span className="flex-1" />
        <Info text={help} />
        <div className={CONTROL}>{children}</div>
        {/* The slot is always there so nothing shifts, but the word only
            exists when it is true: `text-transparent` hid it from the eye and
            left every row announcing "required" to a screen reader. */}
        <span className={`${STATE} text-warning`}>{wanted ? "required" : null}</span>
      </div>
      <UnderControl text={problem} />
      {extra ? (
        <UnderControl>
          <span className="flex items-center gap-1.5">
            {extra.content}
            <Info text={extra.help} />
          </span>
        </UnderControl>
      ) : null}
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
            <span className="flex-1" />
            <span className={`${CONTROL} truncate text-xs text-ink-faint/60`}>{field.help}</span>
          </button>
        ))}
      </div>
    </details>
  );
}

// The record holds a number; the box holds what was typed. They diverge only
// while a decimal is half-written -- "0.0" on the way to "0.05" is already a
// whole number whose own text is "0", so echoing the record back would eat the
// digit under the cursor and put 0.05 out of reach. The typed text therefore
// wins for as long as it still parses to the value this box emitted; a value
// from anywhere else (a template, an upload, a reset) does not parse back and
// takes over.
function NumberInput({
  value,
  onChange,
  className,
  label,
}: {
  value: unknown;
  onChange: (next: unknown) => void;
  className: string;
  label: string;
}) {
  const [typed, setTyped] = useState(value === undefined ? "" : String(value));
  const mine = typed.trim() !== "" && Number(typed) === value;
  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={label}
      className={className}
      value={mine ? typed : value === undefined ? "" : String(value)}
      onChange={(e) => {
        const raw = e.target.value;
        setTyped(raw);
        // Keep what was typed when it is not a number yet. Storing NaN would be
        // a lie; the raw string lets the validator say "expected a number".
        const parsed = Number(raw);
        onChange(raw.trim() !== "" && Number.isFinite(parsed) ? parsed : raw);
      }}
    />
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
      <select aria-label={field.label} className={cls} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
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
        aria-label={field.label}
        checked={value === true}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-border bg-surface"
      />
    );
  }

  if (control.kind === "number") {
    return <NumberInput value={value} onChange={onChange} className={cls} label={field.label} />;
  }

  return (
    <input
      type={control.kind === "text" ? (INPUT_TYPE[control.format ?? ""] ?? "text") : "text"}
      list={SUGGESTS[field.key]}
      aria-label={field.label}
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
    <details open={initiallyOpen} className="mt-3 first:mt-0">
      <summary className={`${HEAD_ROW} ${styles.headWhenOpen} cursor-pointer list-none marker:hidden`}>
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
  title,
  value,
  path,
  depth,
  issues,
  after,
  onChange,
  onRemove,
  startOpen,
}: {
  field: Field;
  title?: React.ReactNode;
  value: unknown[];
  path: string;
  depth: number;
  issues: Issues;
  after?: After;
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
      title={title ?? field.label}
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
              after={after}
              onChange={(next) => replace(index, next)}
            />
          </Branch>
        ) : (
          <ValueRow
            key={index}
            label={<span className={`${LABEL} tabular-nums`}>{index + 1}</span>}
            onRemove={() => drop(index)}
            problem={problem}
            extra={after?.(itemPath)}
          >
            <Leaf
              field={{ ...field, label: `${field.label} ${index + 1}`, loc: control.items }}
              value={item}
              onChange={(next) => replace(index, next)}
              flagged={!!problem}
            />
          </ValueRow>
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

// A named map: the keys are the author's (a property called "diameter", say),
// the values all share one schema. It is a container like an object, but the
// schema cannot list what is in it, so the form asks for the name too.
function MapBranch({
  field,
  title,
  value,
  path,
  depth,
  issues,
  after,
  onChange,
  onRemove,
  startOpen,
}: {
  field: Field;
  title?: React.ReactNode;
  value: Obj;
  path: string;
  depth: number;
  issues: Issues;
  after?: After;
  onChange: (next: Obj) => void;
  onRemove?: () => void;
  startOpen?: boolean;
}) {
  const [name, setName] = useState("");
  const control = controlFor(field.loc);
  if (control.kind !== "map") return null;
  const values = control.values;
  const pattern = control.keyPattern ?? ".";

  const entries = Object.entries(value);
  const nested = ["object", "map"].includes(controlFor(values).kind);
  const legal = name !== "" && !(name in value) && new RegExp(pattern).test(name);

  function add() {
    if (!legal) return;
    onChange({ ...value, [name]: blankFor(values) as Obj });
    setName("");
  }

  function drop(key: string) {
    const next = { ...value };
    delete next[key];
    onChange(next);
  }

  return (
    <Branch
      title={title ?? field.label}
      help={field.help}
      note={entries.length ? `${entries.length} entr${entries.length === 1 ? "y" : "ies"}` : undefined}
      problems={countUnder(issues, path)}
      startOpen={startOpen}
      onRemove={onRemove}
    >
      {entries.map(([key, item]) => {
        const here = join(path, key);
        return nested ? (
          <Branch key={key} title={key} problems={countUnder(issues, here)} startOpen onRemove={() => drop(key)}>
            <ObjectNode
              loc={values}
              value={(item ?? {}) as Obj}
              path={here}
              depth={depth + 1}
              issues={issues}
              after={after}
              onChange={(next) => onChange({ ...value, [key]: next })}
            />
          </Branch>
        ) : (
          <ValueRow
            key={key}
            label={<span className={LABEL}>{key}</span>}
            onRemove={() => drop(key)}
            problem={issues.get(here)?.[0]}
            extra={after?.(here)}
          >
            <Leaf
              field={{ ...field, label: key, loc: values }}
              value={item}
              onChange={(next) => onChange({ ...value, [key]: next })}
              flagged={issues.has(here)}
            />
          </ValueRow>
        );
      })}

      <div className={LEAF_ROW}>
        <span className="w-3 shrink-0 text-center text-sm text-brandtext">+</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="name"
          aria-label={`Name of a new ${field.label} entry`}
          list={PROPERTY_LIST}
          className={`${LABEL} rounded border border-border bg-surface/60 px-2 py-0.5 text-ink focus:border-brand-500 focus:outline-none`}
        />
        <button
          type="button"
          onClick={add}
          disabled={!legal}
          className={`text-sm ${legal ? "text-brandtext" : "cursor-not-allowed text-ink-faint/40"}`}
        >
          add
        </button>
        <span className="flex-1" />
      </div>
    </Branch>
  );
}

export function ObjectNode({
  loc,
  value,
  onChange,
  issues,
  after,
  omit,
  path = "",
  depth = 0,
}: {
  loc: Located;
  value: Obj;
  onChange: (next: Obj) => void;
  issues: Issues;
  after?: After;
  /** Keys the page fills in itself. Deliberately not passed to children: only
   *  the record's own top level has fields the library stamps. */
  omit?: string[];
  path?: string;
  depth?: number;
}) {
  // Branches a reader has just asked for start open even when they sit deeper
  // than the one level shown by default.
  const [opened, setOpened] = useState<string[]>([]);

  const fields = fieldsOf(loc).filter((field) => !omit?.includes(field.key));
  // A value the schema fixes is already set and not worth a row.
  const editable = fields.filter((field) => controlFor(field.loc).kind !== "const");
  const byKey = (key: string) => editable.find((field) => field.key === key);

  // A choice the schema states as "one of these": the row is the choice, so its
  // label is a selector rather than a name. The member on show is owned by that
  // row; any further members the record also carries stay ordinary rows, so
  // nothing a record holds is ever hidden.
  // A group only offers members this node can actually render. A required-group
  // may name a key that is not an editable property here -- a value the schema
  // fixes, or one declared in a branch rather than in `properties` -- and a
  // selector option that resolves to no field would crash the row rather than
  // fill it. No schema does this today; twenty-two record types is not the
  // place to rely on that.
  const groups = requiredGroups(loc)
    .map((keys) => keys.filter((key) => byKey(key)))
    .filter((keys) => keys.length > 1)
    .map((keys) => {
      const chosen = keys.find((key) => key in value);
      const kind = chosen ? controlFor((byKey(chosen) as Field).loc).kind : "";
      return { keys, chosen, collapsible: ["object", "map", "array"].includes(kind) };
    });
  const owned = new Set(groups.map((group) => group.chosen).filter(Boolean) as string[]);

  const shown = editable.filter((field) => (field.required || field.key in value) && !owned.has(field.key));
  const addable = editable.filter((field) => !(field.key in value));

  const isBranch = (field: Field) => ["object", "map", "array"].includes(controlFor(field.loc).kind);
  const leaves = shown.filter((field) => !isBranch(field));
  const branches = shown.filter(isBranch);

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

  function renderGroup(group: (typeof groups)[number]) {
        const field = group.chosen ? byKey(group.chosen) : undefined;
        const here = field ? join(path, field.key) : "";
        const current = field ? value[field.key] : undefined;
        const problem = field ? issues.get(here)?.[0] : undefined;
        const control = field ? controlFor(field.loc) : undefined;
        const awaited = !field || (isEmpty(current) && !!problem);
        const set = (next: unknown) => (field ? onChange(withKey(value, field.key, next)) : undefined);

        const collapsible = !!control && ["object", "map", "array"].includes(control.kind);

        // The selector IS the row's name, so it goes wherever a label would --
        // and when it names a section it carries a heading's weight.
        const selector = (
          <select
            value={group.chosen ?? ""}
            onChange={(e) => choose(group.keys, e.target.value)}
            title="Which of these the record states"
            className={`${collapsible ? TITLE : LABEL} rounded border border-transparent bg-transparent py-0.5 hover:border-border focus:border-brand-500 focus:outline-none`}
          >
            <option value="">choose…</option>
            {group.keys.map((key) => (
              <option key={key} value={key}>
                {byKey(key)?.label ?? key}
              </option>
            ))}
          </select>
        );

        // A member of the group can be a whole object or a list, not just a
        // value -- an electrode is "one of spec id, coating, current collector,
        // property", and three of those are objects. Such a choice opens as a
        // section under the selector rather than being forced into a text box.
        if (field && control && collapsible) {
          if (control.kind === "map") {
            return (
              <MapBranch
                key={group.keys.join()}
                field={field}
                title={selector}
                value={(current ?? {}) as Obj}
                path={here}
                depth={depth}
                issues={issues}
                after={after}
                startOpen
                onChange={set as (next: Obj) => void}
                onRemove={() => choose(group.keys, "")}
              />
            );
          }
          return control.kind === "array" ? (
            <ArrayBranch
              key={group.keys.join()}
              field={field}
              title={selector}
              value={(current ?? []) as unknown[]}
              path={here}
              depth={depth}
              issues={issues}
              after={after}
              startOpen
              onChange={set}
              onRemove={() => choose(group.keys, "")}
            />
          ) : (
            <Branch
              key={group.keys.join()}
              title={selector}
              help={field.help}
              problems={countUnder(issues, here)}
              startOpen
              onRemove={() => choose(group.keys, "")}
            >
              <ObjectNode
                loc={field.loc}
                value={(current ?? {}) as Obj}
                path={here}
                depth={depth + 1}
                issues={issues}
                after={after}
                onChange={set}
              />
            </Branch>
          );
        }

        return (
          <ValueRow
            key={group.keys.join()}
            label={selector}
            help={field?.help}
            onRemove={group.chosen ? () => choose(group.keys, "") : undefined}
            wanted={awaited}
            problem={awaited ? undefined : problem}
            extra={field ? after?.(here) : null}
          >
            {field ? (
              <Leaf field={field} value={current} onChange={set} flagged={awaited} />
            ) : (
              <p className="px-2 py-1 text-xs text-ink-faint/60">choose one on the left</p>
            )}
          </ValueRow>
        );
  }

  function renderField(field: Field) {
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
                after={after}
                onChange={set}
              />
            </Branch>
          );
        }

        if (control.kind === "map") {
          return (
            <MapBranch
              key={field.key}
              field={field}
              value={(value[field.key] ?? {}) as Obj}
              path={here}
              depth={depth}
              issues={issues}
              after={after}
              startOpen={startOpen}
              onChange={set as (next: Obj) => void}
              onRemove={remove}
            />
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
              after={after}
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
        const extra = after?.(here);
        const awaited = isEmpty(current) && (field.required || !!problem);
        return (
          <ValueRow
            key={field.key}
            label={<Label field={field} />}
            help={field.help}
            onRemove={remove}
            wanted={awaited}
            problem={awaited ? undefined : problem}
            extra={extra}
          >
            <Leaf field={field} value={current} onChange={set} flagged={awaited || !!problem} />
          </ValueRow>
        );
  }

  return (
    <div>

      {leaves.map(renderField)}
      {groups.filter((group) => !group.collapsible).map(renderGroup)}
      {groups.filter((group) => group.collapsible).map(renderGroup)}
      {branches.map(renderField)}

      <AddField options={addable} onAdd={add} />
    </div>
  );
}

