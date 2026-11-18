/**
 * What the person verbs share: the units a story key (or one unit id) names, read through the
 * journal, and the receipt ids they write. A person verb only records a receipt the kernel models;
 * the next tick applies it, so routing stays in the kernel.
 */
import type { UnitJournal } from "@norn/kernel";
import { STORE_ID_PATTERN } from "@norn/plugin-api";
import type { RuntimeEnv } from "@norn/runtime";
import { corruptError, failure, refuse } from "../output.ts";

/** `gh-12` names the story and its slices; `gh-12/03` names that one unit. */
export async function unitsOf(env: RuntimeEnv, key: string): Promise<UnitJournal[]> {
  const story = key.split("/")[0] as string;
  const listed = await env.slots.store.listUnits({ story });
  if (!listed.ok) throw failure(`cannot list the units of ${story}: ${listed.failure.message}`, "try again", listed.failure.code);
  const ids = key.includes("/") ? listed.value.filter((u) => u === key) : listed.value;
  if (ids.length === 0) throw refuse(`${key} has no run state on this machine`, "norn story list", "unknown_story");
  const out: UnitJournal[] = [];
  for (const id of ids) {
    const read = await env.journal.readUnit(id);
    if (!read.ok) throw failure(`cannot read ${id}: ${read.failure.message}`, "try again", read.failure.code);
    out.push(read.value);
  }
  return out;
}

/** The units a key names whose record is readable; a corrupt one the verb needed is never guessed past. */
export function readable(units: readonly UnitJournal[], key: string): UnitJournal[] {
  const ok = units.filter((u) => u.corrupt === undefined);
  const bad = units.find((u) => u.corrupt !== undefined);
  if (ok.length === 0 && bad) throw corruptError(`${bad.unit} is corrupt: ${bad.corrupt}`, `a person repairs the record of ${bad.unit}`, { unit: bad.unit });
  if (ok.length === 0) throw refuse(`${key} has no readable unit`, "norn story list", "unknown_story");
  return ok;
}

const STORE_ID = new RegExp(STORE_ID_PATTERN);

/** A receipt id built from parts: characters a store cannot hold become `-`, and it stays within the store's length. */
export function receiptId(...parts: string[]): string {
  const id = parts
    .join(".")
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .slice(0, 128);
  return STORE_ID.test(id) ? id : `r${id.slice(0, 127)}`;
}

/** Several units match: the person names the one meant. */
export function ambiguous(what: string, units: readonly string[], retry: (unit: string) => string): never {
  throw refuse(`${what}: ${units.join(", ")}`, units.map(retry).join(" | "), "ambiguous", { units });
}

/** The park `norn run stop` records; an answer to it is what sets the stopped run going again. */
export const stopParkId = (runId: string): string => receiptId("park", "stop", runId);
