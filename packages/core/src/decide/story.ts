/**
 * decide at story level (claims T1–T10, corrupt S2, remote lifecycle GR6–GR8, mailbox T9) and the
 * per-unit dispatch (receipts C2 → drift S7 → recovery commit → step semantics by type).
 */
import {
  type ClaimBlob,
  parseDuration,
  sliceBranch,
  SPEC_FILE,
  type StoryFrontmatter,
  type UnitState,
  roundRecordPath,
  STORY_UNIT_DIR,
  unitRecordPath,
} from "@norn/schema";
import type { ClaimAction, UpdateStoryMirrorAction } from "../actions.ts";
import type { NumberedReceipt, StoryFacts, UnitFacts, UnitRef } from "../facts.ts";
import { initialState } from "../apply.ts";
import { sha256 } from "../hash.ts";
import { bodyChangedItem } from "../inbox/items.ts";
import { issueProblem, mergedIntoBase, prProblem, roundFinished, storyFinished, storyUnit, WF_LABEL } from "../policy.ts";
import type { RemoteIssue } from "../ports.ts";
import { epoch, iso } from "../time.ts";
import { edgeOf, isStale, stepOf } from "../workflow.ts";
import { applyAction, classifyRun, implicitAskResolved, launchUnknown, resolveImplicitAsk, startRun } from "./agent.ts";
import { commitFor, type Ctx, gitBusy, nextReceiptNumber, park, rebasing, sliceFileOf, unitItem } from "./receipts.ts";
import { baseOf, classifyNorn, recordOf, resumeSlices, runCheck, runGit, slicesCanResume, slicesStep, startStoryUnit, usableWorkflow } from "./steps.ts";
import { cmd } from "../commands.ts";

// ================================================================= story level

/**
 * R3.1 (H6): what the loser of an intake race removes — the story worktree and local branch, when
 * the branch holds nothing beyond the intake commit (`intake_only`, from trailers) and the worktree
 * is clean. Undefined when not observed: act then keeps everything.
 */
function lostIntake(story: StoryFacts): NonNullable<ClaimAction["lost_intake"]> | undefined {
  if (story.intake_only === undefined) return undefined;
  if (!story.intake_only) return { keep: `${story.branch} has commits beyond the intake` };
  const wt = story.worktree?.exists ? story.worktree : null;
  if (wt && !wt.status?.clean) return { keep: `${wt.path} has uncommitted changes` };
  return { drop: { worktree: wt?.path ?? null, branch: story.branch } };
}

/**
 * The slice cleanup deletes the slice branch only when it is in the story branch: its worktree is
 * on it and is integrated first (a conflict stops the cleanup before the delete), or observe saw it
 * there (`branch_in_story`). Returns why it is kept, null to delete it.
 */
function branchKept(uf: UnitFacts, branch: string): string | null {
  if (uf.worktree?.exists && uf.worktree.status?.branch === branch) return null;
  if (uf.branch_in_story === true) return null;
  if (uf.branch_in_story === false) return `${branch} is not in the story branch`;
  return uf.worktree?.exists ? `${uf.worktree.path} is not on ${branch}` : `${branch} not observed in the story branch`;
}

const storyRef = (s: StoryFacts): UnitRef => storyUnit(s)?.unit ?? { story: s.key, slice: null, dir: "_story", key: s.key };

