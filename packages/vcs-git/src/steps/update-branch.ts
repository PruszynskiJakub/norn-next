/**
 * `update-branch`: merge the base into the story branch, never rebasing. `clean` and `resolved` take
 * the light path when only the base moved since the change request last took the branch; `done` is
 * the full path; `conflict` aborts the merge and names the base commit and the paths, so the resolver
 * starts from a clean worktree and merges that commit itself.
 *
 * Nothing is pushed here: the remote branch is what the change request last took, the anchor the
 * light path measures from, and only the steps that publish the change move it.
 */
import { fail, type HostContext, ok, type PluginResult, type StepKindDefinition, type StepKindInput, type StepKindOutcome } from "@norn/plugin-api";
import { mergeInto } from "../merge.ts";
import { fetchRemote } from "../push.ts";
import { isAncestor, notReady, revParse } from "../refs.ts";
import { GitStepConfig, type RemoteSync, resolveBase, type StepPlace, stepPlace, syncRemote } from "./common.ts";
import { commitsSince, lightOutcome } from "./light.ts";

export const UpdateBranchConfig = GitStepConfig;

type Input = StepKindInput<GitStepConfig>;

/**
 * Where the light path measures from: the remote branch, which only publishing steps move, while the
 * story's change request is open. Commits a person pushed there were never reviewed, so a branch that
 * took any has no anchor; neither has one whose forge reports no open change.
 */
async function lightAnchor(input: Input, p: StepPlace, sync: RemoteSync): Promise<string | null> {
  if (sync.took || sync.tracking === null) return null;
  const forge = input.slots?.forge;
  if (forge) {
    const found = await forge.findChanges([p.branch]);
    if (!found.ok || found.value[p.branch]?.state !== "open") return null;
  }
  return sync.tracking;
}

async function run(input: Input, ctx: HostContext): Promise<PluginResult<StepKindOutcome>> {
  const place = await stepPlace(ctx, input);
  if (!place.ok) return place;
  const p = place.value;
  const busy = await notReady(ctx, p.cwd);
  if (!busy.ok) return busy;
  if (busy.value !== null) return fail("conflict", `update-branch: ${busy.value}`, false);
  const fetched = await fetchRemote(ctx, p.cwd, p.remote);
  if (!fetched.ok) return fetched;
  const sync = await syncRemote(ctx, p);
  if (!sync.ok) return sync;
  const base = await resolveBase(ctx, p.cwd, input, p.remote);
  if (!base.ok) return base;
  const b = base.value;
  const anchor = await lightAnchor(input, p, sync.value);

  const holds = await isAncestor(ctx, p.cwd, b.sha, "HEAD");
  if (!holds.ok) return holds;
  let merged = false;
  if (!holds.value) {
    const m = await mergeInto(ctx, p.cwd, b.sha, { message: `Update ${input.story} from ${b.ref} (${b.sha.slice(0, 7)})` });
    if (!m.ok) return m;
    if ("conflict" in m.value) return ok({ outcome: "conflict", detail: { base: { ref: b.ref, sha: b.sha }, conflicts: m.value.conflict.files } });
    merged = m.value.merged;
  }
  const head = await revParse(ctx, p.cwd, "HEAD");
  if (!head.ok) return head;
  const detail = { base: { ref: b.ref, sha: b.sha }, head: head.value, merged, ...(sync.value.took ? { took_remote: sync.value.tracking } : {}) };
  if (anchor === null) return ok({ outcome: "done", detail });
  const commits = await commitsSince(ctx, p.cwd, anchor, b.sha);
  if (!commits.ok) return commits;
  const light = commits.value === null ? null : lightOutcome(commits.value, input.story);
  return ok({ outcome: light ?? "done", detail: { ...detail, anchor } });
}

export const updateBranch: StepKindDefinition<typeof UpdateBranchConfig> = {
  name: "update-branch",
  configSchema: UpdateBranchConfig,
  outcomes: ["done", "conflict", "clean", "resolved"],
  mode: "effect",
  slot: "vcs",
  run,
};
