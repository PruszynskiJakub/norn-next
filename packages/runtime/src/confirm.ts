/**
 * Holding a repo's changed workflow for the person's confirmation. A repo file can be edited by an
 * agent inside its step, so one that changes what the person confirms (`guardChanges`: its person's
 * steps, `attended:`, `allow:`) is not run until the person confirms it with `norn workflow confirm`;
 * new rounds keep the revision the person last confirmed, else the pack's, and a workflow only the
 * repo has, weighed against no steps at all, waits with none. The pack's own files are trusted as the binary the person installed, and
 * a change that matches the pack's guarded parts, or the confirmed revision's, runs as it is.
 * Confirmed revisions live in the machine dir, outside every worktree.
 */
import { join } from "node:path";
import { guardChanges, type KernelWorkflows, type LoadedWorkflow, type LoadWorkflowOptions, loadWorkflow, PinnedWorkflow, type WorkflowLoad } from "@norn/kernel";
import { type HostFiles, parseJson } from "@norn/plugin-api";

/** Relative to the machine dir. */
export const CONFIRMED_DIR = "workflows";

/** Where the revision the person confirmed of workflow `name` is kept. */
export const confirmedWorkflowPath = (dataDir: string, name: string): string => join(dataDir, CONFIRMED_DIR, `${name}.json`);

/** Each confirmed revision's text by workflow name; empty when the person confirmed none. */
export async function readConfirmedWorkflows(files: HostFiles, dataDir: string): Promise<Record<string, string>> {
  const dir = join(dataDir, CONFIRMED_DIR);
  const out: Record<string, string> = {};
  for (const file of await files.list(dir)) {
    if (!file.endsWith(".json")) continue;
    const text = await files.read(join(dir, file));
    if (text !== null) out[file.slice(0, -".json".length)] = text;
  }
  return out;
}

/**
 * A workflow whose file is held: what it loads to now, what changed from the revision new rounds run
 * instead, and that revision by hash, the person's last confirmed one or the pack's (null: none).
 */
export interface HeldWorkflow {
  current: LoadedWorkflow;
  changes: string[];
  running: { hash: string; from: "confirmed" | "pack" } | null;
  /** why the revision the person confirmed runs no more: the floor refuses it under the policy as it is now */
  refused?: string;
}

/** What each load takes but its shared files, worked out from the document loaded: a policy grant names a step by the workflow's own `name:`. */
export type ConfirmOptions = (doc: unknown, name: string) => Omit<LoadWorkflowOptions, "sharedFiles">;

/**
 * A confirmed revision, loaded as a pin is (to its own hash) but on the floor the policy sets now, so
 * a grant made since a confirmation never runs a revision the floor refuses; `refused` then says why.
 * One that is not a pinned revision, or no longer loads to its hash, confirms nothing.
 */
function confirmedLoad(text: string | undefined, name: string, opts: ConfirmOptions): { workflow: LoadedWorkflow | null; refused?: string } {
  if (text === undefined) return { workflow: null };
  const pinned = parseJson(PinnedWorkflow, text, "a confirmed revision");
  if (!pinned.ok) return { workflow: null };
  const load = loadWorkflow(structuredClone(pinned.value.doc), { ...opts(pinned.value.doc, name), sharedFiles: {} });
  if (!load.ok) {
    const floor = load.errors.filter((e) => e.granted !== undefined);
    return floor.length > 0 ? { workflow: null, refused: floor.map((e) => e.message).join("; ") } : { workflow: null };
  }
  return { workflow: load.workflow.pinned.hash === pinned.value.hash ? load.workflow : null };
}

/**
 * `overlaid`: what each workflow loads to with the repo's files; `packOnly`: what it loads to from
 * the pack alone. A workflow the repo left as the pack has it is never held.
 */
export function holdChanged(
  overlaid: KernelWorkflows["byName"],
  packOnly: KernelWorkflows["byName"],
  confirmed: Readonly<Record<string, string>>,
  opts: ConfirmOptions,
): { byName: Record<string, WorkflowLoad>; held: Record<string, HeldWorkflow> } {
  const byName: Record<string, WorkflowLoad> = { ...overlaid };
  const held: Record<string, HeldWorkflow> = {};
  for (const [name, load] of Object.entries(overlaid)) {
    if (!load.ok) continue;
    const current = load.workflow;
    const fromPack = packOnly[name];
    const pack = fromPack?.ok ? fromPack.workflow : null;
    if (pack?.pinned.hash === current.pinned.hash) continue;
    const { workflow: record, refused } = confirmedLoad(confirmed[name], name, opts);
    const trusted = [record && { w: record, from: "confirmed" as const }, pack && { w: pack, from: "pack" as const }].filter((t) => t !== null);
    if (trusted.some(({ w }) => w.pinned.hash === current.pinned.hash || guardChanges(w.pinned.doc, current.pinned.doc).length === 0)) continue;
    const running = trusted[0] ?? null;
    // a workflow only the repo has is weighed against none: its own person's steps, attended: and allow: are all new
    const changes = guardChanges(running?.w.pinned.doc ?? { ...current.pinned.doc, steps: {} }, current.pinned.doc);
    if (changes.length === 0) continue;
    held[name] = { current, changes, running: running && { hash: running.w.pinned.hash, from: running.from }, ...(refused !== undefined && { refused }) };
    const dropped = refused !== undefined ? `; the revision the person confirmed is refused: ${refused}` : "";
    byName[name] = running
      ? { ok: true, workflow: running.w }
      : { ok: false, errors: [{ path: "", message: `${name} is held for the person's confirmation (${changes.join("; ")}): a person runs norn workflow confirm ${name}${dropped}` }] };
  }
  return { byName, held };
}
