/**
 * Reading a stored run state across formats. A reader takes its own format and the one before it,
 * which it upgrades by a written rule; any other format, or a document failing the schema after the
 * upgrade, is refused with the reason, so the unit reads as corrupt and nothing guesses at the fields.
 */
import type { SchemaError } from "@norn/schema";
import { RUN_STATE_FORMAT, type RunState } from "../model/run-state.ts";
import { validateRunState } from "../model/validate.ts";

/** Turns a document of the format it is keyed by into one of the next format; it may return anything, which is validated after. */
export type RunStateUpgrade = (doc: Readonly<Record<string, unknown>>) => unknown;

/** The rules from format N-1 to N, keyed by N-1. Format 1 is the first, so there is none yet. */
export const RUN_STATE_UPGRADES: Readonly<Record<number, RunStateUpgrade>> = {};

export type RunStateRead = { ok: true; state: RunState; upgradedFrom?: number } | { ok: false; reason: string };

export const schemaReason = (errors: readonly SchemaError[]): string =>
  errors.map((e) => `${e.path === "" ? "/" : e.path} ${e.message}`).join("; ");

export function readRunState(data: unknown, upgrades: Readonly<Record<number, RunStateUpgrade>> = RUN_STATE_UPGRADES): RunStateRead {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return { ok: false, reason: "the run state is not an object" };
  const doc = data as Record<string, unknown>;
  const format = doc.format;
  if (typeof format !== "number" || !Number.isInteger(format)) return { ok: false, reason: "the run state has no format" };
  let current: unknown = doc;
  let upgradedFrom: number | undefined;
  if (format !== RUN_STATE_FORMAT) {
    const rule = format === RUN_STATE_FORMAT - 1 ? upgrades[format] : undefined;
    if (!rule) return { ok: false, reason: `run state format ${format} is not readable: this build reads ${RUN_STATE_FORMAT} and ${RUN_STATE_FORMAT - 1}` };
    current = rule(doc);
    upgradedFrom = format;
  }
  const checked = validateRunState(current);
  if (!checked.ok) return { ok: false, reason: `${upgradedFrom !== undefined ? `upgraded from format ${upgradedFrom}: ` : ""}${schemaReason(checked.errors)}` };
  return upgradedFrom !== undefined ? { ok: true, state: checked.value, upgradedFrom } : { ok: true, state: checked.value };
}
