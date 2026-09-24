// Turning somebody else's JSON into a draft. Pure: no React, no state, so the
// CI guard can run exactly the code the page runs rather than a copy of it.

import { controlFor, fieldsOf, join, type Located } from "./schema";
import type { RecordType } from "./types";

type Obj = Record<string, unknown>;

export interface Loaded {
  record: Obj;
  removed: string[];
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
    return items.map((item, index) => sanitize(item, control.items, join(path, index), removed));
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

// A template is a starting point, never an identity. The curated records carry
// a minted IRI and a provenance block naming the source file, DOI and retrieval
// time they were built from; kept, they would make a new record claim a
// published one's identifier and a history it never had. Dropping both is what
// turns a record into a template -- scripts/sync-templates.mjs points here.
export function asTemplate(record: Obj, type: RecordType): Obj {
  const { provenance: _history, ...rest } = record;
  const { id: _minted, ...body } = (record[type.key] ?? {}) as Obj;
  return { ...rest, [type.key]: body };
}

export async function read(file: File, type: RecordType): Promise<Loaded> {
  const parsed = JSON.parse(await file.text());
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("A BattINFO JSON must be a JSON object.");
  }
  // The published form, not the authored one. Sanitising it would strip
  // @context and @graph as unknown keys and hand back an empty record, so say
  // what it is instead -- the same distinction /validate draws.
  if ("@context" in parsed || "@graph" in parsed) {
    throw new Error(
      "This is a JSON-LD document — the published form, generated from a canonical record. " +
        "Upload the canonical record it was generated from.",
    );
  }
  const removed: string[] = [];
  return { record: sanitize(parsed, type.root, "", removed) as Obj, removed };
}
