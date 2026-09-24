// What the form needs to know about one record type. Everything here is
// derived -- from lib/validate's DISCRIMINATORS (itself pinned to
// battinfo.entities.ENTITY_KINDS by a Python test) and from the schemas
// themselves. The only hand-written fact is which types the JSON-LD transform
// refuses, and that is pinned by a test too.

import { DISCRIMINATORS } from "@/lib/validate";
import { deref, fieldsOf, labelFor, schemaFor, type Located } from "./schema";

// The uid the library has not minted yet. The package spells two of these out
// (battinfo.api._shared.TEMPLATE_CELL_SPEC_ID / TEMPLATE_CELL_ID) and leaves
// the other twenty unnamed, so rather than copy a table that only half exists,
// the sentinel is read back out of each schema's own `id` pattern.
const BLANK_UID = "0000-0000-0000-0000";

// Try every literal word in the pattern as the path segment and keep the one
// the pattern itself accepts. A guess that is wrong simply fails the test, so
// this cannot invent an identifier the schema would reject.
function placeholderFrom(pattern: unknown): string | null {
  if (typeof pattern !== "string") return null;
  const accepts = new RegExp(pattern);
  for (const segment of pattern.match(/[a-z][a-z-]*/g) ?? []) {
    const candidate = `https://w3id.org/battinfo/${segment}/${BLANK_UID}`;
    if (accepts.test(candidate)) return candidate;
  }
  return null;
}

// battinfo.jsonld._TRANSFORMERS has no entry for these four, so
// record_to_jsonld raises rather than answering. The button says so instead of
// offering a request that cannot succeed.
// KEEP IN SYNC with battinfo.jsonld._TRANSFORMERS; a Python test fails when
// they diverge.
const NO_JSONLD = new Set(["equipment_spec", "equipment", "channel", "organization"]);

export interface RecordType {
  /** The discriminator key, the schema's own body key, and the name
   *  record_to_jsonld answers to -- `_TRANSFORMERS` registers both spellings. */
  key: string;
  label: string;
  root: Located;
  /** The sentinel id a draft carries until the library mints a real one. */
  placeholderId: string | null;
  /** Whether the JSON-LD transform knows this type. */
  convertible: boolean;
  /** Where an unfinished draft waits out a reload, per type so two never collide. */
  storageKey: string;
}

function build(key: string, file: string): RecordType {
  const root = schemaFor(file);
  const body = fieldsOf(root).find((field) => field.key === key);
  const id = body ? fieldsOf(body.loc).find((field) => field.key === "id") : undefined;
  return {
    key,
    label: labelFor(key),
    root,
    placeholderId: placeholderFrom(id ? deref(id.loc).schema?.pattern : undefined),
    convertible: !NO_JSONLD.has(key),
    storageKey: `battinfo.author.${key}`,
  };
}

export const RECORD_TYPES: RecordType[] = Object.entries(DISCRIMINATORS).map(([key, file]) =>
  build(key, file),
);

// "cell_spec" <-> "cell-spec". The URL wants the dashed form; everything else
// in the record, the schemas and the transform wants the underscored one.
export function slugOf(type: RecordType): string {
  return type.key.replace(/_/g, "-");
}

export function typeForSlug(slug: string): RecordType | undefined {
  return RECORD_TYPES.find((type) => slugOf(type) === slug);
}

// Stamped by the library on save, identical in all 123 example records, and
// described by every schema as "stamped by the library on save" -- so the form
// sets it and does not ask. Not a schema `const`, which is why the tree cannot
// work this out for itself.
export const STAMPED = ["schema_version"];
