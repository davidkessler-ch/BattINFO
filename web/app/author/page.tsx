"use client";

// Build a cell spec from the schema itself. Every field, label, option and
// nesting level below comes from cell-spec.schema.json at runtime -- this page
// lists none of them, so it cannot drift from the package.

import { useMemo, useState } from "react";
import { blankFor, schemaFor } from "./schema";
import { ObjectNode } from "./node";
import { SCHEMA_VERSION } from "@/lib/create-model";
import { validateRecordAs } from "@/lib/validate";
import { MATERIALS, MATERIAL_LIST, UNITS, UNIT_LIST } from "./vocab";

const RECORD_TYPE = "cell_spec";
const SCHEMA_FILE = "cell-spec.schema.json";

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

function download(record: unknown) {
  const blob = new Blob([JSON.stringify(record, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "cell-spec.json";
  link.click();
  URL.revokeObjectURL(url);
}

export default function BuildPage() {
  const root = useMemo(() => schemaFor(SCHEMA_FILE), []);
  const [draft, setDraft] = useState<Obj>(() => ({
    ...(blankFor(root) as Obj),
    schema_version: SCHEMA_VERSION,
  }));

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

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <div className="flex items-baseline gap-3 border-b border-border pb-3">
        <h1 className="text-base font-semibold text-ink">Cell spec</h1>
        <p className="truncate text-xs text-ink-faint">
          fields from <code>{SCHEMA_FILE}</code> · nothing leaves your browser
        </p>
      </div>

      <div className="mt-6 grid gap-10 lg:grid-cols-5">
        <section className="lg:col-span-3">
          <ObjectNode loc={root} value={draft} onChange={setDraft} issues={issues} />
        </section>

        <section className="lg:col-span-2 lg:sticky lg:top-6 lg:self-start">
          <div className="mb-2 flex items-center justify-between gap-4">
            <p className={`text-sm ${blocked ? "text-warning" : "text-ink-faint"}`}>
              {blocked
                ? `${stuck} field${stuck === 1 ? "" : "s"} to fill — download blocked`
                : "Valid against the schema — ready to download"}
            </p>
            <button
              type="button"
              disabled={blocked}
              onClick={() => download(record)}
              title={
                blocked
                  ? "Fill the fields marked required in the form before downloading"
                  : "Download the canonical JSON record"
              }
              className={`shrink-0 rounded border px-3 py-1 text-sm ${
                blocked
                  ? "cursor-not-allowed border-border/40 text-ink-faint/40"
                  : "border-border text-ink hover:border-brand-500"
              }`}
            >
              Download
            </button>
          </div>
          <pre className="max-h-[70vh] overflow-auto rounded border border-border bg-surface p-3 text-xs leading-relaxed text-ink">
            {JSON.stringify(record, null, 2)}
          </pre>
        </section>
      </div>

      <datalist id={UNIT_LIST}>
        {UNITS.map((unit) => (
          <option key={unit} value={unit} />
        ))}
      </datalist>
      <datalist id={MATERIAL_LIST}>
        {MATERIALS.map((material) => (
          <option key={material} value={material} />
        ))}
      </datalist>
    </main>
  );
}