export function decideStory(ctx: Ctx, story: StoryFacts): void {
  const ref = storyRef(story);
  const su = storyUnit(story);
  const claim = story.claim;
  const { facts } = ctx;

  // ---- claims (T1–T6, T10): act only on stories this heartbeat holds
  if (claim.state === "other") return ctx.noop(ref, "claim.other", `held by ${claim.blob.holder} until ${claim.blob.expires_at}`);
  if (claim.state === "corrupt") return ctx.noop(ref, "claim.corrupt", `claim ref ${claim.sha} is unreadable`);
  if (claim.state === "none" || claim.state === "expired") {
    const ours = claim.state === "expired" && claim.blob.heartbeat_id === ctx.heartbeat;
    const fresh = claim.state === "none" && !su?.state && story.frontmatter?.status === "new";
    // R3.2 (H6, A21): the base record wins over any local spec — a story the base records as done
    // (or whose PR merged) is never acquired by a stale local intake or a returning checkout. Only this
    // heartbeat's own expired claim (nobody took it since) is re-acquired for a merged PR whose record
    // is not yet done, so GR6 cleanup and the base record still happen.
    const baseDone = story.base_status === "done" || story.base_status === "dropped";
    if (baseDone || (mergedIntoBase(story, ctx.facts.repo.default_branch) && !ours))
      return ctx.noop(ref, "story.finished", baseDone ? `finished: ${ctx.facts.repo.default_branch} records it ${story.base_status} (R3.2); nothing to acquire` : "finished: PR merged (R3.2); nothing to acquire");
    // GR6: a finished story (workflow done, merged/recorded or dropped) needs no owner — never "unclaimed"
    if (!ours && !fresh && storyFinished(story)) return ctx.noop(ref, "story.finished", `finished (${story.frontmatter?.status === "done" || story.frontmatter?.status === "dropped" ? story.frontmatter.status : "workflow done"}); nothing to take`);
    if (!ours && !fresh) return ctx.noop(ref, "claim.unclaimed", `unclaimed — ${cmd.storyCheckout(story.key)} (T10)`);
    const lost = fresh ? lostIntake(story) : undefined;
    return ctx.emit({
      kind: "claim",
      unit: ref,
      rule: fresh ? "claim.acquire.intake" : "claim.reacquire",
      op: "acquire",
      expected: claim.state === "expired" ? claim.sha : null,
      blob: claimBlob(ctx, story.key, null),
      ...(lost ? { lost_intake: lost } : {}),
    });
  }
  // T4 + R1.1: renewal is a side action — emitted first (act renews before the story's other
  // actions, R1.2), it leaves the story's units their one action this tick (H4, A15)
  const renewAt = epoch(claim.blob.renewed_at) + parseDuration(ctx.config.claim.renew);
  if (facts.now >= renewAt)
    ctx.emit({ kind: "claim", unit: ref, rule: "claim.renew", op: "renew", expected: claim.sha, blob: claimBlob(ctx, story.key, claim.blob) });

  // ---- story file corrupt: never touch anything of the story (S2)
  if (story.frontmatter_error || !story.frontmatter) {
    const errors = story.frontmatter_error ? [story.frontmatter_error] : [{ file: `${story.spec_dir}/${SPEC_FILE}`, errors: [{ path: "", message: "missing" }] }];
    // S2: a broken spec.md is surfaced, never written into the unit's state
    if (!ctx.has(ref.key)) ctx.emit({ kind: "mark_corrupt", unit: ref, rule: "story.corrupt", errors, mark_state: false, notify: null });
    return;
  }
  const fm = story.frontmatter;
  const halted = su?.state?.park?.kind === "remote";

  // gh-71 D7 (B34): a held story whose record is still flat moves into round 1 before anything else —
  // never mid-rebase (H1), and never once its PR merged (the base keeps old records flat, B36)
  if (!ctx.has(ref.key) && su?.state && su.record === unitRecordPath(STORY_UNIT_DIR) && !rebasing(su) && !mergedIntoBase(story, ctx.facts.repo.default_branch)) {
    const commit = commitFor(ctx, story, su, `norn: ${story.key} record moved into round 1`, su.state.step);
    if (commit) {
      const from = `${story.spec_dir}/${unitRecordPath(STORY_UNIT_DIR)}`;
      return ctx.emit({ kind: "round_migrate", unit: ref, rule: "round.migrate", from, to: `${story.spec_dir}/${roundRecordPath(1, su.state.workflow)}`, commit });
    }
  }

  if (!ctx.has(ref.key)) storyLifecycle(ctx, story, fm, su);
  if (!ctx.has(ref.key) && story.mailbox?.length) importMailbox(ctx, story);

  for (const uf of story.units) {
    if (ctx.has(uf.unit.key)) continue;
    decideUnit(ctx, story, uf, halted);
  }
}

function claimBlob(ctx: Ctx, story: string, prev: ClaimBlob | null): ClaimBlob {
  const expires = iso(ctx.facts.now + parseDuration(ctx.config.claim.lease));
  return {
    version: 1,
    story,
    holder: ctx.facts.machine.holder,
    heartbeat_id: ctx.heartbeat,
    acquired_at: prev?.acquired_at ?? ctx.nowIso,
    renewed_at: ctx.nowIso,
    expires_at: expires,
    last_tick_id: ctx.facts.tick_id,
  };
}

