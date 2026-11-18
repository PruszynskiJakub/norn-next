/**
 * What the vcs says about a story waiting on its base or its change: `base_stale` when the base moved
 * under it the way its workflow's `base.stale` and `base.verify` name, and `unpushed` when its branch holds commits its
 * open change lacks. A question the vcs cannot answer leaves the fact out, which decide reads as
 * nothing moved, never as a guess either way.
 */
import type { ChangeRequest } from "@norn/plugin-api";
import type { RunState, StoryFacts, WorkflowGraph } from "@norn/kernel";
import { baseRefOf, branchOf } from "./branches.ts";
import type { RuntimeEnv } from "./env.ts";

export type VcsFacts = Pick<StoryFacts, "base_stale" | "unpushed">;

/** The step kind a vcs plugin provides to test the merge of a moved base into the story head; read by name, never by provider. */
export const VERIFY_BASE_KIND = "verify-base";

/**
 * `base_stale` as the workflow's `base.stale` names it. `behind`: the base has a commit the story
 * lacks. `conflict` (the default): the base moved and merging it into the story head conflicts, or,
 * with `base.verify`, merges clean but breaks the merged tree. Only a step that routes `stale` reads
 * the fact, so a trial merge or a verify run is only made for a story waiting at one.
 */
async function baseStale(env: RuntimeEnv, story: string, state: RunState, graph: WorkflowGraph | undefined, storyHead: string, problems: string[]): Promise<boolean | undefined> {
  if (!graph) return undefined;
  const policy = graph.base?.stale ?? "conflict";
  if (policy === "conflict" && graph.steps[state.step]?.routes.stale === undefined) return undefined;
  const ref = await baseRefOf(env);
  const base = await env.slots.vcs.head(ref);
  if (!base.ok || base.value === null) {
    problems.push(`base ${ref}: ${base.ok ? "names no commit" : base.failure.message}`);
    return undefined;
  }
  const holds = await env.slots.vcs.isAncestor(base.value, storyHead);
  if (!holds.ok) return undefined;
  if (holds.value) return false;
  if (policy === "behind") return true;
  if (!env.slots.vcs.conflicts) {
    problems.push(`${story}: vcs ${env.slots.vcs.name} cannot try a merge, so a base move is never read as stale`);
    return undefined;
  }
  const files = await env.slots.vcs.conflicts(storyHead, base.value);
  if (!files.ok) {
    problems.push(`${story}: trial merge of ${ref}: ${files.failure.message}`);
    return undefined;
  }
  if (files.value.length > 0) return true;
  const verify = graph.base?.verify;
  return verify === undefined ? false : verifyBroken(env, story, graph, verify, problems);
}

/**
 * Whether the merge of the moved base into the story head fails the workflow's `base.verify` check.
 * The step kind tests each (head, base) pair once and answers that pair's outcome again on every
 * later poll as `tested`, so one base move runs the check once however many ticks ask.
 */
async function verifyBroken(env: RuntimeEnv, story: string, graph: WorkflowGraph, verify: string, problems: string[]): Promise<boolean | undefined> {
  const def = env.slots.stepKinds[VERIFY_BASE_KIND];
  const check = graph.steps[verify]?.check;
  if (!def || !check) {
    problems.push(`${story}: base.verify ${verify} needs step kind ${VERIFY_BASE_KIND} and a check step; the base move is not verified`);
    return undefined;
  }
  const { vcs, forge, tracker } = env.slots;
  const input = {
    unit: story,
    story,
    step: verify,
    config: { command: check.command, timeout_ms: check.timeout_ms },
    worktree: vcs.worktree.path(story),
    slots: { vcs, forge, tracker },
    branch: branchOf(story),
    base: { branch: env.config.base, ref: await baseRefOf(env) },
  };
  try {
    const got = await def.run(input, env.ctx);
    if (!got.ok) {
      problems.push(`${story}: base.verify ${verify}: ${got.failure.message}`);
      return undefined;
    }
    const tested = (got.value.detail as { tested?: unknown } | undefined)?.tested;
    return got.value.outcome === "broken" || tested === "broken";
  } catch (e) {
    problems.push(`${story}: base.verify ${verify} threw: ${e instanceof Error ? e.message : String(e)}`);
    return undefined;
  }
}

/** The story branch moved past its open change's head, which it still contains: commits the change lacks. */
async function unpushed(env: RuntimeEnv, change: ChangeRequest | null, storyHead: string): Promise<boolean | undefined> {
  if (change?.state !== "open") return undefined;
  if (change.head_sha === storyHead) return false;
  const contains = await env.slots.vcs.isAncestor(change.head_sha, storyHead);
  return contains.ok ? contains.value : undefined;
}

export async function vcsFacts(
  env: RuntimeEnv,
  story: string,
  state: RunState | null,
  graph: WorkflowGraph | undefined,
  change: ChangeRequest | null,
  problems: string[],
): Promise<VcsFacts> {
  if (!state || state.ended !== undefined) return {};
  const head = await env.slots.vcs.head(branchOf(story));
  if (!head.ok || head.value === null) return {};
  const out: VcsFacts = {};
  const stale = await baseStale(env, story, state, graph, head.value, problems);
  if (stale !== undefined) out.base_stale = stale;
  const ahead = await unpushed(env, change, head.value);
  if (ahead !== undefined) out.unpushed = ahead;
  return out;
}
