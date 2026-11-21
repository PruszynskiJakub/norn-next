/**
 * What the person verbs share: the units a story key (or one unit id) names, read through the
 * journal, and the receipt ids they write. A person verb only records a receipt the kernel models;
 * the next tick applies it, so routing stays in the kernel.
 */
import { loadProblem, type UnitJournal } from "@norn/kernel";
import { parseStoryKey, STORE_ID_PATTERN } from "@norn/plugin-api";
import { branchOf, REPO_WORKFLOWS_DIR, repoFileOf, type RuntimeEnv } from "@norn/runtime";
import { type CliFailure, corruptError, failure, refuse } from "../output.ts";
import { policyRefused } from "../plugins/pack-check.ts";

/** What a person does when only their own policy grant takes a workflow off the floor. */
export const NARROW_POLICY = "narrow your grant: norn config set policy.stand_in.gates <the gates a stand-in may still decide> --user";

/**
 * Why a person may not name this workflow, or null when it loads. One no file holds is named with
 * the ones that load and the repo file that would add it; one whose file fails to load, with why; one
 * only the person's own grant takes off the floor, with the policy key to narrow; one held for the
 * person's confirmation with nothing confirmed to run instead, with the confirmation.
 */
export function workflowRefusal(env: RuntimeEnv, name: string): CliFailure | null {
  const load = env.workflows[name];
  if (load?.ok) return null;
  if (!load) {
    const loading = Object.entries(env.workflows).flatMap(([n, w]) => (w.ok ? [n] : [])).sort();
    return refuse(`no workflow ${name}`, `name one of ${loading.join(", ")}, or write ${REPO_WORKFLOWS_DIR}/${name}.yaml`, "unknown_workflow");
  }
  if (policyRefused({ [name]: load }).length > 0) return refuse(loadProblem(name, load) ?? `workflow ${name} is off the floor`, NARROW_POLICY, "workflow_policy_floor");
  if (env.held[name]) return refuse(loadProblem(name, load) ?? `workflow ${name} is held for the person's confirmation`, `norn workflow confirm ${name}`, "workflow_held");
  const file = repoFileOf(env.repoWorkflows, name, "workflow");
  return refuse(loadProblem(name, load) ?? `workflow ${name} is invalid`, `fix ${file ?? `the workflow ${name}`}, then norn doctor`, "invalid_workflow");
}

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

/**
 * Fetch other machines' writes before a person verb reads a story's record or claim and writes beside
 * it: a clone behind the remote would refuse on a round that ended there, or append at a seq the remote
 * already used, and its later flushes would be refused for good. `retry` is the verb to run again.
 */
export async function syncStore(env: RuntimeEnv, key: string, retry: string): Promise<void> {
  const store = env.slots.store;
  if (!store.capabilities.shared || !store.sync) return;
  const got = await store.sync();
  if (!got.ok) throw failure(`cannot sync the run data of ${key}: ${got.failure.message}`, `${retry} again once the remote is reachable`, got.failure.code);
}

/** Several units match: the person names the one meant. */
export function ambiguous(what: string, units: readonly string[], retry: (unit: string) => string): never {
  throw refuse(`${what}: ${units.join(", ")}`, units.map(retry).join(" | "), "ambiguous", { units });
}

/** The park `norn run stop` records; an answer to it is what sets the stopped run going again. */
export const stopParkId = (runId: string): string => receiptId("park", "stop", runId);

/** A merged change or a closed item ends any round at once, and any unit taken up again, so new work there is a new story. */
export async function refuseFinished(env: RuntimeEnv, key: string, what = "a new round"): Promise<void> {
  const changes = await env.slots.forge.findChanges([branchOf(key)]);
  if (!changes.ok) throw failure(`cannot read the change of ${key}: ${changes.failure.message}`, "try again", changes.failure.code);
  const change = changes.value[branchOf(key)];
  if (change?.state === "merged")
    throw refuse(`the change of ${key}${change.url ? ` (${change.url})` : ""} merged; ${what} would end at once`, 'norn story create "<title>" for the new work', "change_merged");
  const tracker = env.slots.tracker;
  const parsed = parseStoryKey(key, tracker.keyPrefix);
  if (!parsed) return;
  const item = await tracker.get(parsed.id);
  if (!item.ok) throw failure(`cannot read ${key}: ${item.failure.message}`, "try again", item.failure.code);
  if (item.value && !item.value.open) throw refuse(`the item of ${key} is closed; ${what} would end at once`, 'norn story create "<title>" for the new work', "item_closed");
}
