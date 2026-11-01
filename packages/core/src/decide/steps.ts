/** decide for the other step types: story start, check and git steps, and the slices step (W2). */
import {
  type GitStep,
  PR_BODY_FILE,
  type ReceiptOf,
  type SliceFrontmatter,
  sliceBranch,
  sliceDirName,
  type StoryFrontmatter,
  type UnitState,
  type Workflow,
  unitRecordPath,
} from "@norn/schema";
import type { RunGitAction, WorktreeSpec } from "../actions.ts";
import { initialState, routeOf } from "../apply.ts";
import { cmd, sliceWorktreePath, storyWorktreePath } from "../commands.ts";
import type { SliceFileFacts, StoryFacts, UnitFacts, UnitRef } from "../facts.ts";
import { sha256 } from "../hash.ts";
import { unitWorktree } from "../policy.ts";
import { checkWorkflowLevel, stepOf, type UnitLevel } from "../workflow.ts";
import { commitFor, type Ctx, emitApplied, nextReceiptNumber, nornReceipt, park, rebasing, synth, trailersFor, unitBranch } from "./receipts.ts";

// ---------------------------------------------------------------- start

export function startStoryUnit(ctx: Ctx, story: StoryFacts, uf: UnitFacts): void {
  const fm = story.frontmatter as StoryFrontmatter;
  const loaded = usableWorkflow(ctx, fm.workflow, "story");
  if ("problem" in loaded) {
    return ctx.emit({
      kind: "notify",
      unit: uf.unit,
      rule: "start.workflow_invalid",
      item: { id: `workflow:${story.key}:${fm.workflow}:${sha256(loaded.problem)}`, group: "unblock", story: story.key, slice: null, step: null, title: loaded.problem, command: cmd.storyEdit(story.key, { workflow: "<name>" }), since: ctx.nowIso, url: fm.url },
    });
  }
  const worktree = unitWorktree(story, uf);
  if (!worktree) return ctx.noop(uf.unit, "start.no_worktree", "story worktree missing (GR2)");
  const state = initialState({ unit: uf.unit, workflow: loaded.workflow, workflowName: fm.workflow, workflowHash: sha256(loaded.source), now: ctx.nowIso, mode: story.mode, tick_id: ctx.facts.tick_id });
  ctx.emit({
    kind: "start_unit",
    unit: uf.unit,
    rule: "story.start",
    workflow: fm.workflow,
    workflow_source: loaded.source,
    worktree: null,
    slice_status: null,
    receipts: [],
    state,
    commit: commitFor(ctx, story, uf, `norn: start ${story.key} (${fm.workflow})`, state.step),
  });
}

function usableWorkflow(ctx: Ctx, name: string, level: UnitLevel): { workflow: Workflow; source: string } | { problem: string } {
  const lw = ctx.workflows[name];
  if (!lw) return { problem: `workflow '${name}' not found` };
  const issues = [...lw.issues, ...(lw.workflow ? checkWorkflowLevel(lw.workflow, level) : [])];
  if (!lw.workflow || issues.length) return { problem: `workflow '${name}' is invalid: ${issues.map((i) => i.message).join("; ") || "schema"}` };
  return { workflow: lw.workflow, source: lw.source };
}

// ---------------------------------------------------------------- check / git

/** gh-71 D2: the unit's record folder relative to its spec folder, as observe resolved it. */
export function recordOf(uf: UnitFacts): string {
  return uf.record ?? unitRecordPath(uf.unit.dir);
}

export function runCheck(ctx: Ctx, story: StoryFacts, uf: UnitFacts, st: UnitState, command: string, timeout_ms: number): void {
  const ref = uf.unit;
  if (uf.lease?.kind === "check") return ctx.noop(ref, "check.running", `check run ${uf.lease.run_id ?? "?"} in progress`);
  const cwd = unitWorktree(story, uf);
  if (!cwd) return ctx.noop(ref, "check.no_worktree", "unit worktree missing");
  if (ctx.checksFree <= 0) return ctx.noop(ref, "check.queued", `queued: max_checks ${ctx.config.max_checks} in use (K1)`);
  ctx.checksFree--;
  const run_id = ctx.id();
  const env: Record<string, string> = { NORN_STORY: story.key, NORN_RUN: run_id, ...ctx.slotEnv(uf.worktree?.slot ?? null) };
  if (ref.slice) env.NORN_SLICE = ref.slice;
  ctx.emit({
    kind: "run_check",
    unit: ref,
    rule: "check.run",
    step: st.step,
    run_id,
    command,
    cwd,
    timeout_ms,
    env,
    log_path: `${story.spec_dir}/${recordOf(uf)}/logs/${run_id}.log`,
  });
}

