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
import { StartScreen } from "../start";
import { asDraft, type Loaded } from "../load";
import { DERIVED_IDENTITY, notAuthored, slugOf, typeForSlug, type RecordType } from "../types";
import { validateRecordAs } from "@/lib/validate";

type Obj = Record<string, unknown>;

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
  // Nothing is shown until localStorage has been read: a chooser whose resume
  // card pops in a frame later is worse than a pause.
  const [restored, setRestored] = useState(false);
  // Only ever set by a choice on the start screen. A saved draft is offered,
  // never resumed on its own -- changing the record type lands you on that
  // type's start screen, not inside whatever you last left half-written there.
  const [started, setStarted] = useState(false);
  // Whether there is work to come back to, so leaving the form can be undone.
  const [hasDraft, setHasDraft] = useState(false);
  const [dropped, setDropped] = useState<string[]>([]);
  // An identifier a loaded record arrived with. Left out of the draft, and said
  // out loud rather than vanishing.
  const [releasedId, setReleasedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Obj>(() => asDraft(blankFor(type.root) as Obj, type));

  // Restored after mount rather than in the initialiser above: localStorage
  // does not exist while the page is prerendered, and seeding state from it
  // during render would make the server and the browser disagree.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(type.storageKey);
      const parsed = saved ? JSON.parse(saved) : null;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        // Through asDraft as well: a draft saved by an earlier build of this
        // page can still be carrying a placeholder identifier.
        setDraft(asDraft(parsed as Obj, type));
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

  // The identity the library derives at save time. The schemas require an `id`
  // (and a dataset's `identifier`), so a draft that rightly omits one is still
  // reported as missing it. This is the only place the form sets the
  // validator's verdict aside, so it is spelled out here and said plainly in
  // the status line rather than quietly swallowed.
  const derived = useMemo(
    () => new Set(DERIVED_IDENTITY.map((key) => `${type.key}.${key}`)),
    [type.key],
  );
  const outstanding = errors.filter((issue) => !derived.has(issue.path));

  // A record that does not validate is not worth handing on, so the download
  // waits for it rather than producing a file someone else has to debug.
  // Counted by distinct path: one unsatisfied `anyOf` raises an error per
  // branch, and "13 fields" for a single missing unit would be a lie.
  const blocked = outstanding.length > 0;
  const stuck = new Set(outstanding.map((issue) => issue.path)).size;

  // One way in for all three beginnings, so they cannot drift apart.
  function begin(base: Obj, removed: string[] = []) {
    const arrived = ((base[type.key] ?? {}) as Obj).id;
    setReleasedId(typeof arrived === "string" ? arrived : null);
    setDraft(asDraft(base, type));
    setDropped(removed);
    setStarted(true);
    setHasDraft(true);
  }

  // The record itself, whole, as it stands. Saving an unfinished one is allowed
  // -- that is what a checkpoint is for -- but not silently.
  function downloadRecord() {
    if (blocked && !window.confirm(notValidBecause(outstanding))) return;
    save(`${slugOf(type)}.json`, "application/json", JSON.stringify(record, null, 2));
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
            {blocked ? `${stuck} field${stuck === 1 ? "" : "s"} to fill` : "valid draft"}
          </p>
          <button
            type="button"
            onClick={downloadRecord}
            title="The record as it stands, finished or not. Re-upload it to carry on, or to start another from it."
            className="shrink-0 rounded bg-brand-500 px-3 py-1 text-sm font-medium text-white hover:bg-brand-600"
          >
            Download BattINFO JSON
          </button>
        </div>

        {releasedId ? (
          <p className="mt-2 text-xs text-ink-faint">
            That record arrived with the identifier <code className="font-mono">{releasedId}</code>. A draft does
            not carry one — BattINFO mints it from the record&rsquo;s own identity when you save.
          </p>
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
            omit={notAuthored(type)}
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
