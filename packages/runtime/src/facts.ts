/**
 * Gathering KernelFacts: the tracker's intake and items, the forge's changes, every unit read through
 * the Journal with its version, claims, the mailbox, sessions, in-flight step runs, base_stale and
 * unpushed from the vcs, and the slice plan of a story at its slices step. Facts are read, never acted on as run state, so gathering twice changes nothing.
 *
 * A story whose record or claim cannot be read is left out of the tick whole: half a story (a slice
 * missing, a claim read as nobody's) would let decide start what is already running. A tracker or
 * forge that fails only leaves its fact empty, which decide reads as nothing new.
 *
 * The tick's gathering writes host memory (settled step runs, a stopped overdue check, a store sync,
 * the slice files a person edited read back); a read-only gathering skips those writes.
 */
import {
  type ExecutorCapabilities,
  type KernelCapabilities,
  type KernelFacts,
  type KernelWorkflows,
  type PinnedWorkflow,
  type StoryFacts,
  type UnitFacts,
  validateKernelFacts,
} from "@norn/kernel";
import { type ChangeRequest, fail, ok, parseStoryKey, parseUnitId, type PluginResult, type TrackerItem } from "@norn/plugin-api";
import { branchOf } from "./branches.ts";
import type { RuntimeEnv } from "./env.ts";
import { readUnitFacts } from "./facts-unit.ts";
import { readBackDocs } from "./inputs.ts";
import { readSlicePlan } from "./slice-plan.ts";
import { vcsFacts } from "./facts-vcs.ts";
import { tickWorkflows } from "./workflows.ts";

export interface GatheredFacts {
  facts: KernelFacts;
  /** the pack's workflows plus every workflow a unit has pinned, as decide reads them */
  workflows: KernelWorkflows;
  /** what was left out or came back empty, and why */
  problems: string[];
}

/**
 * `readOnly`: a reader outside the tick lock (a view) computes the same facts but writes nothing: no
 * settled step run, no stop of a check past its deadline, no store sync. Those writes race the tick's
 * own (a view settling a check start the tick has in flight would have it spawned twice).
 */
export interface GatherOptions {
  readOnly?: boolean;
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function capabilitiesOf(env: RuntimeEnv): KernelCapabilities {
  const executors: Record<string, ExecutorCapabilities> = {};
  for (const [name, harness] of Object.entries(env.slots.executors)) {
    const { blockStop, denyTool, injectContext, subagents, limits, paneInput, promptMarks, resume } = harness.capabilities;
    const own = env.launcher.modesOf?.(name) ?? null;
    executors[name] = {
      blockStop,
      denyTool,
      injectContext,
      subagents,
      limits,
      // a harness that reads typed prompts still has no pane input in a runner without a pane
      paneInput: own ? paneInput && own.paneInput : paneInput,
      ...(promptMarks !== undefined && { promptMarks }),
      // decide applies an answer undelivered only when no resumed session could take it
      ...(resume !== undefined && { resume }),
      headless: own?.headless ?? env.launcher.modes.headless,
      attended: own?.attended ?? env.launcher.modes.attended,
      ...(own?.dialogKeys === true && { dialogKeys: true }),
    };
  }
  return { tracker: { ...env.slots.tracker.capabilities }, forge: { ...env.slots.forge.capabilities }, store: { ...env.slots.store.capabilities }, executors };
}

/** A story as the store holds it, before the tracker, forge and vcs add theirs. */
interface StoryRead {
  key: string;
  units: UnitFacts[];
  claim: StoryFacts["claim"];
  mailbox: StoryFacts["mailbox"];
  /** when its first receipt was taken: stories go to decide oldest first, which is the order capacity goes by */
  since: string;
  pinned: PinnedWorkflow[];
}

async function readStory(env: RuntimeEnv, key: string, unitIds: string[], problems: string[], opts: GatherOptions): Promise<PluginResult<StoryRead>> {
  const claim = await env.slots.store.claims.read(key);
  if (!claim.ok) return fail(claim.failure.code, `claim: ${claim.failure.message}`, claim.failure.retryable);
  const units: UnitFacts[] = [];
  const pinned: PinnedWorkflow[] = [];
  let since = "";
  // the story's own unit first, then its slices by number, as decide expects
  const ordered = [...unitIds].sort((a, b) => (a === key ? -1 : b === key ? 1 : a.localeCompare(b)));
  for (const id of ordered) {
    const read = await readUnitFacts(env, id, problems, opts);
    if (!read.ok) return read;
    units.push(read.value.facts);
    const j = read.value.journal;
    if (id === key) since = j.receipts[0]?.at ?? "";
    if (j.state) pinned.push(j.state.workflow);
    for (const r of j.unapplied) if (r.data.kind === "round.started") pinned.push(r.data.workflow);
  }
  let mailbox: StoryFacts["mailbox"] = [];
  if (env.slots.store.mailbox) {
    const got = await env.slots.store.mailbox.receive(key);
    if (got.ok) mailbox = got.value;
    else problems.push(`${key}: mailbox: ${got.failure.message}`);
  }
  return ok({ key, units, claim: claim.value, mailbox, since, pinned });
}

async function itemOf(env: RuntimeEnv, key: string, problems: string[]): Promise<TrackerItem | null> {
  const parsed = parseStoryKey(key, env.slots.tracker.keyPrefix);
  if (!parsed) return null;
  const got = await env.slots.tracker.get(parsed.id);
  if (got.ok) return got.value;
  problems.push(`${key}: tracker: ${got.failure.message}`);
  return null;
}

async function changesOf(env: RuntimeEnv, keys: string[], problems: string[]): Promise<Record<string, ChangeRequest | null>> {
  if (keys.length === 0) return {};
  const got = await env.slots.forge.findChanges(keys.map(branchOf));
  if (got.ok) return got.value;
  problems.push(`forge: ${got.failure.message}`);
  return {};
}

/** Every unit id the store lists, by its story. */
function byStory(ids: readonly string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const id of ids) {
    const ref = parseUnitId(id);
    if (!ref) continue;
    out.set(ref.story, [...(out.get(ref.story) ?? []), id]);
  }
  return out;
}