/** GR6 merged → cleanup; GR6b issue closed on a finished round → close; GR7 closed/unassigned/unlabelled → park "remote: …" (a finished round: PR only, gh-71 D5); GR8 mirror + body change. */
function storyLifecycle(ctx: Ctx, story: StoryFacts, fm: StoryFrontmatter, su: UnitFacts | null): void {
  const ref = storyRef(story);
  // P2 (F34): merged when the PR says so, or when its head is already on the fetched base;
  // BS11: a PR merged into another branch than the base is not merged (parked below, GR7)
  if (mergedIntoBase(story, ctx.facts.repo.default_branch)) {
    if (fm.status === "done") return;
    const slices = story.slices.filter((s) => s.frontmatter);
    const sliceWts = story.units.filter((u) => u.unit.slice !== null && u.worktree?.exists).map((u) => (u.worktree as { path: string }).path);
    const sliceBranches = slices.map((s) => sliceBranch(story.key, s.nn, s.slug));
    return ctx.emit({
      kind: "cleanup_merged_story",
      unit: ref,
      rule: "remote.pr_merged",
      worktrees: [...(story.worktree?.exists ? [story.worktree.path] : []), ...sliceWts],
      local_branches: [...sliceBranches, story.branch],
      remote_branches: sliceBranches,
      refs: [`refs/norn/claims/${story.key}`, ...(story.mailbox ?? []).map((m) => m.ref)],
      story_status: "done",
    });
  }
  // gh-79 (H1, S5): mid-rebase the story unit's state.json and story.md are a rewound copy; a park or
  // mirror written from them would land in the rebased history. Held with the unit (decideUnit)
  if (su && rebasing(su)) return;
  const st = su?.state;
  const base = ctx.facts.repo.default_branch;
  const prReason = prProblem(story, base);
  // gh-71 D5: a finished round parks only for its PR (GR7); the issue's label, assignee or visibility
  // is a Check item there (inbox), so the round stays finished
  const finished = roundFinished(st);
  // GR6b (gh-71 D5, B22): only an issue seen `closed` (never null/unobserved), a PR seen absent and
  // no unfinished slice close a finished round; an unfinished one parks below (GR7, B24)
  if (finished && !prReason && story.issue?.state === "closed" && story.pr === null && !story.slices.some(sliceUnfinished))
    return ctx.emit({ kind: "close_story", unit: ref, rule: "remote.issue_closed", refs: (story.mailbox ?? []).map((m) => ({ ref: m.ref, sha: m.sha })) });
  const reason = prReason ?? (finished ? null : issueProblem(story, ctx.config.remote.label));
  // gh-71 D5 (B35): an older norn parked a finished round for an issue change — drop that park
  if (finished && st && su && st.status === "stuck" && !prReason) {
    const state: UnitState = { ...st, status: "done", park: null, updated_at: ctx.nowIso, last_tick_id: ctx.facts.tick_id };
    return ctx.emit({
      kind: "mark_done",
      unit: ref,
      rule: "remote.unpark_finished",
      cleanup: { worktree: null, branch_local: null, release_slot: false },
      slice_status: null,
      receipts: [],
      state,
      commit: commitFor(ctx, story, su, `norn: ${story.key} round finished (remote park dropped)`, st.step),
    });
  }
  // GR7: a remote problem parks the story unit through the one park path (stuck, kind remote)
  if (reason && st && st.park?.kind !== "remote" && st.status !== "corrupt") return park(ctx, story, su as UnitFacts, st, "remote", reason, "remote.park");
  const refinedHash = story.issue ? sha256(story.issue.body) : fm.body_hash;
  if (!fm.refined_body_hash && refinedHash && refineFinished(su)) {
    // GR8: record the remote body as of refine finishing, so a later body change surfaces in the inbox
    const fields: UpdateStoryMirrorAction["fields"] = { refined_body_hash: refinedHash };
    if (refinedHash !== fm.body_hash) fields.body_hash = refinedHash;
    return ctx.emit({
      kind: "update_story_mirror",
      unit: ref,
      rule: "remote.mirror.refined",
      fields,
      notify: null,
      commit: commitFor(ctx, story, su, `norn: ${story.key} refine finished (record body hash)`, su?.state?.step ?? null),
    });
  }
  if (story.issue) mirror(ctx, story, fm, su, story.issue);
}

