"use client";

// Build a record from the schema itself. Every field, label, option and nesting
// level below comes from the record type's schema at runtime -- this page lists
// none of them, so it cannot drift from the package. Which record type is in
// the URL; the machinery is the same for all twenty-two.

import { useEffect, useMemo, useState } from "react";
import { notFound, useParams } from "next/navigation";
import { blankFor } from "../schema";
import { ObjectNode } from "../node";
import { MATERIAL_LIST, MATERIAL_SYMBOLS, PROPERTY_KEYS, PROPERTY_LIST, UNIT_LIST, UNIT_SYMBOLS } from "../vocab";
import { SCHEMA_VERSION } from "@/lib/create-model";
import { StartScreen } from "../start";
import type { Loaded } from "../load";
import { STAMPED, slugOf, typeForSlug, type RecordType } from "../types";
import { validateRecordAs } from "@/lib/validate";

// A Python function, so it only exists on a deployment: under `next dev` this
// path 404s and the button reports it.
const CONVERT_URL = "/api/convert";

const PLACEHOLDER_HINT =
  "Stands in so the record validates. BattINFO mints the real IRI when the record is saved — do not publish this one.";

type Obj = Record<string, unknown>;

function buttonClass(off = false): string {
  return `shrink-0 rounded border px-3 py-1 text-sm ${
    off ? "cursor-not-allowed border-border/40 text-ink-faint/40" : "border-border text-ink hover:border-brand-500"
  }`;
}

// Said in the confirm box, so the reason to think twice is the validator's own.
function notValidBecause(errors: { path: string; message: string }[]): string {
  const seen = new Map(errors.map((issue) => [issue.path, issue.message]));
  const shown = [...seen].slice(0, 6).map(([path, message]) => `  • ${path} — ${message}`);
  const rest = seen.size - shown.length;
  return [
    "This is not valid BattINFO yet:",
    "",
    ...shown,
    ...(rest > 0 ? [`  … and ${rest} more`] : []),
    "",
    "Save it anyway as a checkpoint to continue later?",
  ].join("\n");
}

