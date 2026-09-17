// JSON Schema -> what a form needs to know. Pure: no React, no state.
//
// The schemas are the single source of truth. Nothing in this file lists a
// field, a unit or a vocabulary term; everything is read from the schema at
// runtime. That is the whole point: add a field upstream and the form grows it.

import { schemaFiles } from "@/lib/schemas.generated";

export type Schema = Record<string, any>;

// A schema plus the file it came from. The file matters because $refs are
// relative to it, so a bare schema object is not enough to follow one.
export interface Located {
  schema: Schema;
  file: string;
}

const BY_PATH = new Map(schemaFiles.map((f) => [f.path, f.schema]));

export function schemaFor(file: string): Located {
  const schema = BY_PATH.get(file);
  if (!schema) throw new Error(`no such schema file: ${file}`);
  return { schema, file };
}

// "modules/components/a.json" + "../common/b.json" -> "modules/common/b.json"
function relativeTo(file: string, ref: string): string {
  const out: string[] = file.split("/").slice(0, -1);
  for (const part of ref.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

function pointerInto(schema: Schema, pointer: string): Schema {
  let here = schema;
  for (const raw of pointer.split("/")) {
    if (raw === "") continue;
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    here = here?.[key];
    if (here === undefined) throw new Error(`no such pointer: ${pointer}`);
  }
  return here;
}

// Follow $ref until we reach a real schema. Refs come in three shapes:
// "#/$defs/X" (same file), "other.json" (whole file), "other.json#/$defs/X".
export function deref(loc: Located): Located {
  let { schema, file } = loc;
  for (let hops = 0; schema?.$ref && hops < 16; hops++) {
    const [target, pointer] = String(schema.$ref).split("#");
    if (target) file = relativeTo(file, target);
    const root = BY_PATH.get(file);
    if (!root) throw new Error(`no such schema file: ${file}`);
    schema = pointer ? pointerInto(root, pointer) : root;
  }
  return { schema, file };
}

// What kind of input a value needs. "const" is a value the schema fixes, so the
// form sets it rather than asking. "unsupported" is an honest dead end: we
// render nothing rather than guess wrong.
export type Control =
  | { kind: "text" }
  | { kind: "number"; integer: boolean }
  | { kind: "boolean" }
  | { kind: "select"; options: string[] }
  | { kind: "const"; value: unknown }
  | { kind: "object" }
  | { kind: "array"; items: Located }
  | { kind: "unsupported" };

export function controlFor(loc: Located): Control {
  const { schema, file } = deref(loc);
  if (!schema) return { kind: "unsupported" };
  if (schema.const !== undefined) return { kind: "const", value: schema.const };
  if (Array.isArray(schema.enum)) return { kind: "select", options: schema.enum.map(String) };

  // A union is only a union when the schema has no shape of its own. Several
  // schemas carry `type`, `properties` AND an `anyOf` -- there the anyOf states
  // a cross-field constraint (ajv's job), not a choice of shape, so reading it
  // as one would throw the object away.
  if (schema.type === undefined && !schema.properties) {
    const union = schema.anyOf ?? schema.oneOf;
    if (Array.isArray(union)) {
      // Branches are often bare $refs, so deref before judging them. Taking the
      // first real branch covers [X, null] and [string, string[]]; where the
      // choice is genuine (Brand or Organization) it picks the first, which is
      // valid -- offering the choice is a later refinement.
      const branch = union
        .map((b: Schema) => deref({ schema: b, file }))
        .find((b) => b.schema?.type !== "null" && b.schema !== undefined);
      return branch ? controlFor(branch) : { kind: "unsupported" };
    }
  }

  switch (schema.type) {
    case "string":
      return { kind: "text" };
    case "number":
      return { kind: "number", integer: false };
    case "integer":
      return { kind: "number", integer: true };
    case "boolean":
      return { kind: "boolean" };
    case "object":
      return { kind: "object" };
    case "array":
      return { kind: "array", items: deref({ schema: schema.items ?? {}, file }) };
    default:
      return schema.properties ? { kind: "object" } : { kind: "unsupported" };
  }
}

export interface Field {
  key: string;
  label: string;
  help?: string;
  required: boolean;
  loc: Located;
}

// The value a freshly added field starts as. Required children are filled in
// too, so adding an object never leaves a hole the user cannot see -- and a
// value the schema fixes (`const`) is set rather than asked for. Recursion is
// bounded: it follows required fields only, and cell-spec is five deep.
export function blankFor(loc: Located): unknown {
  const control = controlFor(loc);
  switch (control.kind) {
    case "const":
      return control.value;
    case "boolean":
      return false;
    case "array":
      return [];
    case "object": {
      const out: Record<string, unknown> = {};
      for (const field of fieldsOf(loc)) {
        const child = controlFor(field.loc);
        if (child.kind === "const") out[field.key] = child.value;
        else if (field.required) out[field.key] = blankFor(field.loc);
      }
      return out;
    }
    default:
      return "";
  }
}

// "positive_electrode_basis" -> "Positive electrode basis". The schemas carry
// no `title`, so the key is the only label we have. If titles land upstream,
// this falls back to them instead.
export function labelFor(key: string, schema?: Schema): string {
  if (schema?.title) return schema.title;
  const words = key.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// Every property an object node may hold, in schema order, required first
// flagged. The description is read before dereferencing: a $ref carries its
// own meaning at the point of use ("Canonical IRI of this cell spec") which is
// more specific than the shared definition it points at.
export function fieldsOf(loc: Located): Field[] {
  const { schema, file } = deref(loc);
  const required = new Set<string>(schema?.required ?? []);
  return Object.entries(schema?.properties ?? {}).map(([key, raw]) => {
    const sub = raw as Schema;
    const target = deref({ schema: sub, file });
    return {
      key,
      label: labelFor(key, sub.title ? sub : target.schema),
      help: sub.description ?? target.schema?.description,
      required: required.has(key),
      loc: target,
    };
  });
}
