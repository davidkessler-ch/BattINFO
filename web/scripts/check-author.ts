// The authoring form derives itself from the schemas, which is only a guarantee
// while the derivation actually works. This runs the page's own modules -- not a
// copy of them -- over every record type the site knows and fails on anything
// the form would silently render as nothing, crash on, or quietly rewrite.
//
//   Run / CI:   npm run check:author
//
// Companion to check-agreement (the validator agrees with the corpus) and
// check-create-model-terms (the playground's terms are real).

import { blankFor, controlFor, fieldsOf, type Located } from "../app/author/schema";
import { asDraft, asTemplate, sanitize } from "../app/author/load";
import { SCHEMA_VERSION } from "../lib/create-model";
import {
  DERIVED_IDENTITY,
  RECORD_TYPES,
  notAuthored,
  slugOf,
  typeForSlug,
} from "../app/author/types";
import { TEMPLATES } from "../lib/templates.generated";
import { detectRecordType, validateRecordAs } from "../lib/validate";

type Obj = Record<string, unknown>;

const failures: string[] = [];
const fail = (message: string) => failures.push(message);

// Every field the form could ever draw for this type, following refs once per
// distinct target so a self-referential schema terminates.
function walk(loc: Located, path: string, seen: Set<string>, visit: (path: string, loc: Located) => void) {
  const key = `${loc.file}|${JSON.stringify(loc.schema).length}|${path.split(".").at(-1)}`;
  if (seen.has(key)) return;
  seen.add(key);
  visit(path, loc);
  const control = controlFor(loc);
  if (control.kind === "array") return walk(control.items, `${path}[]`, seen, visit);
  if (control.kind === "map") return walk(control.values, `${path}.*`, seen, visit);
  if (control.kind !== "object") return;
  for (const field of fieldsOf(loc)) walk(field.loc, path ? `${path}.${field.key}` : field.key, seen, visit);
}

// 1. Every record type resolves, and the URL it lives at round-trips.
for (const type of RECORD_TYPES) {
  if (typeForSlug(slugOf(type))?.key !== type.key) fail(`${type.key}: slug ${slugOf(type)} does not resolve back`);
  if (!type.root.schema) fail(`${type.key}: no schema behind ${type.root.file}`);
}

// 2. Every field the form can reach renders as some control. "unsupported" is
//    an honest dead end in the code and an invisible field on the page: a
//    record could carry a value nobody can see or edit.
for (const type of RECORD_TYPES) {
  walk(type.root, "", new Set(), (path, loc) => {
    if (controlFor(loc).kind === "unsupported") fail(`${type.key}: no control for ${path || "(root)"}`);
  });
}

// 3. And every container can actually hold something. Having *a* control is not
//    enough: an object whose field list comes back empty draws a section that
//    opens onto nothing, and on upload every key under it is dropped as
//    unknown. This is the shape that lost a test protocol's conditions and
//    setpoints, and the eight union-typed fields (cell_spec.brand among them)
//    where the control said "object" and the field list disagreed.
for (const type of RECORD_TYPES) {
  walk(type.root, "", new Set(), (path, loc) => {
    if (controlFor(loc).kind === "object" && fieldsOf(loc).length === 0) {
      fail(`${type.key}: ${path || "(root)"} is a section with no fields in it`);
    }
  });
}

// 4. A blank draft is buildable for every type. blankFor recurses through
//    required fields, so a required cycle would hang the page instead.
for (const type of RECORD_TYPES) {
  try {
    if (typeof blankFor(type.root) !== "object") fail(`${type.key}: blankFor did not build an object`);
  } catch (error) {
    fail(`${type.key}: blankFor threw — ${(error as Error).message}`);
  }
}

// 5. The form never offers an identifier. Since BIG-MAP/BattINFO#435 the
//    package rejects a placeholder and mints from the record's natural key, so
//    a row that let someone type one would be a row that produces a rejected
//    record. The schemas do define these fields, so only `notAuthored` keeps
//    them off the page -- this is what fails if that list is ever trimmed.
for (const type of RECORD_TYPES) {
  const hidden = notAuthored(type);
  for (const key of DERIVED_IDENTITY) {
    const body = fieldsOf(type.root).find((field) => field.key === type.key);
    const present = body?.loc && fieldsOf(body.loc).some((field) => field.key === key);
    if (present && !hidden.includes(`${type.key}.${key}`)) {
      fail(`${type.key}: ${key} is a schema field the form would let someone author`);
    }
  }
  if (!hidden.includes("schema_version")) fail(`${type.key}: schema_version is not stamped`);
}