// Drop what the user has not filled in. An empty box means "not stated", and a
// record should say nothing rather than say "". false and 0 are real answers
// and survive.
function prune(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value.map(prune).filter((item) => item !== undefined);
    return items.length ? items : undefined;
  }
  if (value !== null && typeof value === "object") {
    const out: Obj = {};
    for (const [key, item] of Object.entries(value)) {
      const kept = prune(item);
      if (kept !== undefined) out[key] = kept;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return value === "" || value === null ? undefined : value;
}

function withPlaceholder(record: Obj, type: RecordType, on: boolean): Obj {
  const body = { ...((record[type.key] ?? {}) as Obj) };
  if (on && type.placeholderId) body.id = type.placeholderId;
  else if (body.id === type.placeholderId) delete body.id;
  return { ...record, [type.key]: body };
}

function save(name: string, type: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  // Firefox will not act on a detached anchor, and aborts a download whose
  // object URL is revoked in the same task.
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function AuthorRoute() {
  const params = useParams();
  const type = typeForSlug(String(params.type ?? ""));
  if (!type) notFound();
  // Every piece of state below belongs to one record type, so changing type
  // starts again rather than carrying a cell spec's draft into a dataset.
  return <AuthorForm key={type.key} type={type} />;
}

function AuthorForm({ type }: { type: RecordType }) {
  // Nothing is shown until localStorage has been read: a chooser that appears
  // for one frame and is then replaced by restored work is worse than a pause.
  const [restored, setRestored] = useState(false);
  const [started, setStarted] = useState(false);
  // Whether there is work to come back to, so leaving the form can be undone.
  const [hasDraft, setHasDraft] = useState(false);
  const [dropped, setDropped] = useState<string[]>([]);
  const [converting, setConverting] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Obj>(() => stamp(blankFor(type.root) as Obj));

  // The toggle is not state of its own: the placeholder is on exactly when the
  // id is the sentinel, so there is nothing to keep in sync and nothing to save.
  const placeholder = (draft[type.key] as Obj | undefined)?.id === type.placeholderId;

  // Restored after mount rather than in the initialiser above: localStorage
  // does not exist while the page is prerendered, and seeding state from it
  // during render would make the server and the browser disagree.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(type.storageKey);
      const parsed = saved ? JSON.parse(saved) : null;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        setDraft(parsed as Obj);
        setStarted(true);
        setHasDraft(true);
      }
    } catch {
      // A draft that cannot be read is not worth failing the page over; the
      // chooser opens instead and the next choice overwrites it.
    }
    setRestored(true);
  }, [type.storageKey]);

  useEffect(() => {
    if (!started) return;
    try {
      window.localStorage.setItem(type.storageKey, JSON.stringify(draft));
    } catch {
      // Storage can be full, blocked, or absent in a private window. Losing the
      // draft on reload is a smaller failure than losing the form.
    }
  }, [draft, started, type.storageKey]);

  const record = useMemo(() => (prune(draft) ?? {}) as Obj, [draft]);
  const result = useMemo(() => validateRecordAs(JSON.stringify(record), type.key), [record, type.key]);
  const errors = result.issues.filter((issue) => issue.severity === "error");

  // The validator's findings, keyed by the dotted path it reports them at, so
  // each row in the tree can look up what is wrong with itself.
  const issues = useMemo(() => {
    const byPath: Map<string, string[]> = new Map();
    for (const issue of result.issues) {
      byPath.set(issue.path, [...(byPath.get(issue.path) ?? []), issue.message]);
    }
    return byPath;
  }, [result]);

  // A record that does not validate is not worth handing on, so the download
  // waits for it rather than producing a file someone else has to debug.
  // Counted by distinct path: one unsatisfied `anyOf` raises an error per
  // branch, and "13 fields" for a single missing unit would be a lie.
  const blocked = errors.length > 0;
  const stuck = new Set(errors.map((issue) => issue.path)).size;

  // One way in for all three beginnings, so they cannot drift apart.
  function begin(base: Obj, removed: string[] = []) {
    const id = ((base[type.key] ?? {}) as Obj).id;
    // A draft that brought no identity of its own gets the sentinel, so it can
    // validate while it is being written; one that brought a real IRI keeps it.
    setDraft(withPlaceholder(stamp(base), type, !id || id === type.placeholderId));
    setDropped(removed);
    setConvertError(null);
    setStarted(true);
    setHasDraft(true);
  }

  // The record itself, whole, as it stands. Saving an unfinished one is allowed
  // -- that is what a checkpoint is for -- but not silently.
  function downloadRecord() {
    if (blocked && !window.confirm(notValidBecause(errors))) return;
    save(`${slugOf(type)}.json`, "application/json", JSON.stringify(record, null, 2));
  }

  // The transform is ~5,000 lines of Python with no JavaScript equivalent, so
  // the record goes to api/convert and the real one answers.
  async function downloadJsonLd() {
    setConverting(true);
    setConvertError(null);
    try {
      const response = await fetch(CONVERT_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // record_to_jsonld registers both spellings of every type it knows, so
        // the record's own discriminator key is the name it answers to.
        body: JSON.stringify({ record_type: type.key, record }),
      });
      const text = await response.text();
      let body: { error?: string } | null = null;
      try {
        body = JSON.parse(text);
      } catch {
        // An error page rather than an answer: the status is the whole story.
      }
      if (!response.ok || !body) throw new Error(body?.error ?? `${response.status} ${response.statusText}`);
      save(`${slugOf(type)}.jsonld`, "application/ld+json", JSON.stringify(body, null, 2));
    } catch (error) {
      setConvertError(error instanceof Error ? error.message : String(error));
    } finally {
      setConverting(false);
    }
  }

  function togglePlaceholder(on: boolean) {
    setDraft((current) => withPlaceholder(current, type, on));
  }

  // The one row that carries something beyond its value: the identifier is not
  // the author's to invent, so it says what it is and offers to step aside.
  function placeholderRow(path: string) {
    if (!type.placeholderId || path !== `${type.key}.id`) return null;
    return {
      content: (
        <label className="flex cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            checked={placeholder}
            onChange={(e) => togglePlaceholder(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-border bg-surface"
          />
          placeholder
        </label>
      ),
      help: PLACEHOLDER_HINT,
    };
  }

  if (!restored) return null;

  if (!started) {
    return (
      <div className="mx-auto max-w-7xl px-6 py-8">
        <StartScreen
          type={type}
          onEmpty={() => begin(blankFor(type.root) as Obj)}
          onPick={(chosen) => begin(chosen)}
          onLoad={({ record: uploaded, removed }: Loaded) => begin(uploaded, removed)}
          onResume={hasDraft ? () => setStarted(true) : undefined}
        />
      </div>
    );
  }

  const convertTitle = !type.convertible
    ? "The JSON-LD transform has no emitter for this record type yet"
    : blocked
      ? "Fill the fields marked required first"
      : "Convert this record to EMMO-aligned JSON-LD";

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <header className="border-b border-border pb-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <button
            type="button"
            onClick={() => setStarted(false)}
            title="The screen where a record begins. This draft is kept."
            className="flex items-center gap-1.5 rounded px-2 py-1 text-sm text-ink-faint hover:bg-ink/[0.05] hover:text-ink"
          >
            <svg viewBox="0 0 12 12" aria-hidden className="w-3">
              <path d="M7.5 2.5L4 6l3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back to start
          </button>

          <span className="flex-1" />

          <p className={`flex items-center gap-1.5 text-sm ${blocked ? "text-warning" : "text-volt-400"}`}>
            {blocked ? null : (
              <svg viewBox="0 0 16 16" aria-hidden className="w-3.5">
                <path d="M3.5 8.5l3 3 6-6.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
            {blocked ? `${stuck} field${stuck === 1 ? "" : "s"} to fill` : "valid"}
          </p>
          <button
            type="button"
            onClick={downloadRecord}
            title="The record as it stands, finished or not. Re-upload it to carry on, or to start another from it."
            className="shrink-0 rounded bg-brand-500 px-3 py-1 text-sm font-medium text-white hover:bg-brand-600"
          >
            Download BattINFO JSON
          </button>
          <button
            type="button"
            disabled={blocked || converting || !type.convertible}
            onClick={downloadJsonLd}
            title={convertTitle}
            className={buttonClass(blocked || converting || !type.convertible)}
          >
            {converting ? "Converting…" : "Download JSON-LD"}
          </button>
        </div>

        {convertError ? (
          <p className="mt-2 text-right text-sm text-error">Could not convert: {convertError}</p>
        ) : null}
        {dropped.length ? (
          <p className="mt-2 text-xs text-warning">
            Dropped {dropped.length} field{dropped.length === 1 ? "" : "s"} the schemas do not define:{" "}
            {dropped.slice(0, 6).join(", ")}
            {dropped.length > 6 ? ", …" : ""}
          </p>
        ) : null}
      </header>

      <div className="mt-6 grid gap-8 xl:grid-cols-12">
        <section className="xl:col-span-7">
          <ObjectNode
            loc={type.root}
            value={draft}
            onChange={setDraft}
            issues={issues}
            after={placeholderRow}
            omit={STAMPED}
          />
        </section>

        <section className="xl:col-span-5 xl:sticky xl:top-6 xl:self-start">
          <div className="overflow-hidden rounded border border-border">
            <h2 className="border-b border-border bg-ink/[0.04] px-3 py-2 text-xs font-medium text-ink-faint">
              BattINFO JSON
            </h2>
            <pre className="max-h-[75vh] overflow-auto bg-surface p-3 text-xs leading-relaxed text-ink">
              {JSON.stringify(record, null, 2)}
            </pre>
          </div>
        </section>
      </div>

      <datalist id={UNIT_LIST}>
        {UNIT_SYMBOLS.map((unit) => (
          <option key={unit} value={unit} />
        ))}
      </datalist>
      <datalist id={PROPERTY_LIST}>
        {PROPERTY_KEYS.map((key) => (
          <option key={key} value={key} />
        ))}
      </datalist>
      <datalist id={MATERIAL_LIST}>
        {MATERIAL_SYMBOLS.map((material) => (
          <option key={material} value={material} />
        ))}
      </datalist>
    </div>
  );
}

// Every schema describes schema_version as "stamped by the library on save",
// and all 123 example records carry the same value, so the form sets it instead
// of asking -- STAMPED keeps the row out of the tree. It overrides whatever a
// loaded record arrived with, because the draft is being edited against these
// schemas and claiming an older version it no longer matches would be a lie.
function stamp(record: Obj): Obj {
  return { ...record, schema_version: SCHEMA_VERSION };
}