/** gh-71 D3/D5: a slice that is neither integrated nor dropped (an unreadable file counts as unfinished). */
const sliceUnfinished = (s: StoryFacts["slices"][number]): boolean => s.frontmatter?.status !== "integrated" && s.frontmatter?.status !== "dropped";

/** GR8: the story unit has left a step whose skill is `refine` (cursor elsewhere, or re-entered later). */
function refineFinished(uf: UnitFacts | null): boolean {
  const st = uf?.state;
  const wf = uf?.workflow;
  if (!st || !wf) return false;
  return Object.entries(wf.steps).some(([name, step]) => step.type === "agent" && step.skill === "refine" && ((st.visits[name] ?? 0) >= 2 || ((st.visits[name] ?? 0) >= 1 && st.step !== name)));
}

function mirror(ctx: Ctx, story: StoryFacts, fm: StoryFrontmatter, su: UnitFacts | null, issue: RemoteIssue): void {
  const fields: Partial<Pick<StoryFrontmatter, "title" | "assignee" | "url" | "labels" | "body_hash">> = {};
  if (issue.title !== fm.title) fields.title = issue.title;
  if (issue.url !== fm.url) fields.url = issue.url;
  if (!(fm.assignee && issue.assignees.includes(fm.assignee))) {
    const a = issue.assignees[0] ?? null;
    if (a !== fm.assignee) fields.assignee = a;
  }
  const labels = [...issue.labels].sort();
  if (fm.labels && JSON.stringify([...fm.labels].sort()) !== JSON.stringify(labels)) fields.labels = labels;
  const bodyHash = sha256(issue.body);
  if (bodyHash !== fm.body_hash) fields.body_hash = bodyHash;
  if (!Object.keys(fields).length) return;
  const changed = fields.body_hash ? bodyChangedItem({ ...story, frontmatter: { ...fm, body_hash: bodyHash } }) : null;
  const ref = storyRef(story);
  ctx.emit({
    kind: "update_story_mirror",
    unit: ref,
    rule: changed ? "remote.mirror.body_changed" : "remote.mirror",
    fields,
    notify: changed,
    commit: commitFor(ctx, story, su, `norn: mirror ${story.key} from the remote issue`, su?.state?.step ?? null),
  });
}

/** T9: copy one mailbox receipt into the unit whose cursor it matches, or reject it. */
function importMailbox(ctx: Ctx, story: StoryFacts): void {
  const item = (story.mailbox ?? [])[0];
  if (!item) return;
  const ref = storyRef(story);
  const reject = (reason: string) => ctx.emit({ kind: "reject_receipt", unit: ref, rule: "mailbox.reject", source: { ref: item.ref, sha: item.sha }, reason, state: null });
  if (!item.receipt) return reject(item.error ? `invalid receipt: ${item.error.errors.map((e) => e.message).join("; ")}` : "unreadable receipt");
  const r = item.receipt;
  // gh-71 AC12: a receipt made in another round is stale even at the same step#attempt (the same workflow again)
  const otherRound = (u: UnitFacts) => r.round !== undefined && u.unit.slice === null && (u.state?.round ?? 1) !== r.round;
  const atStep = (u: UnitFacts) => !!u.state && u.state.step === r.step && u.state.attempt === r.attempt && !u.errors.length;
  const atCursor = (u: UnitFacts) => atStep(u) && !otherRound(u);
  let target: UnitFacts | undefined;
  if (r.slice !== undefined) {
    // routed by unit when the receipt names one (story unit = null)
    const unit = story.units.find((u) => u.unit.slice === r.slice);
    if (!unit) return reject(`no unit ${r.slice ?? story.key} in story ${story.key}`);
    // gh-79 (H1): its cursor is read from a rewound state.json until the rebase is concluded; wait
    if (rebasing(unit)) return;
    if (atStep(unit) && otherRound(unit)) return reject(`stale: ${unit.unit.key} is in round ${unit.state?.round ?? 1}, the receipt was made in round ${r.round}`);
    if (!atCursor(unit)) return reject(`stale: ${unit.unit.key} is not at ${r.step}#${r.attempt}`);
    target = unit;
  } else {
    if (story.units.some(rebasing)) return;
    const matches = story.units.filter(atCursor);
    target = matches.find((u) => u.state?.status === "parked" || u.state?.status === "stuck") ?? matches[0];
  }
  if (!target || ctx.has(target.unit.key)) return target ? undefined : reject(`no unit at ${r.step}#${r.attempt}`);
  ctx.emit({
    kind: "import_mailbox",
    unit: target.unit,
    rule: "mailbox.import",
    refs: [{ ref: item.ref, sha: item.sha }],
    receipts: [{ n: nextReceiptNumber(target), receipt: r }],
    state: null,
    commit: commitFor(ctx, story, target, `norn: ${target.unit.key} ${r.kind} from mailbox`, r.step),
  });
}

