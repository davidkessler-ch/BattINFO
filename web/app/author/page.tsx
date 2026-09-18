"use client";

// Build a cell spec from the schema itself. Every field, label, option and
// nesting level below comes from cell-spec.schema.json at runtime -- this page
// lists none of them, so it cannot drift from the package.

import { useMemo, useState } from "react";
import { blankFor, schemaFor } from "./schema";
import { ObjectNode } from "./node";
import { MATERIAL_LIST, MATERIAL_SYMBOLS, PROPERTY_KEYS, PROPERTY_LIST, UNIT_LIST, UNIT_SYMBOLS } from "./vocab";
import { SCHEMA_VERSION } from "@/lib/create-model";
import { TEMPLATES } from "@/lib/templates.generated";
import { validateRecordAs } from "@/lib/validate";

const RECORD_TYPE = "cell_spec";
const SCHEMA_FILE = "cell-spec.schema.json";

// The sentinel the package uses for its own starter documents
// (battinfo.api._shared.TEMPLATE_CELL_SPEC_ID). It satisfies the SpecIri
// pattern, so a draft validates, and the library replaces it when it mints the
// real IRI on save. Nothing here invents an identifier.
const PLACEHOLDER_ID = "https://w3id.org/battinfo/spec/0000-0000-0000-0000";
const PLACEHOLDER_HINT =
  "Stands in so the record validates. BattINFO mints the real IRI when the record is saved — do not publish this one.";

type Obj = Record<string, unknown>;

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

function withPlaceholder(record: Obj, on: boolean): Obj {
  const spec = { ...((record.cell_spec ?? {}) as Obj) };
  if (on) spec.id = PLACEHOLDER_ID;
  else if (spec.id === PLACEHOLDER_ID) delete spec.id;
  return { ...record, cell_spec: spec };
}

function download(record: unknown) {
  const blob = new Blob([JSON.stringify(record, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "cell-spec.json";
  link.click();
  URL.revokeObjectURL(url);
}

export default function AuthorPage() {
  const root = useMemo(() => schemaFor(SCHEMA_FILE), []);
  const [placeholder, setPlaceholder] = useState(true);
  const [draft, setDraft] = useState<Obj>(() =>
    withPlaceholder({ ...(blankFor(root) as Obj), schema_version: SCHEMA_VERSION }, true),
  );

  const record = useMemo(() => (prune(draft) ?? {}) as Obj, [draft]);
  const result = useMemo(() => validateRecordAs(JSON.stringify(record), RECORD_TYPE), [record]);
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

  function start(slug: string) {
    const chosen = TEMPLATES.find((template) => template.slug === slug);
    const base = chosen ? (structuredClone(chosen.record) as Obj) : ({ ...(blankFor(root) as Obj) } as Obj);
    setDraft(withPlaceholder({ schema_version: SCHEMA_VERSION, ...base }, placeholder));
  }

  function togglePlaceholder(on: boolean) {
    setPlaceholder(on);
    setDraft((current) => withPlaceholder(current, on));
  }

  // The one row that carries something beyond its value: the identifier is not
  // the author's to invent, so it says what it is and offers to step aside.
  function placeholderRow(path: string) {
    if (path !== "cell_spec.id") return null;
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

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <header className="border-b border-border pb-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label className="flex items-center gap-2 text-sm text-ink-faint">
            Start from
            <select
              defaultValue=""
              onChange={(e) => start(e.target.value)}
              className="rounded border border-border bg-surface px-2 py-1 text-sm text-ink focus:border-brand-500 focus:outline-none"
            >
              <option value="">empty form</option>
              {TEMPLATES.map((template) => (
                <option key={template.slug} value={template.slug}>
                  {template.slug} ({template.format})
                </option>
              ))}
            </select>
          </label>

          <span className="flex-1" />

          <p className={`text-sm ${blocked ? "text-warning" : "text-ink-faint"}`}>
            {blocked ? `${stuck} field${stuck === 1 ? "" : "s"} to fill` : "valid against the schema"}
          </p>
          <button
            type="button"
            disabled={blocked}
            onClick={() => download(record)}
            title={blocked ? "Fill the fields marked required first" : "Download the canonical JSON record"}
            className={`shrink-0 rounded border px-3 py-1 text-sm ${
              blocked
                ? "cursor-not-allowed border-border/40 text-ink-faint/40"
                : "border-border text-ink hover:border-brand-500"
            }`}
          >
            Download
          </button>
        </div>
      </header>

      <div className="mt-6 grid gap-10 lg:grid-cols-5">
        <section className="lg:col-span-3">
          <ObjectNode loc={root} value={draft} onChange={setDraft} issues={issues} after={placeholderRow} />
        </section>

        <section className="lg:col-span-2 lg:sticky lg:top-6 lg:self-start">
          <pre className="max-h-[75vh] overflow-auto rounded border border-border bg-surface p-3 text-xs leading-relaxed text-ink">
            {JSON.stringify(record, null, 2)}
          </pre>
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
    </main>
  );
}
