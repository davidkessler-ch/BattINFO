// What the form needs to know about one record type. Nothing here is a list:
// the types come from lib/validate's DISCRIMINATORS (itself pinned to
// battinfo.entities.ENTITY_KINDS by a Python test) and everything else from
// the schemas.

import { DISCRIMINATORS } from "@/lib/validate";
import { labelFor, schemaFor, type Located } from "./schema";

export interface RecordType {
  /** The discriminator key and the schema's own body key. */
  key: string;
  label: string;
  root: Located;
  /** Where an unfinished draft waits out a reload, per type so two never collide. */
  storageKey: string;
}

function build(key: string, file: string): RecordType {
  return {
    key,
    label: labelFor(key),
    root: schemaFor(file),
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

// Three kinds of field the author does not own, and what the form does with
// each. None of them is a schema `const`, which is why the tree cannot work
// any of this out for itself.
//
// STAMPED is set by the form: every schema describes schema_version as
// "stamped by the library on save", and all 123 example records carry the same
// value.
//
// DERIVED_IDENTITY is left out. docs/identifiers.md: "Records carry `id`,
// `short_id`, and `identifier` -- all derived, never hand-authored. Draft
// inputs omit them; saving canonizes them." Since BIG-MAP/BattINFO#435 the
// package rejects a placeholder outright and mints from the record's natural
// key, so the form offers no identifier at all rather than inventing one.
//
// The third kind -- a schema that constrains nothing about its values -- is
// carried through untouched, and the tree works that one out on its own
// (`controlFor` returns "opaque").
export const STAMPED = ["schema_version"];
export const DERIVED_IDENTITY = ["id", "short_id", "identifier"];

/** Dotted paths the form fills in or leaves out, so the tree shows neither. */
export function notAuthored(type: RecordType): string[] {
  return [...STAMPED, ...DERIVED_IDENTITY.map((key) => `${type.key}.${key}`)];
}
