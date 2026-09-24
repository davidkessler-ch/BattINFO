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
import { asTemplate, sanitize } from "../app/author/load";
import { RECORD_TYPES, slugOf, typeForSlug, type RecordType } from "../app/author/types";
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

// 3. A blank draft is buildable for every type. blankFor recurses through
//    required fields, so a required cycle would hang the page instead.
for (const type of RECORD_TYPES) {
  try {
    if (typeof blankFor(type.root) !== "object") fail(`${type.key}: blankFor did not build an object`);
  } catch (error) {
    fail(`${type.key}: blankFor threw — ${(error as Error).message}`);
  }
}

// 4. The placeholder id is the schema's to accept, not ours to invent.
for (const type of RECORD_TYPES) {
  const body = fieldsOf(type.root).find((field) => field.key === type.key);
  const id = body ? fieldsOf(body.loc).find((field) => field.key === "id") : undefined;
  const pattern = id?.loc.schema?.pattern;
  if (typeof pattern !== "string") continue; // no id, or no pattern to satisfy
  if (!type.placeholderId) fail(`${type.key}: id is patterned but no placeholder was derived`);
  else if (!new RegExp(pattern).test(type.placeholderId)) {
    fail(`${type.key}: placeholder ${type.placeholderId} does not satisfy the id pattern`);
  }
}

// 5. Every template is a record the form can actually open: it validates, it
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
  sanitize(record, type.root, "", removed);
  if (removed.length) fail(`template ${template.slug}: loading it would drop ${removed.join(", ")}`);

  // 6. And picking it hands over a starting point, not a published identity.
  const started = asTemplate(structuredClone(record), type) as Obj;
  const body = (started[type.key] ?? {}) as Obj;
  if ("id" in body) fail(`template ${template.slug}: keeps the minted id`);
  if ("provenance" in started) fail(`template ${template.slug}: keeps the source record's provenance`);
}

if (failures.length) {
  console.error(`check:author — ${failures.length} problem(s):`);
  for (const message of failures) console.error(`  • ${message}`);
  process.exit(1);
}
console.log(
  `check:author — ${RECORD_TYPES.length} record types render, ${TEMPLATES.length} templates open clean.`,
);
