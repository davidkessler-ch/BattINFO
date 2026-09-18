"use client";

// How a record begins: empty, from a BattINFO JSON you already have, or from
// one of the curated templates. The three live here and only here -- "where does
// this draft come from" is a different question from "author and export it", and
// the toolbar only has to offer a way back to this screen.
//
// "Template" means one of the curated starting points. A file you upload is a
// BattINFO JSON, which may serve as a starting point but is not a separate kind
// of thing.

import { useRef, useState } from "react";
import { controlFor, fieldsOf, type Located } from "./schema";
import { TEMPLATES } from "@/lib/templates.generated";

type Obj = Record<string, unknown>;

const BUTTON =
  "rounded border border-border px-3 py-1 text-sm text-ink hover:border-brand-500";

function join(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}

// An uploaded file is someone else's JSON. Anything the schema does not know is
// dropped rather than carried into a record that would then fail validation for
// a reason the form cannot show -- the tree only draws fields the schema names,
// so an unknown key would be invisible and still in the output.
export function sanitize(value: unknown, loc: Located, path = "", removed: string[] = []): unknown {
  const control = controlFor(loc);
  if (value === null || typeof value !== "object") return value;

  if (control.kind === "array") {
    const items = Array.isArray(value) ? value : [];
    return items.map((item, index) => sanitize(item, control.items, `${path}.${index}`, removed));
  }

  if (control.kind === "map") {
    const allowed = new RegExp(control.keyPattern ?? ".");
    const out: Obj = {};
    for (const [key, item] of Object.entries(value as Obj)) {
      if (!allowed.test(key)) removed.push(join(path, key));
      else out[key] = sanitize(item, control.values, join(path, key), removed);
    }
    return out;
  }

  if (control.kind !== "object") return value;

  const known = new Map(fieldsOf(loc).map((field) => [field.key, field.loc]));
  const out: Obj = {};
  for (const [key, item] of Object.entries(value as Obj)) {
    const child = known.get(key);
    if (!child) removed.push(join(path, key));
    else out[key] = sanitize(item, child, join(path, key), removed);
  }
  return out;
}

export interface Loaded {
  record: Obj;
  removed: string[];
}

async function read(file: File, root: Located): Promise<Loaded> {
  const parsed = JSON.parse(await file.text());
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("A BattINFO JSON must be a JSON object.");
  }
  const removed: string[] = [];
  return { record: sanitize(parsed, root, "", removed) as Obj, removed };
}

export function UploadButton({
  root,
  onLoad,
  onError,
  label = "Upload BattINFO JSON",
}: {
  root: Located;
  onLoad: (loaded: Loaded) => void;
  onError: (message: string) => void;
  label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className={BUTTON} onClick={() => input.current?.click()}>
        {label}
      </button>
      <input
        ref={input}
        type="file"
        accept="application/json,.json,.jsonld"
        className="hidden"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = ""; // so the same file can be picked twice
          if (!file) return;
          try {
            onLoad(await read(file, root));
          } catch (error) {
            onError(error instanceof Error ? error.message : String(error));
          }
        }}
      />
    </>
  );
}

// The first screen. Three ways in, stated plainly, because an empty form gives
// no clue that the other two exist.
export function StartScreen({
  root,
  onEmpty,
  onPick,
  onLoad,
  onResume,
}: {
  root: Located;
  onEmpty: () => void;
  onPick: (record: Obj) => void;
  onLoad: (loaded: Loaded) => void;
  onResume?: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="mx-auto max-w-lg py-16">
      <h1 className="text-base font-semibold text-ink">New cell spec</h1>
      <p className="mt-1 text-sm text-ink-faint">
        Every field comes from the BattINFO schemas, so only what they allow can be added.
      </p>

      {/* Leaving the form must not strand the draft behind this screen. */}
      {onResume ? (
        <button
          type="button"
          onClick={onResume}
          className="mt-6 block w-full rounded border border-brand-500/50 px-4 py-3 text-left hover:border-brand-500"
        >
          <span className="text-sm text-brandtext">Back to your draft</span>
          <span className="mt-0.5 block text-xs text-ink-faint">Nothing has been discarded.</span>
        </button>
      ) : null}

      <div className="mt-6 space-y-2">
        <button
          type="button"
          onClick={onEmpty}
          className="block w-full rounded border border-border px-4 py-3 text-left hover:border-brand-500"
        >
          <span className="text-sm text-ink">Start empty</span>
          <span className="mt-0.5 block text-xs text-ink-faint">A blank record with only the required fields.</span>
        </button>

        <details className="rounded border border-border">
          <summary className="cursor-pointer list-none px-4 py-3 marker:hidden hover:text-brandtext">
            <span className="text-sm text-ink">Start from a template</span>
            <span className="mt-0.5 block text-xs text-ink-faint">
              One of {TEMPLATES.length} curated records, roughly one per cell format.
            </span>
          </summary>
          <div className="max-h-64 overflow-y-auto border-t border-border">
            {TEMPLATES.map((template) => (
              <button
                key={template.slug}
                type="button"
                onClick={() => onPick(structuredClone(template.record) as Obj)}
                className="block w-full border-b border-border/50 px-4 py-2 text-left last:border-0 hover:bg-brand-500/10"
              >
                <span className="text-sm text-ink">{template.slug}</span>
                <span className="ml-2 text-xs text-ink-faint">{template.format}</span>
              </button>
            ))}
          </div>
        </details>

        <div className="rounded border border-border px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <span className="text-sm text-ink">Upload a BattINFO JSON</span>
              <span className="mt-0.5 block text-xs text-ink-faint">
                A record saved earlier, to carry on with or to start another from. Anything the schemas do not
                define is dropped.
              </span>
            </div>
            <UploadButton root={root} onLoad={onLoad} onError={setError} label="Choose file" />
          </div>
        </div>
      </div>

      {error ? <p className="mt-3 text-sm text-error">{error}</p> : null}
    </section>
  );
}