export function runGit(ctx: Ctx, story: StoryFacts, uf: UnitFacts, st: UnitState, wf: Workflow, step: GitStep): void {
  const ref = uf.unit;
  const cwd = unitWorktree(story, uf);
  if (!cwd) return ctx.noop(ref, "git.no_worktree", "unit worktree missing");
  if (step.action === "integrate" || step.action === "update") {
    // K6: integration is serialized per story — a base update (BS3) takes the same lock
    if (ctx.integrating.has(story.key)) return ctx.noop(ref, `git.${step.action}.queued`, "another integration of this story runs this tick (K6)");
    ctx.integrating.add(story.key);
  }
  const fm = story.frontmatter as StoryFrontmatter;
  let update: RunGitAction["update"] = null;
  if (step.action === "update") {
    // BS1/BS3: the base is measured by observe; no base ref (never fetched, no base branch) → wait
    const b = story.base;
    if (!b) return ctx.noop(ref, "git.update.no_base", `base ${ctx.facts.repo.default_branch} not observed for ${story.branch}`);
    const base = ctx.facts.repo.default_branch;
    update = {
      ref: b.ref,
      sha: b.sha,
      branch: base,
      message: `Update ${story.key} from ${base} (${b.sha.slice(0, 7)})`,
      trailers: trailersFor(ctx, story.key, uf.unit.slice, st.step),
    };
  }
  ctx.emit({
    kind: "run_git",
    unit: ref,
    rule: `git.${step.action}`,
    step: st.step,
    run_id: ctx.id(),
    action: step.action,
    cwd,
    branch: unitBranch(story, uf),
    onto: step.action === "integrate" ? story.branch : null,
    pr:
      step.action === "open-pr"
        ? { base: ctx.facts.repo.default_branch, title: fm.title, body: `Closes ${fm.url}\n\nDelivered by norn (story ${story.key}).`, body_file: `${story.spec_dir}/${PR_BODY_FILE}` }
        : null,
    ...(update ? { update } : {}),
  });
}

/** BS8: the base a classify receipt records. */
export const baseOf = (b: NonNullable<StoryFacts["base"]>): NonNullable<ReceiptOf<"classify">["base"]> => ({ ref: b.ref, sha: b.sha, behind: b.behind, conflicts: [...b.conflicts] });

/** A norn-classified outcome for a non-agent step (git/slices/gate), applied in the same tick. */
export function classifyNorn(
  ctx: Ctx,
  story: StoryFacts,
  uf: UnitFacts,
  st: UnitState,
  wf: Workflow,
  outcome: string,
  rule: string,
  detail: string,
  extra: { receiptRule?: string; base?: NonNullable<ReceiptOf<"classify">["base"]> } = {},
): void {
  const receipt = nornReceipt(ctx, st, "classify", { outcome, rule: extra.receiptRule ?? rule, detail, route: "park", ...(extra.base ? { base: extra.base } : {}) });
  const { nr, res } = synth(ctx, st, wf, nextReceiptNumber(uf), receipt);
  // §10, W4: the route is where applying the receipt sent the unit
  receipt.route = routeOf(res) ?? "park";
  ctx.emit({
    kind: "classify",
    unit: uf.unit,
    rule,
    outcome,
    kill: null,
    snapshot: null,
    receipts: [nr],
    state: res.state,
    commit: commitFor(ctx, story, uf, `norn: ${uf.unit.key} ${st.step} ${outcome} → ${receipt.route}`, st.step),
  });
}

// ---------------------------------------------------------------- slices (W2)

/**
 * §10: the story is stuck because its slices step classified `stuck` (that receipt parked it), and
 * a slice can move again now — a person unstuck it, or the slice files changed.
 */
export function slicesCanResume(story: StoryFacts, uf: UnitFacts, st: UnitState, wf: Workflow): boolean {
  if (uf.unit.slice !== null || stepOf(wf, st.step)?.type !== "slices") return false;
  const parkedBySlices = st.park?.kind === "stuck" && st.park.receipt_id !== undefined
    && st.last_outcome?.step === st.step && st.last_outcome.outcome === "stuck" && st.last_outcome.receipt_id === st.park.receipt_id;
  return parkedBySlices && !sliceProgress(story).broken.length && slicesStuck(story) === null;
}

/** §10, O2: norn unsticks the story back into its slices step, as `norn run rerun <story>` would. */
export function resumeSlices(ctx: Ctx, story: StoryFacts, uf: UnitFacts, st: UnitState, wf: Workflow): void {
  const unstick = nornReceipt(ctx, st, "unstick", { comment: "a slice can move again" });
  const { nr, res } = synth(ctx, st, wf, nextReceiptNumber(uf), unstick);
  emitApplied(ctx, story, uf, "slices.resume", res, [nr], { message: `norn: ${uf.unit.key} ${st.step} resumed (a slice can move again)`, step: st.step });
}