// ================================================================= unit level

function decideUnit(ctx: Ctx, story: StoryFacts, uf: UnitFacts, halted: boolean): void {
  const ref = uf.unit;
  // gh-79 (H1, S2, S5): mid-rebase the unit's runs/ files are a rewound copy, so nothing is decided
  // against them and nothing is written there (a receipt numbered from the rewound state would
  // collide with a committed one once the rebase is aborted); the unit is held until it is concluded.
  // An exception to BS5.1, which still decides liveness and deadlines during a merge, cherry-pick or revert
  if (rebasing(uf)) return ctx.noop(ref, "unit.rebase_in_progress", `rebase in progress in ${uf.worktree?.path}; runs/ rewound — held until it is concluded (H1)`);
  if (uf.errors.length) {
    if (uf.state?.status === "corrupt") return ctx.noop(ref, "unit.corrupt", "corrupt; never touched (S2)");
    const notify = unitItem(ctx, story, uf, uf.state as UnitState);
    // S2: only the unit's own runs/ files mark its state corrupt, and only a state.json that reads
    const own = uf.errors.every((e) => e.file.includes(`/${unitRecordPath(ref.dir)}/`));
    const mark_state = uf.state !== null && own && !uf.errors.some((e) => /(^|\/)state\.json$/.test(e.file));
    return ctx.emit({ kind: "mark_corrupt", unit: ref, rule: "unit.corrupt", errors: uf.errors, mark_state, notify });
  }
  const st = uf.state;
  if (!st) {
    if (ref.slice !== null) return ctx.noop(ref, "slice.not_started", "started by the story's slices step (W2)");
    return startStoryUnit(ctx, story, uf);
  }
  if (st.status === "corrupt") return ctx.noop(ref, "unit.corrupt", "corrupt; never touched (S2)");
  const wf = uf.workflow;
  // S2: a missing pinned workflow is surfaced; the state stays as it is (no file failed validation)
  if (!wf) return ctx.emit({ kind: "mark_corrupt", unit: ref, rule: "unit.workflow_missing", errors: [{ file: `${recordOf(uf)}/workflow.yaml`, errors: [{ path: "", message: "pinned workflow missing" }] }], mark_state: false, notify: null });

  // R5.1: a run whose launch is unknown is looked for before anything else is decided for the unit
  if (uf.run?.launch_unknown) return launchUnknown(ctx, story, uf, st, wf);
  // gh-71 D1: a round receipt is applied alone (round.start), after the receipts before it
  if (ref.slice === null) {
    const ri = uf.unapplied.findIndex((r) => r.receipt.kind === "round");
    if (ri === 0) return roundStart(ctx, story, uf, st, uf.unapplied[0] as NumberedReceipt);
    if (ri > 0) return applyAction(ctx, story, uf, st, wf, uf.unapplied.slice(0, ri), "receipts.apply");
  }
  // C2: receipts first — they always win over runner facts
  if (uf.unapplied.length) return applyAction(ctx, story, uf, st, wf, uf.unapplied, "receipts.apply");

  // S7: pinned workflow edited outside `norn story edit --workflow`, or cursor step gone
  if (st.status !== "stuck" || st.park?.kind !== "workflow") {
    const drift = uf.workflow_hash && uf.workflow_hash !== st.workflow_hash ? "pinned workflow.yaml changed outside norn story edit (S7)" : null;
    const gone = st.step !== "$done" && !stepOf(wf, st.step) ? `step '${st.step}' no longer exists in workflow ${wf.name} (S7)` : null;
    const reason = drift ?? gone;
    if (reason) return park(ctx, story, uf, st, "workflow", reason, "workflow.drift");
  }
  // BS5.1 (H1, dogfood D3): while a git operation is in progress in the worktree (an agent's merge)
  // the owed commit cannot happen — act would only defer it — so it never takes the unit's action:
  // liveness, implicit asks and deadlines are still decided below; the commit follows the merge
  if (uf.uncommitted && !gitBusy(uf)) {
    const commit = commitFor(ctx, story, uf, `norn: ${ref.key} ${st.step} (recovered commit)`, st.step);
    if (commit) return ctx.emit({ kind: "commit_push", unit: ref, rule: "recover.commit", commit });
  }

  switch (st.status) {
    case "done":
      if (ref.slice !== null && sliceFileOf(story, ref.slice)?.frontmatter?.status !== "integrated") {
        const wt = uf.worktree?.exists ? uf.worktree.path : null;
        const file = sliceFileOf(story, ref.slice);
        const branch = file ? sliceBranch(story.key, file.nn, file.slug) : null;
        const kept = branch ? branchKept(uf, branch) : null;
        return ctx.emit({
          kind: "mark_done",
          unit: ref,
          rule: "slice.done.cleanup",
          cleanup: { worktree: wt, branch_local: kept === null ? branch : null, ...(kept ? { branch_kept: kept } : {}), release_slot: true },
          slice_status: "integrated",
          receipts: [],
          state: null,
          commit: null,
        });
      }
      // gh-71 D6 (B25): the story's round is finished; the next round or the PR merge is the person's
      return ctx.noop(ref, ref.slice ? "slice.done" : "story.round_done", ref.slice ? "integrated" : "round done (gh-71 D6)");
    case "stuck":
      if (slicesCanResume(story, uf, st, wf)) return resumeSlices(ctx, story, uf, st, wf);
      return ctx.noop(ref, "unit.stuck", `stuck: ${st.park?.reason ?? "?"} — ${cmd.runRerun(ref.key)}`);
    case "parked": {
      // R6.1 (H3, A14): an implicit ask a later fact shows the agent has moved past resolves itself
      const moved = implicitAskResolved(st, uf);
      if (moved) return resolveImplicitAsk(ctx, story, uf, st, wf, moved);
      // BS6–BS8: a story waiting at a gate with a `stale` route goes back to update when the base moved under it
      if (ref.slice === null && st.park?.kind === "gate" && story.base && edgeOf(wf, st.step, "stale") && isStale(wf, story.base)) {
        const b = story.base;
        const detail = `${b.behind} behind, conflicts: ${b.conflicts.length ? b.conflicts.join(", ") : "none"}`;
        return classifyNorn(ctx, story, uf, st, wf, "stale", "gate.stale", detail, { receiptRule: "base moved", base: baseOf(b) });
      }
      // T6: parked keeps the claim; C3: a restart never answers
      return ctx.noop(ref, `unit.parked.${st.park?.kind ?? "?"}`, st.park?.reason ?? "parked");
    }
  }

  const step = stepOf(wf, st.step);
  if (!step) return ctx.noop(ref, "unit.no_step", st.step);
  if (halted && st.status === "ready") return ctx.noop(ref, "story.halted", "story parked on a remote change (GR7)");
  switch (step.type) {
    case "agent":
      return st.status === "running" ? classifyRun(ctx, story, uf, st, wf, step) : startRun(ctx, story, uf, st, wf, step);
    case "check":
      return runCheck(ctx, story, uf, st, step.run, parseDuration(step.timeout));
    case "git":
      return runGit(ctx, story, uf, st, wf, step);
    case "gate":
      return ctx.noop(ref, "gate.wait", "waiting for approve / reject");
    case "slices":
      return slicesStep(ctx, story, uf, st, wf);
  }
}

