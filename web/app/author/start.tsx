"use client";

// How a record begins: empty, from a BattINFO JSON you already have, or from
// one of the curated templates. The three live here and only here -- "where does
// this draft come from" is a different question from "author and export it", and
// the toolbar only has to offer a way back to this screen.
//
// "Template" means one of the curated starting points. A file you upload is a
// BattINFO JSON, which may serve as a starting point but is not a separate kind
// of thing.
//
// All three are reached the same way: a card you click. A screen where one
// option is a card, one a disclosure and one a card holding a button makes the
// reader work out the rules three times.

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RECORD_TYPES, slugOf, type RecordType } from "./types";
import { asTemplate, read, type Loaded } from "./load";
import { TEMPLATES } from "@/lib/templates.generated";
import { detectRecordType } from "@/lib/validate";

type Obj = Record<string, unknown>;

// One card shape for the start screen.
const CARD =
  "block w-full rounded border border-border px-4 py-3 text-left transition-colors hover:border-brand-500";
const CARD_TITLE = "text-sm font-medium text-ink";
const CARD_NOTE = "mt-1 block text-xs leading-relaxed text-ink-faint";

// Just the input. Separated from what opens it so a card and a button can both
// be the thing you click.
function FilePicker({
  pick,
  type,
  onLoad,
  onError,
}: {
  pick: React.RefObject<HTMLInputElement>;
  type: RecordType;
  onLoad: (loaded: Loaded) => void;
  onError: (message: string) => void;
}) {
  return (
    <input
      ref={pick}
      type="file"
      accept="application/json,.json"
      className="hidden"
      onChange={async (event) => {
        const file = event.target.files?.[0];
        event.target.value = ""; // so the same file can be picked twice
        if (!file) return;
        try {
          onLoad(await read(file, type));
        } catch (error) {
          onError(error instanceof Error ? error.message : String(error));
        }
      }}
    />
  );
}

function UploadCard({
  type,
  onLoad,
  onError,
}: {
  type: RecordType;
  onLoad: (loaded: Loaded) => void;
  onError: (message: string) => void;
}) {
  const pick = useRef<HTMLInputElement>(null!);
  return (
    <>
      <button type="button" onClick={() => pick.current?.click()} className={CARD}>
        <span className={CARD_TITLE}>Upload a BattINFO JSON</span>
        <span className={CARD_NOTE}>
          A record saved earlier, to carry on with or to start another from. Anything the schemas do not define
          is dropped.
        </span>
      </button>
      <FilePicker pick={pick} type={type} onLoad={onLoad} onError={onError} />
    </>
  );
}

// The first screen. Three ways in, stated plainly, because an empty form gives
// no clue that the other two exist.
export function StartScreen({
  type,
  onEmpty,
  onPick,
  onLoad,
  onResume,
}: {
  type: RecordType;
  onEmpty: () => void;
  onPick: (record: Obj) => void;
  onLoad: (loaded: Loaded) => void;
  onResume?: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  // Only the cell spec has curated starting points today. Which type a template
  // belongs to is read from the record itself, so a second source needs no
  // change here.
  const templates = TEMPLATES.filter((template) => detectRecordType(template.record as Obj) === type.key);

  return (
    <section className="mx-auto max-w-xl py-20">
      <h1 className="text-xl font-semibold text-ink">New {type.label.toLowerCase()}</h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-faint">
        Every field comes from the BattINFO schemas, so only what they allow can be added.
      </p>

      <label className="mt-6 flex items-center gap-2 text-sm text-ink-faint">
        Describing
        <select
          value={slugOf(type)}
          onChange={(e) => router.push(`/author/${e.target.value}`)}
          className="rounded border border-border bg-surface px-2 py-1 text-sm text-ink focus:border-brand-500 focus:outline-none"
        >
          {RECORD_TYPES.map((option) => (
            <option key={option.key} value={slugOf(option)}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      {/* Leaving the form must not strand the draft behind this screen. */}
      {onResume ? (
        <button type="button" onClick={onResume} className={`${CARD} mt-8 border-brand-500/50`}>
          <span className="text-sm font-medium text-brandtext">Back to your draft</span>
          <span className={CARD_NOTE}>Nothing has been discarded.</span>
        </button>
      ) : null}

      <div className="mt-8 space-y-2">
        <button type="button" onClick={onEmpty} className={CARD}>
          <span className={CARD_TITLE}>Start empty</span>
          <span className={CARD_NOTE}>A blank record with only the required fields.</span>
        </button>

        {templates.length ? (
          <details className="rounded border border-border transition-colors hover:border-brand-500">
            <summary className="cursor-pointer list-none px-4 py-3 marker:hidden">
              <span className={CARD_TITLE}>Start from a template</span>
              <span className={CARD_NOTE}>
                One of {templates.length} curated records, roughly one per cell format. Its identifier and
                provenance are left behind.
              </span>
            </summary>
            <div className="max-h-64 overflow-y-auto border-t border-border">
              {templates.map((template) => (
                <button
                  key={template.slug}
                  type="button"
                  onClick={() => onPick(asTemplate(structuredClone(template.record) as Obj, type))}
                  className="flex w-full items-baseline justify-between gap-4 border-b border-border/50 px-4 py-2 text-left last:border-0 hover:bg-brand-500/10"
                >
                  <span className="text-sm text-ink">{template.slug}</span>
                  <span className="shrink-0 text-xs text-ink-faint">{template.format}</span>
                </button>
              ))}
            </div>
          </details>
        ) : null}

        <UploadCard type={type} onLoad={onLoad} onError={setError} />
      </div>

      {error ? <p className="mt-3 text-sm text-error">{error}</p> : null}
    </section>
  );
}