// 6. Every template is a record the form can actually open: it validates, it
//    belongs to a type the form offers, and loading it drops nothing.
for (const template of TEMPLATES) {
  const record = template.record as Obj;
  const key = detectRecordType(record);
  const type = RECORD_TYPES.find((candidate) => candidate.key === key);
  if (!type) {
    fail(`template ${template.slug}: no record type the form offers`);
    continue;
  }
  const result = validateRecordAs(JSON.stringify(record), type.key);
  if (!result.ok) fail(`template ${template.slug}: invalid — ${result.issues[0]?.message}`);

  const removed: string[] = [];
  const loaded = sanitize(record, type.root, "", removed);
  if (removed.length) fail(`template ${template.slug}: loading it would drop ${removed.join(", ")}`);
  const reloaded = validateRecordAs(JSON.stringify(loaded), type.key);
  if (!reloaded.ok) fail(`template ${template.slug}: invalid once loaded — ${reloaded.issues[0]?.message}`);

  // 7. And picking it hands over a starting point, not a published record:
  //    of the provenance, only the kind of source survives.
  const started = asTemplate(structuredClone(record), type) as Obj;
  const kept = Object.keys((started.provenance ?? {}) as Obj).filter((key) => key !== "source_type");
  if (kept.length) fail(`template ${template.slug}: keeps the source record's provenance (${kept.join(", ")})`);
}

// 8. Whatever way a draft enters, it leaves the library's own fields alone: no
//    identifier (the package mints it and rejects anything we put there) and
//    the current schema_version (not whatever an older file carried).
for (const type of RECORD_TYPES) {
  const carried: Obj = {
    schema_version: "0.0.1",
    [type.key]: { id: "https://w3id.org/battinfo/spec/aaaa-bbbb-cccc-dddd", short_id: "aaaabb", identifier: "x:y" },
  };
  const draft = asDraft(carried, type) as Obj;
  const body = (draft[type.key] ?? {}) as Obj;
  for (const key of DERIVED_IDENTITY) {
    if (key in body) fail(`${type.key}: asDraft kept ${key}`);
  }
  if (draft.schema_version !== SCHEMA_VERSION) {
    fail(`${type.key}: asDraft left schema_version at ${String(draft.schema_version)}`);
  }
}

// 9. A field that is "one X or a list of X" (an electrolyte's solvent) keeps a
//    list, and keeps a lone X as a one-item list. Reading only the single
//    branch dropped every list on load.
{
  const cellSpec = RECORD_TYPES.find((type) => type.key === "cell_spec")!;
  const solvents = (solvent: unknown) => {
    const removed: string[] = [];
    const out = sanitize({ electrolyte: { family: "organic", solvent } }, cellSpec.root, "", removed) as Obj;
    return { removed, kept: ((out.electrolyte ?? {}) as Obj).solvent };
  };
  const list = solvents([{ name: "EC" }, { name: "EMC" }]);
  if (list.removed.length) fail(`a solvent list loses ${list.removed.join(", ")} on load`);
  const single = solvents({ name: "EC" });
  if (JSON.stringify(single.kept) !== JSON.stringify([{ name: "EC" }])) {
    fail(`a single solvent loads as ${JSON.stringify(single.kept)}, not a one-item list`);
  }
}

// 10. A manufacturer is "a name, or an organization holding that name": the
//     form edits the organization, so its IRIs survive and a plain name loads
//     as that organization.
{
  const cellSpec = RECORD_TYPES.find((type) => type.key === "cell_spec")!;
  const maker = (manufacturer: unknown) => {
    const out = sanitize({ separator: { material: "PP", manufacturer } }, cellSpec.root, "", []) as Obj;
    return ((out.separator ?? {}) as Obj).manufacturer;
  };
  const org = { name: "Celgard", same_as: "http://www.wikidata.org/entity/Q122199856" };
  if (JSON.stringify(maker(org)) !== JSON.stringify(org)) fail(`an organization manufacturer loads as ${JSON.stringify(maker(org))}`);
  if (JSON.stringify(maker("Celgard")) !== JSON.stringify({ name: "Celgard" })) {
    fail(`a manufacturer name loads as ${JSON.stringify(maker("Celgard"))}, not an organization`);
  }
}

if (failures.length) {
  console.error(`check:author — ${failures.length} problem(s):`);
  for (const message of failures) console.error(`  • ${message}`);
  process.exit(1);
}
console.log(
  `check:author — ${RECORD_TYPES.length} record types render, ${TEMPLATES.length} templates open clean.`,
);