async function readStories(env: RuntimeEnv, ids: readonly string[], problems: string[], opts: GatherOptions): Promise<StoryRead[]> {
  const reads: StoryRead[] = [];
  for (const [key, unitIds] of byStory(ids)) {
    try {
      const read = await readStory(env, key, unitIds, problems, opts);
      if (read.ok) reads.push(read.value);
      else problems.push(`${key} left out: ${read.failure.message}`);
    } catch (e) {
      problems.push(`${key} left out: ${message(e)}`);
    }
  }
  return reads.sort((a, b) => a.since.localeCompare(b.since) || a.key.localeCompare(b.key));
}

export async function gatherFacts(env: RuntimeEnv, tickId: string, opts: GatherOptions = {}): Promise<PluginResult<GatheredFacts>> {
  const problems: string[] = [];
  // a shared store shows other machines' run data only once synced; without it a story another machine
  // carried on (or finished) would be decided from this machine's stale copy
  const store = env.slots.store;
  if (!opts.readOnly && store.capabilities.shared && store.sync) {
    const synced = await store.sync();
    if (!synced.ok) problems.push(`store sync: ${synced.failure.message}`);
  }
  const listed = await store.listUnits();
  if (!listed.ok) return fail(listed.failure.code, `store: ${listed.failure.message}`, listed.failure.retryable);
  const reads = await readStories(env, listed.value, problems, opts);
  const workflows = tickWorkflows(
    env,
    reads.flatMap((r) => r.pinned),
  );
  const changes = await changesOf(
    env,
    reads.map((r) => r.key),
    problems,
  );
  // a base or change that moved on the remote is only seen once fetched
  if (reads.length > 0 && env.slots.vcs.capabilities.push) {
    const fetched = await env.slots.vcs.fetch();
    if (!fetched.ok) problems.push(`vcs fetch: ${fetched.failure.message}`);
  }
  const stories: StoryFacts[] = [];
  for (const r of reads) {
    const own = r.units.find((u) => u.id === r.key)?.state ?? null;
    const change = changes[branchOf(r.key)] ?? null;
    const graph = own ? workflows.byHash[own.workflow.hash]?.graph : undefined;
    const story: StoryFacts = { key: r.key, item: await itemOf(env, r.key, problems), change, claim: r.claim, units: r.units, mailbox: r.mailbox };
    Object.assign(story, await vcsFacts(env, r.key, own, graph, change, problems));
    if (own && own.ended === undefined && graph?.steps[own.step]?.kind === "slices") {
      // a person edits the slice files in the story's worktree at the gate before the slices step
      if (!opts.readOnly) await readBackDocs(env, r.key);
      const plan = await readSlicePlan(env, r.key);
      if (!plan.ok) {
        // half a plan could start a slice whose dependency was not read: the story waits for a full one
        problems.push(`${r.key} left out: slice files: ${plan.failure.message}`);
        continue;
      }
      if (plan.value) story.plan = plan.value;
    }
    stories.push(story);
  }
  const intake = await env.slots.tracker.intake(env.config.intake);
  if (!intake.ok) problems.push(`tracker intake: ${intake.failure.message}`);
  const facts: KernelFacts = {
    tick_id: tickId,
    now: env.ctx.now(),
    holder: env.config.holder,
    capabilities: capabilitiesOf(env),
    stories,
    intake: intake.ok ? intake.value : [],
  };
  const valid = validateKernelFacts(facts);
  if (!valid.ok) return fail("invalid", `facts fail validation: ${valid.errors.map((e) => `${e.path || "/"} ${e.message}`).join("; ")}`, false);
  return ok({ facts, workflows, problems });
}