// ================================================================= rounds

/**
 * gh-71 D1 (B1, B3, B5, B6, B9, B30): apply a `round` receipt — the old round ends in its own state
 * and round N+1 starts in its own folder with the receipt's workflow pinned, fresh counters, the mode
 * carried over and the cursor at the receipt's step; the receipts after it in the old round are rejected
 * with it (they were made for the round it ends). Rejected into the trace when the cursor moved
 * (T9), the round is not finished, or the workflow is gone; a workflow file changed since the edit
 * leaves a finished round with a `workflow` park that asks for the edit again, and an unfinished (forced)
 * round with its own park (B17).
 */
function roundStart(ctx: Ctx, story: StoryFacts, uf: UnitFacts, st: UnitState, nr: NumberedReceipt): void {
  const r = nr.receipt;
  if (r.kind !== "round") return;
  const moved: UnitState = { ...st, applied_through: nr.n, updated_at: ctx.nowIso, last_tick_id: ctx.facts.tick_id };
  const reject = (reason: string, rule = "round.reject", state: UnitState = moved) => ctx.emit({ kind: "reject_receipt", unit: uf.unit, rule, source: { n: nr.n }, reason, state });
  if (r.step !== st.step || r.attempt !== st.attempt) return reject(`stale: receipt for ${r.step}#${r.attempt}, cursor at ${st.step}#${st.attempt}`);
  if (!r.forced && !roundFinished(st)) return reject(`${story.key}'s ${st.workflow} round is not finished`);
  const loaded = usableWorkflow(ctx, r.workflow, "story");
  if ("problem" in loaded) return reject(loaded.problem);
  if (sha256(loaded.source) !== r.workflow_hash) {
    // gh-71 D1 (B1): the edit judged another workflow file; a finished round stays finished and the inbox asks again
    const again = cmd.storyEdit(story.key, { workflow: r.workflow, at: r.to, force: r.forced });
    const reason = `workflow ${r.workflow} changed since ${again}; run it again`;
    // gh-71 B17 (AC8): an unfinished (forced) round is untouched — its own gate, ask or stuck park stays
    if (!roundFinished(st)) return reject(reason, "round.workflow_changed");
    return reject(reason, "round.workflow_changed", { ...moved, park: { kind: "workflow", reason, since: ctx.nowIso, receipt_id: r.receipt_id, command: again } });
  }
  if (!stepOf(loaded.workflow, r.to)) return reject(`workflow ${r.workflow} has no step '${r.to}'`);
  const n = (st.round ?? 1) + 1;
  // the receipts after the round receipt were made for the round it ends: rejected into the trace, never applied to round N+1
  const after = uf.unapplied.filter((x) => x.n > nr.n);
  const rejected = after.map((x) => ({ n: x.n, receipt_id: x.receipt.receipt_id, reason: `round ${st.round ?? 1} ended at receipt ${nr.n} (round.start); receipt ${x.n} (${x.receipt.kind}) was made for it` }));
  const through = { ...moved, applied_through: after.at(-1)?.n ?? nr.n };
  // gh-71 B32 (D1, RD3): a forced round ends at $done in its own state, recorded as ended by the person at its step
  const at = st.step;
  const ended: UnitState =
    roundFinished(st) || at === "$done"
      ? { ...through, status: "done", park: null }
      : { ...through, step: "$done", status: "done", park: null, run: null, ended: { by: "person", at, receipt_id: r.receipt_id } };
  const mode = st.mode ?? story.mode;
  const state = initialState({ unit: uf.unit, workflow: loaded.workflow, workflowName: r.workflow, workflowHash: r.workflow_hash, now: ctx.nowIso, tick_id: ctx.facts.tick_id, at: r.to, round: n, ...(mode ? { mode } : {}) });
  ctx.emit({
    kind: "round_start",
    unit: uf.unit,
    rule: "round.start",
    receipt_n: nr.n,
    ended,
    rejected,
    round: { n, workflow: r.workflow, dir: `${story.spec_dir}/${roundRecordPath(n, r.workflow)}` },
    workflow_source: loaded.source,
    state,
    commit: commitFor(ctx, story, uf, `norn: ${story.key} round ${n} (${r.workflow}) at ${r.to}`, state.step),
    // gh-71 D9 (B19): the issue label follows the round; it is never read back as a request for one
    label: story.frontmatter && st.workflow !== r.workflow ? { number: story.frontmatter.number, remove: `${WF_LABEL}${st.workflow}`, add: `${WF_LABEL}${r.workflow}` } : null,
  });
}