/** The story's slice files (dropped ones aside) and how far each has come. */
function sliceProgress(story: StoryFacts) {
  const unitOf = (key: string) => story.units.find((u) => u.unit.slice === key);
  const files = story.slices.filter((s) => s.frontmatter?.status !== "dropped");
  const broken = files.filter((s) => !s.frontmatter);
  const integrated = (s: SliceFileFacts) => s.frontmatter?.status === "integrated" || unitOf(s.key)?.state?.status === "done";
  const done = new Set(files.filter(integrated).map((s) => s.key));
  // a broken file (null frontmatter) is never pending: decide notes `slices.file_invalid` first (S2)
  const pending = files.filter((s): s is SliceFileFacts & { frontmatter: SliceFrontmatter } => !!s.frontmatter && !done.has(s.key) && !unitOf(s.key)?.state);
  const startable = pending.filter((s) => s.frontmatter.depends_on.every((d) => done.has(d)));
  return { unitOf, files, broken, done, pending, startable };
}

/** §10: why no slice can move without a person (no slice files, every active slice stuck, none can start); null when one can. */
function slicesStuck(story: StoryFacts): { rule: string; detail: string } | null {
  const { unitOf, files, done, pending, startable } = sliceProgress(story);
  if (!files.length) return { rule: "slices.none", detail: "no slice files" };
  if (done.size === files.length || startable.length) return null;
  const activeUnits = files.filter((s) => !done.has(s.key) && unitOf(s.key)?.state);
  const isStuck = (s: SliceFileFacts) => {
    const u = unitOf(s.key);
    // gh-79 (H1): a rebasing slice's state is a rewound copy; it is held, so it still progresses
    if (u && rebasing(u)) return false;
    const status = u?.state?.status;
    return status === "stuck" || status === "corrupt";
  };
  // running or parked slices still progress
  const stuckSlices = activeUnits.filter(isStuck);
  if (stuckSlices.length && stuckSlices.length === activeUnits.length) {
    const corrupt = (s: SliceFileFacts) => unitOf(s.key)?.state?.status === "corrupt";
    const named = stuckSlices.map((s) => (corrupt(s) ? `slice ${s.key} corrupt (S2)` : `slice ${s.key} stuck: ${unitOf(s.key)?.state?.park?.reason ?? "?"}`));
    // gh-79: run rerun refuses a corrupt unit, so a corrupt one is pointed at run view --why
    const first = stuckSlices[0] as SliceFileFacts;
    return { rule: "slices.slice_stuck", detail: `${named.join("; ")} — ${corrupt(first) ? cmd.runView(first.key, { why: true }) : cmd.runRerun(first.key)}` };
  }
  if (!activeUnits.length) {
    const blocked = pending.map((s) => `${s.key} waits for ${s.frontmatter.depends_on.filter((d) => !done.has(d)).join(", ")}`);
    return { rule: "slices.blocked", detail: `no slice can start: ${blocked.join("; ")}` };
  }
  return null;
}

export function slicesStep(ctx: Ctx, story: StoryFacts, uf: UnitFacts, st: UnitState, wf: Workflow): void {
  const ref = uf.unit;
  const { files, broken, done, startable } = sliceProgress(story);
  if (broken.length) return ctx.noop(ref, "slices.file_invalid", `slice file(s) failed validation: ${broken.map((s) => s.file).join(", ")}`);
  const stuck = slicesStuck(story);
  if (stuck) return classifyNorn(ctx, story, uf, st, wf, "stuck", stuck.rule, stuck.detail);
  if (done.size === files.length) return classifyNorn(ctx, story, uf, st, wf, "done", "slices.done", `${done.size} slice(s) integrated`);

  const starts = [];
  for (const s of startable.sort((a, b) => a.nn.localeCompare(b.nn))) {
    const fm = s.frontmatter;
    const name = fm.workflow ?? ctx.config.default_slice_workflow;
    const loaded = usableWorkflow(ctx, name, "slice");
    if ("problem" in loaded) return park(ctx, story, uf, st, "workflow", `slice ${s.key}: ${loaded.problem}`, "slices.workflow_invalid");
    const sliceRef: UnitRef = { story: story.key, slice: s.key, dir: sliceDirName(s.nn, s.slug), key: s.key };
    const storyWt = story.worktree?.path ?? storyWorktreePath(ctx.facts.repo.root, story.key, story.slug);
    const path = sliceWorktreePath(storyWt, s.nn, s.slug);
    const branch = sliceBranch(story.key, s.nn, s.slug);
    const slot = ctx.slot();
    const worktree: WorktreeSpec = { path, branch, from: story.branch, env: ctx.slotEnv(slot), slot };
    const state = initialState({ unit: sliceRef, workflow: loaded.workflow, workflowName: name, workflowHash: sha256(loaded.source), now: ctx.nowIso, tick_id: ctx.facts.tick_id });
    starts.push({
      kind: "start_unit" as const,
      unit: sliceRef,
      rule: "slice.start",
      workflow: name,
      workflow_source: loaded.source,
      worktree,
      slice_status: "active" as const,
      receipts: [],
      state,
      commit: commitFor(ctx, story, null, `norn: start ${s.key} (${name})`, state.step, { path, branch, slice: s.key, push: true }),
    });
  }
  if (starts.length)
    return ctx.emit({ kind: "start_slices", unit: ref, rule: "slices.start", starts });
  ctx.noop(ref, "slices.wait", `${done.size}/${files.length} slices integrated`);
}
