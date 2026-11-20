/**
 * The built-in vcs signal source: `stale` when the base moved under a waiting story the way its
 * workflow's `base.stale` and `base.verify` name, and `unpushed` when the story branch holds commits
 * its open change lacks. The host reports these itself because whether a base move is stale is
 * workflow policy no vcs plugin knows. Each occurrence is named by the commit it is about (the base
 * commit, the story head), so a new base move or a new push fires again and the same one never does.
 * A question the vcs cannot answer is a failure, which the gatherer leaves out of the facts.
 */
import { type ChangeRequest, fail, ok, type PluginResult, type SignalReadInput, type SignalSourceDefinition } from "@norn/plugin-api";
import type { Signal } from "@norn/schema";
import type { WorkflowGraph } from "@norn/kernel";
import { baseRefOf, branchOf } from "./branches.ts";
import { checkCommandOf } from "./check-command.ts";
import type { RuntimeEnv } from "./env.ts";
import { specOnly } from "./spec-only.ts";

/** The step kind a vcs plugin provides to test the merge of a moved base into the story head; read by name, never by provider. */
export const VERIFY_BASE_KIND = "verify-base";

const VCS = "vcs";

/** The story branch's head; null when the story has no branch yet. */
async function storyHead(env: RuntimeEnv, story: string): Promise<PluginResult<string | null>> {
  const head = await env.slots.vcs.head(branchOf(story));
  return head.ok ? ok(head.value) : fail(head.failure.code, `head of ${branchOf(story)}: ${head.failure.message}`, head.failure.retryable);
}

/**
 * The base commit the story went stale on, as the workflow's `base.stale` names it, or null when it
 * is not stale. `behind`: the base has a commit the story lacks. `conflict` (the default): the base
 * moved and merging it into the story head conflicts, or, with `base.verify`, merges clean but breaks
 * the merged tree. The gatherer asks only for a story waiting where `stale` is routed, so a trial
 * merge or a verify run is only made for one.
 */
async function baseStale(env: RuntimeEnv, story: string, graph: WorkflowGraph, head: string): Promise<PluginResult<string | null>> {
  const policy = graph.base?.stale ?? "conflict";
  const ref = await baseRefOf(env);
  const base = await env.slots.vcs.head(ref);
  if (!base.ok) return fail(base.failure.code, `base ${ref}: ${base.failure.message}`, base.failure.retryable);
  if (base.value === null) return fail("not_found", `base ${ref}: names no commit`, false);
  const holds = await env.slots.vcs.isAncestor(base.value, head);
  if (!holds.ok) return fail(holds.failure.code, `base ${ref}: ${holds.failure.message}`, holds.failure.retryable);
  if (holds.value) return ok(null);
  if (policy === "behind") return ok(base.value);
  if (!env.slots.vcs.conflicts) return fail("invalid", `vcs ${env.slots.vcs.name} cannot try a merge, so a base move is never read as stale`, false);
  const files = await env.slots.vcs.conflicts(head, base.value);
  if (!files.ok) return fail(files.failure.code, `trial merge of ${ref}: ${files.failure.message}`, files.failure.retryable);
  if (files.value.length > 0) return ok(base.value);
  const verify = graph.base?.verify;
  if (verify === undefined) return ok(null);
  const broken = await verifyBroken(env, story, graph, verify);
  return broken.ok ? ok(broken.value ? base.value : null) : broken;
}

/**
 * Whether the merge of the moved base into the story head fails the workflow's `base.verify` check.
 * The step kind tests each (head, base) pair once and answers that pair's outcome again on every
 * later poll as `tested`, so one base move runs the check once however many ticks ask.
 */
async function verifyBroken(env: RuntimeEnv, story: string, graph: WorkflowGraph, verify: string): Promise<PluginResult<boolean>> {
  const def = env.slots.stepKinds[VERIFY_BASE_KIND];
  const check = graph.steps[verify]?.check;
  if (!def || !check) return fail("invalid", `base.verify ${verify} needs step kind ${VERIFY_BASE_KIND} and a check step; the base move is not verified`, false);
  const command = checkCommandOf(check.command, env.config.checks);
  if (!command.ok) return fail("invalid", `base.verify ${verify}: ${command.error}; the base move is not verified`, false);
  const { vcs, forge, tracker } = env.slots;
  const input = {
    unit: story,
    story,
    step: verify,
    config: { command: command.command, timeout_ms: check.timeout_ms },
    worktree: vcs.worktree.path(story),
    slots: { vcs, forge, tracker },
    branch: branchOf(story),
    base: { branch: env.config.base, ref: await baseRefOf(env) },
  };
  try {
    const got = await def.run(input, env.ctx);
    if (!got.ok) return fail(got.failure.code, `base.verify ${verify}: ${got.failure.message}`, got.failure.retryable);
    const tested = (got.value.detail as { tested?: unknown } | undefined)?.tested;
    return ok(got.value.outcome === "broken" || tested === "broken");
  } catch (e) {
    return fail("unavailable", `base.verify ${verify} threw: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** The story branch moved past its open change's head, which it still contains, with commits the change lacks beyond the spec folder. */
async function unpushed(env: RuntimeEnv, story: string, change: ChangeRequest | null | undefined, head: string): Promise<PluginResult<boolean>> {
  if (change?.state !== "open" || change.head_sha === head) return ok(false);
  const contains = await env.slots.vcs.isAncestor(change.head_sha, head);
  if (!contains.ok) return contains;
  if (!contains.value) return ok(false);
  const notes = await specOnly(env.slots.vcs, story, change.head_sha, head);
  return notes.ok ? ok(!notes.value) : notes;
}

/** The vcs source's two signals for a story under `graph`, the workflow whose `base:` policy `stale` reads. */
export function vcsSignalSources(env: RuntimeEnv, graph: WorkflowGraph): Record<"stale" | "unpushed", SignalSourceDefinition> {
  return {
    stale: {
      read: async (input: SignalReadInput): Promise<PluginResult<Signal | null>> => {
        const head = await storyHead(env, input.story);
        if (!head.ok || head.value === null) return head.ok ? ok(null) : head;
        const at = await baseStale(env, input.story, graph, head.value);
        if (!at.ok) return at;
        return ok(at.value === null ? null : { type: "stale", source: VCS, id: at.value });
      },
    },
    unpushed: {
      read: async (input: SignalReadInput): Promise<PluginResult<Signal | null>> => {
        const head = await storyHead(env, input.story);
        if (!head.ok || head.value === null) return head.ok ? ok(null) : head;
        const ahead = await unpushed(env, input.story, input.change, head.value);
        if (!ahead.ok) return ahead;
        return ok(ahead.value ? { type: "unpushed", source: VCS, id: head.value } : null);
      },
    },
  };
}
