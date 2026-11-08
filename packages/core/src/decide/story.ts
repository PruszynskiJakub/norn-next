/**
 * decide at story level (claims, corrupt, remote lifecycle, mailbox) and the per-unit dispatch
 * (receipts → drift → recovery commit → step semantics by type).
 */
import {
  type ClaimBlob,
  parseDuration,
  type Receipt,
  type RejectedMailboxReceipt,
  claimRef,
  isClosedStatus,
  sliceBranch,
  SPEC_FILE,
  type StoryFrontmatter,
  type UnitState,
  roundRunStatePath,
  runStatePath,
  STORY_UNIT_DIR,
  normalRecord,
  treeRunStatePath,
  unitRecordPath,
} from "@norn/schema";
import { type Action, type ClaimAction, NOT_OBSERVED, type UpdateStoryMirrorAction } from "../actions.ts";
import type { NumberedReceipt, StoryFacts, UnitFacts, UnitRef } from "../facts.ts";
import { initialState } from "../apply.ts";
import { sha256 } from "../hash.ts";
import { bodyChangedItem } from "../inbox/items.ts";
import { baseClosed, issueProblem, prProblem, roundFinished, type StoryPhase, stepLabel, storyFinished, storyMerged, storyPhase, storyUnit, WF_LABEL } from "../policy.ts";
import type { RemoteIssue } from "../ports.ts";
import { epoch, iso } from "../time.ts";
import { roundRejected, toCorrupt, toDone } from "../unit-state.ts";
import { edgeOf, isStale, stepOf } from "../workflow.ts";
import { applyAction, classifyRun, implicitAskResolved, launchUnknown, resolveImplicitAsk, startRun } from "./agent.ts";
import { commitFor, type Ctx, gitBusy, nextReceiptNumber, park, rebasing, sliceFileOf, unitBranch, unitItem } from "./receipts.ts";
import { baseOf, classifyNorn, hasFlatRecord, recordOf, resumeSlices, runCheck, runGit, slicesCanResume, slicesStep, startStoryUnit, usableWorkflow } from "./steps.ts";
import { cmd } from "../commands.ts";

/**
 * What the loser of an intake race removes — the story worktree and local branch, when
 * the branch holds nothing beyond the intake commit (`intake_only`, from trailers) and the worktree
 * is clean. Not observed: keep everything.
 */
function lostIntake(story: StoryFacts): NonNullable<ClaimAction["lost_intake"]> {
  if (story.intake_only === undefined) return { keep: NOT_OBSERVED };
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
  const phase = storyPhase(story, facts.repo.default_branch);

  // Claims: act only on stories this heartbeat holds. This checkout's own record of a story another heartbeat holds leaves runs/
  if (story.local_record && (claim.state === "other" || (claim.state === "expired" && claim.blob.heartbeat_id !== ctx.heartbeat))) return setAsideRecord(ctx, story, ref, claim.blob.holder);
  if (claim.state === "other") return ctx.noop(ref, "claim.other", `held by ${claim.blob.holder} until ${claim.blob.expires_at}`);
  if (claim.state === "corrupt") return ctx.noop(ref, "claim.corrupt", `claim ref ${claim.sha} is unreadable`);
  if (claim.state === "none" || claim.state === "expired") {
    const ours = claim.state === "expired" && claim.blob.heartbeat_id === ctx.heartbeat;
    const fresh = claim.state === "none" && !su?.state && story.frontmatter?.status === "new";
    // The base record wins over any local spec — a story the base records as done
    // (or whose PR merged) is never acquired by a stale local intake or a returning checkout. Only this
    // heartbeat's own expired claim (nobody took it since) is re-acquired for a merged PR whose record
    // is not yet done, so the merge cleanup and the base record still happen.
    const baseDone = baseClosed(story);
    if (baseDone || (storyMerged(phase) && !ours))
      return ctx.noop(ref, "story.finished", baseDone ? `finished: ${ctx.facts.repo.default_branch} records it ${story.base_status}; nothing to acquire` : "finished: PR merged; nothing to acquire");
    // A finished story (workflow done, merged/recorded or dropped) needs no owner — never "unclaimed"
    if (!ours && !fresh && storyFinished(phase)) return ctx.noop(ref, "story.finished", `finished (${isClosedStatus(story.frontmatter?.status) ? story.frontmatter.status : "workflow done"}); nothing to take`);
    if (!ours && !fresh) return ctx.noop(ref, "claim.unclaimed", `unclaimed — ${cmd.storyCheckout(story.key)}`);
    return ctx.emit({
      kind: "claim",
      unit: ref,
      rule: fresh ? "claim.acquire.intake" : "claim.reacquire",
      op: "acquire",
      expected: claim.state === "expired" ? claim.sha : null,
      blob: claimBlob(ctx, story.key, null),
      ...(fresh ? { lost_intake: lostIntake(story) } : {}),
    });
  }
  // Renewal is a side action, emitted first (act renews before the story's other actions); it
  // leaves the story's units their one action this tick
  const renewAt = epoch(claim.blob.renewed_at) + parseDuration(ctx.config.claim.renew);
  if (facts.now >= renewAt)
    ctx.emit({ kind: "claim", unit: ref, rule: "claim.renew", op: "renew", expected: claim.sha, blob: claimBlob(ctx, story.key, claim.blob) });

  if (story.record_only) {
    recordOnly(ctx, story, ref);
    // a story held from its record alone still owes its record under `remote`
    return pushRecord(ctx, story, ref);
  }

  // story file corrupt: never touch anything of the story
  if (story.frontmatter_error || !story.frontmatter) {
    const errors = story.frontmatter_error ? [story.frontmatter_error] : [{ file: `${story.spec_dir}/${SPEC_FILE}`, errors: [{ path: "", message: "missing" }] }];
    // A broken spec.md is surfaced, never written into the unit's state
    if (!ctx.has(ref.key)) ctx.emit({ kind: "mark_corrupt", unit: ref, rule: "story.corrupt", errors, state: null, notify: null });
    return;
  }
  const fm = story.frontmatter;
  const halted = su?.state?.park?.kind === "remote";

  moveRecords(ctx, story);

  // A held story whose record is still flat moves into round 1 before anything else —
  // never mid-rebase, and never once its PR merged (the base keeps old records flat)
  if (!ctx.has(ref.key) && su?.state && hasFlatRecord(su) && !rebasing(su) && !storyMerged(phase)) {
    const from = runStatePath(story, STORY_UNIT_DIR);
    return ctx.emit({ kind: "round_migrate", unit: ref, rule: "round.migrate", from, to: roundRunStatePath(story, 1, su.state.workflow) });
  }

  retitlePr(ctx, story, ref);
  if (!ctx.has(ref.key)) storyLifecycle(ctx, story, fm, su, phase);
  if (!ctx.has(ref.key) && story.mailbox?.length) importMailbox(ctx, story);

  for (const uf of story.units) {
    if (ctx.has(uf.unit.key)) continue;
    decideUnit(ctx, story, uf, halted);
  }
  pushRecord(ctx, story, ref);
}

/**
 * A local record whose tree this machine pushed to the story's ref went there with
 * a clean release: removed quietly. Any other was superseded by a takeover without a release: set
 * aside under `superseded/<story>-<ulid>/`, never pushed, never merged, one Check item.
 */
function setAsideRecord(ctx: Ctx, story: StoryFacts, ref: UnitRef, holder: string): void {
  const local = story.local_record;
  if (!local) return;
  if (local.on_ref) return ctx.emit({ kind: "set_aside_record", unit: ref, rule: "record.released", superseded: null });
  ctx.emit({ kind: "set_aside_record", unit: ref, rule: "record.superseded", superseded: { name: `${story.key}-${ctx.id()}`, holder, last_receipt: local.last_receipt } });
}

/**
 * A story held here with its record in the machine dir and no branch (taken
 * over from its record alone) goes on from that record: its claim is renewed above, its story unit's
 * receipts applied (the take among them), never intaken again. Nothing runs in it until it has a
 * branch to work on: no worktree, no session. Under `remote` its record is pushed as any held story's
 * (`pushRecord`, without a `Norn-Branch-Commit`).
 */
function recordOnly(ctx: Ctx, story: StoryFacts, ref: UnitRef): void {
  if (ctx.has(ref.key)) return;
  const su = storyUnit(story);
  const st = su?.state;
  if (su && st && su.workflow && st.status !== "corrupt" && !su.errors.length && su.unapplied.length) return applyAction(ctx, story, su, st, su.workflow, su.unapplied, "receipts.apply");
  return ctx.noop(ref, "story.record_only", `held here from its record; ${story.key} has no branch, so nothing runs until it has one`);
}

/**
 * Under `record.policy: remote` (read at every tick), the holder
 * pushes the story's record once its tree differs from the one on the record ref it last saw, after
 * the tick's branch pushes (a side action act performs last). A push that failed leaves the tree
 * different, so the next tick pushes again. A move off the branch this tick brings the
 * record into the machine dir as it acts, so the push rides along with it. Under `local`, nothing.
 * An action of this tick that pushes the record itself leaves no second push beside it: a story
 * cleaned up this tick is archived by that action, and an `open-pr` pushes the
 * record before the PR. A push refused as stale (another checkout pushed the ref)
 * waits until the record ref this checkout sees is another one, rather than failing again every tick.
 */
function pushRecord(ctx: Ctx, story: StoryFacts, ref: UnitRef): void {
  if ((ctx.config.record?.policy ?? "local") !== "remote" || !story.record) return;
  const { tree, pushed } = story.record;
  const moved = ctx.decisions.some((d) => d.action.kind === "move_record" && d.action.unit?.story === story.key);
  if (!moved && (tree === null || tree === pushed?.tree)) return;
  if (ctx.decisions.some((d) => d.action.unit?.story === story.key && pushesRecordItself(d.action))) return;
  const refused = story.record_refused;
  if (refused && (refused.lease ?? null) === (pushed?.sha ?? null)) return;
  ctx.emit({ kind: "push_record", unit: ref, rule: "record.push", branch: story.branch, expected: pushed?.sha ?? null, holder: ctx.facts.machine.holder });
}

/** An action that pushes the story's record itself: the archive at merge or close, or `open-pr`. */
const pushesRecordItself = (a: Action): boolean =>
  a.kind === "cleanup_merged_story" || a.kind === "close_story" || (a.kind === "run_git" && a.action === "open-pr");

/**
 * Run state an older norn left on a held unit's branch moves into the machine dir
 * before anything else is decided for the units it holds, one `move_record` per branch (the story's,
 * each slice's): the units read from there were read from the branch, so nothing else may act on them
 * this tick. A record whose files fail validation is not moved: the unit is marked corrupt and its
 * branch keeps its runs/. Never mid-merge or mid-rebase: the removal would land in that commit.
 */
function moveRecords(ctx: Ctx, story: StoryFacts): void {
  for (const uf of story.units) {
    const br = uf.branch_record;
    if (!br || ctx.has(uf.unit.key)) continue;
    const moving = br.copy.map((dir) => story.units.find((u) => u.unit.dir === dir)).filter((u): u is UnitFacts => !!u && u.unit.key !== uf.unit.key && !ctx.has(u.unit.key));
    const busy = uf.worktree?.in_progress?.operation ?? (uf.worktree?.in_progress?.unmerged.length ? "a merge" : null);
    const wait = (why: string) => {
      for (const u of [uf, ...moving]) if (!u.errors.length && !ctx.has(u.unit.key)) ctx.noop(u.unit, "record.move_waits", why);
    };
    if (busy) {
      wait(`${busy} in progress in ${uf.worktree?.path}: the run state on ${unitBranch(story, uf)} moves once it is concluded`);
      continue;
    }
    // decideUnit marks each broken unit corrupt; nothing moves off this branch while a unit with a
    // folder on it is broken, even one read from elsewhere (its copy here may be the good one)
    const bad = story.units.filter((u) => br.holds.includes(u.unit.dir) && u.errors.length);
    if (bad.length) {
      wait(`${bad.map((u) => u.unit.key).join(", ")} failed validation on ${unitBranch(story, uf)}: nothing moves`);
      continue;
    }
    const copy = br.copy.map((dir) => {
      const u = story.units.find((x) => x.unit.dir === dir);
      // A flat story record lands in round 1 of its workflow
      const flat = u?.state && hasFlatRecord(u) ? u.state : null;
      return { unit: dir, from: treeRunStatePath(story, dir), to: flat ? roundRunStatePath(story, 1, flat.workflow) : runStatePath(story, dir) };
    });
    const commit = commitFor(ctx, story, uf, `norn: move ${uf.unit.key} run state off the branch`, uf.state?.step ?? null);
    if (!commit) continue;
    ctx.emit({ kind: "move_record", unit: uf.unit, rule: "record.move", path: br.path, copy, commit });
    for (const u of moving) ctx.noop(u.unit, "record.move", `moving with ${uf.unit.key} off ${commit.branch}`);
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

/**
 * A merged PR is the story's final outcome, so every unit not yet done is recorded done at `$done`
 * with the cleanup: a gate, ask or stuck still open at merge time is moot and leaves nothing in the
 * inbox, and `story wait --until done` returns. The merge ends the round wherever it stood, so the
 * next round starts unforced; visits, last_outcome and the trace keep the step that was left.
 * A unit whose files failed validation stays as it is.
 */
function finishMerged(ctx: Ctx, story: StoryFacts): Array<{ unit: UnitRef; state: UnitState }> {
  const out: Array<{ unit: UnitRef; state: UnitState }> = [];
  for (const u of story.units) {
    const st = u.state;
    if (!st || u.errors.length || st.status === "done") continue;
    out.push({ unit: u.unit, state: { ...toDone(st), updated_at: ctx.nowIso, last_tick_id: ctx.facts.tick_id } });
  }
  return out;
}

/** Merged → cleanup; issue closed on a finished round → close; closed/unassigned/unlabelled → park "remote: …" (a finished round: PR only); mirror + body change. */
function storyLifecycle(ctx: Ctx, story: StoryFacts, fm: StoryFrontmatter, su: UnitFacts | null, phase: StoryPhase): void {
  const ref = storyRef(story);
  // Merged when the PR says so, or when its head is already on the fetched base;
  // a PR merged into another branch than the base is not merged (parked below)
  if (phase.phase === "landed" && phase.merged) return;
  if (phase.phase === "merged") {
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
      refs: [claimRef(story.key), ...(story.mailbox ?? []).map((m) => m.ref)],
      story_status: "done",
      finish: finishMerged(ctx, story),
    });
  }
  // Mid-rebase the story unit's state.json and story.md are a rewound copy; a park or
  // mirror written from them would land in the rebased history. Held with the unit (decideUnit)
  if (su && rebasing(su)) return;
  const st = su?.state;
  const base = ctx.facts.repo.default_branch;
  const prReason = prProblem(story, base);
  // A finished round parks only for its PR; the issue's label, assignee or visibility
  // is a Check item there (inbox), so the round stays finished
  const finished = roundFinished(st);
  // Only an issue seen `closed` (never null/unobserved), a PR seen absent and
  // no unfinished slice close a finished round; an unfinished one parks below
  if (finished && !prReason && story.issue?.state === "closed" && story.pr === null && !story.slices.some(sliceUnfinished))
    return ctx.emit({ kind: "close_story", unit: ref, rule: "remote.issue_closed", refs: (story.mailbox ?? []).map((m) => ({ ref: m.ref, sha: m.sha })) });
  const reason = prReason ?? (finished ? null : issueProblem(story, ctx.config.label));
  // An older norn parked a finished round for an issue change — drop that park
  if (finished && st && su && st.status === "stuck" && !prReason) {
    const state: UnitState = { ...toDone(st), updated_at: ctx.nowIso, last_tick_id: ctx.facts.tick_id };
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
  // A remote problem parks the story unit through the one park path (stuck, kind remote)
  if (reason && st && st.park?.kind !== "remote" && st.status !== "corrupt") return park(ctx, story, su as UnitFacts, st, "remote", reason, "remote.park");
  const refinedHash = story.issue ? sha256(story.issue.body) : fm.body_hash;
  if (!fm.refined_body_hash && refinedHash && refineFinished(su)) {
    // Record the remote body as of refine finishing, so a later body change surfaces in the inbox
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

/**
 * An open PR takes the issue's title. The PR is observed only on a sync tick, with the issue,
 * so the issue's title is compared, not the mirror, which that same tick may still be updating.
 */
function retitlePr(ctx: Ctx, story: StoryFacts, ref: UnitRef): void {
  const pr = story.pr;
  const title = story.issue?.title;
  if (pr?.state !== "open" || pr.title === undefined || !title || pr.title === title) return;
  ctx.emit({ kind: "retitle_pr", unit: ref, rule: "remote.pr_title", number: pr.number, title });
}

/** A slice that is neither integrated nor dropped (an unreadable file counts as unfinished). */
const sliceUnfinished = (s: StoryFacts["slices"][number]): boolean => s.frontmatter?.status !== "integrated" && s.frontmatter?.status !== "dropped";

/** A refine step's skill, under the bundled name every shipped workflow uses (`norn-refine`) or the bare one. */
const REFINE_SKILLS = new Set(["refine", "norn-refine"]);

/** The story unit has left a refine step (cursor elsewhere, or re-entered later). */
function refineFinished(uf: UnitFacts | null): boolean {
  const st = uf?.state;
  const wf = uf?.workflow;
  if (!st || !wf) return false;
  return Object.entries(wf.steps).some(([name, step]) => step.type === "agent" && REFINE_SKILLS.has(step.skill) && ((st.visits[name] ?? 0) >= 2 || ((st.visits[name] ?? 0) >= 1 && st.step !== name)));
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

/** Copy one mailbox receipt into the unit whose cursor it matches, or reject it. */
function importMailbox(ctx: Ctx, story: StoryFacts): void {
  const item = (story.mailbox ?? [])[0];
  if (!item) return;
  const ref = storyRef(story);
  const r = item.receipt;
  const reject = (reason: string) =>
    ctx.emit({ kind: "reject_receipt", unit: ref, rule: "mailbox.reject", source: { ref: item.ref, sha: item.sha }, reason, state: null, ...(r ? { keep: keptRejection(ctx, story, r, reason) } : {}) });
  if (!r) return reject(item.error ? `invalid receipt: ${item.error.errors.map((e) => e.message).join("; ")}` : "unreadable receipt");
  // A receipt made in another round is stale even at the same step#attempt (the same workflow again)
  const otherRound = (u: UnitFacts) => r.round !== undefined && u.unit.slice === null && (u.state?.round ?? 1) !== r.round;
  // A receipt without an attempt (a non-holder's, for a `local` story) matches by step alone
  const atStep = (u: UnitFacts) => !!u.state && u.state.step === r.step && (r.attempt === undefined || u.state.attempt === r.attempt) && !u.errors.length;
  const at = stepLabel(r.step, r.attempt);
  const atCursor = (u: UnitFacts) => atStep(u) && !otherRound(u);
  let target: UnitFacts | undefined;
  if (r.slice !== undefined) {
    // routed by unit when the receipt names one (story unit = null)
    const unit = story.units.find((u) => u.unit.slice === r.slice);
    if (!unit) return reject(`no unit ${r.slice ?? story.key} in story ${story.key}`);
    // Its cursor is read from a rewound state.json until the rebase is concluded; wait
    if (rebasing(unit)) return;
    if (atStep(unit) && otherRound(unit)) return reject(`stale: ${unit.unit.key} is in round ${unit.state?.round ?? 1}, the receipt was made in round ${r.round}`);
    if (!atCursor(unit)) return reject(`stale: ${unit.unit.key} is not at ${at}`);
    target = unit;
  } else {
    if (story.units.some(rebasing)) return;
    const matches = story.units.filter(atCursor);
    target = matches.find((u) => u.state?.status === "parked" || u.state?.status === "stuck") ?? matches[0];
  }
  if (!target || ctx.has(target.unit.key)) return target ? undefined : reject(`no unit at ${at}`);
  ctx.emit({
    kind: "import_mailbox",
    unit: target.unit,
    rule: "mailbox.import",
    refs: [{ ref: item.ref, sha: item.sha }],
    // a step-only receipt is copied with the attempt it matched, so the unit's receipts are all stamped
    receipts: [{ n: nextReceiptNumber(target), receipt: r.attempt === undefined && target.state ? { ...r, attempt: target.state.attempt } : r }],
    state: null,
    commit: commitFor(ctx, story, target, `norn: ${target.unit.key} ${r.kind} from mailbox`, r.step),
  });
}

/**
 * What the holder keeps of a mailbox receipt it rejects, for its Check item — who sent
 * what for which step, the step the unit is at, and each unit's last receipt number now, so only an
 * answer or approval numbered past it clears the item (the holder's own order, never the sender's clock).
 */
function keptRejection(ctx: Ctx, story: StoryFacts, r: Receipt, reason: string): RejectedMailboxReceipt {
  const unit = story.units.find((u) => (r.slice === undefined ? u.unit.slice === null : u.unit.slice === r.slice));
  return {
    story: story.key,
    unit: r.slice ?? story.key,
    receipt_id: r.receipt_id,
    kind: r.kind,
    who: r.who ?? null,
    step: r.step,
    ...(r.attempt !== undefined ? { attempt: r.attempt } : {}),
    at_step: unit?.state?.step ?? null,
    reason,
    rejected_at: ctx.nowIso,
    // what the holder has applied, never a receipt still waiting to be (it may be the answer that clears this)
    seen: Object.fromEntries(story.units.map((u) => [u.unit.key, u.state?.applied_through ?? 0])),
  };
}

function decideUnit(ctx: Ctx, story: StoryFacts, uf: UnitFacts, halted: boolean): void {
  const ref = uf.unit;
  // Mid-rebase the unit's runs/ files are a rewound copy, so nothing is decided
  // against them and nothing is written there (a receipt numbered from the rewound state would
  // collide with a committed one once the rebase is aborted); the unit is held until it is concluded.
  // (A merge, cherry-pick or revert in progress still lets liveness and deadlines be decided.)
  if (rebasing(uf)) return ctx.noop(ref, "unit.rebase_in_progress", `rebase in progress in ${uf.worktree?.path} — held until it is concluded`);
  if (uf.errors.length) {
    if (uf.state?.status === "corrupt") return ctx.noop(ref, "unit.corrupt", "corrupt; never touched");
    const notify = unitItem(ctx, story, uf, uf.state as UnitState);
    // Only the unit's own runs/ files mark its state corrupt, and only a state.json that reads —
    // never one read from an older norn's branch: nothing is written there
    const own = uf.errors.every((e) => e.file.includes(`/${unitRecordPath(ref.dir)}/`));
    const onBranch = story.units.some((u) => u.branch_record?.copy.includes(ref.dir));
    const marked = uf.state !== null && own && !onBranch && !uf.errors.some((e) => /(^|\/)state\.json$/.test(e.file));
    const reason = `corrupt: ${uf.errors.map((e) => e.file).join(", ")} failed validation`;
    const state: UnitState | null = marked
      ? { ...toCorrupt(uf.state!, reason, ctx.nowIso), updated_at: ctx.nowIso, last_tick_id: ctx.facts.tick_id }
      : null;
    return ctx.emit({ kind: "mark_corrupt", unit: ref, rule: "unit.corrupt", errors: uf.errors, state, notify });
  }
  const st = uf.state;
  if (!st) {
    if (ref.slice !== null) return ctx.noop(ref, "slice.not_started", "started by the story's slices step");
    // The story's record is on its ref here but not in the machine dir (a checkout cut
    // short): never start it over, the checkout puts it in place
    if (story.record_unplaced)
      return ctx.noop(ref, "start.record_unplaced", `${story.key}'s record (${story.record_unplaced}) is not in place here; never started over — run ${cmd.storyCheckout(story.key)}`);
    return startStoryUnit(ctx, story, uf);
  }
  if (st.status === "corrupt") return ctx.noop(ref, "unit.corrupt", "corrupt; never touched");
  const wf = uf.workflow;
  // A missing pinned workflow is surfaced; the state stays as it is (no file failed validation)
  if (!wf) return ctx.emit({ kind: "mark_corrupt", unit: ref, rule: "unit.workflow_missing", errors: [{ file: `${recordOf(uf)}/workflow.yaml`, errors: [{ path: "", message: "pinned workflow missing" }] }], state: null, notify: null });

  // A run whose launch is unknown is looked for before anything else is decided for the unit
  if (uf.run?.launch_unknown) return launchUnknown(ctx, story, uf, st, wf);
  // A round receipt is applied alone (round.start), after the receipts before it
  if (ref.slice === null) {
    const ri = uf.unapplied.findIndex((r) => r.receipt.kind === "round");
    if (ri === 0) return roundStart(ctx, story, uf, st, uf.unapplied[0] as NumberedReceipt);
    if (ri > 0) return applyAction(ctx, story, uf, st, wf, uf.unapplied.slice(0, ri), "receipts.apply");
  }
  // Receipts first — they always win over runner facts
  if (uf.unapplied.length) return applyAction(ctx, story, uf, st, wf, uf.unapplied, "receipts.apply");

  // Pinned workflow edited outside `norn story edit --workflow`, or cursor step gone
  if (st.status !== "stuck" || st.park?.kind !== "workflow") {
    const drift = uf.workflow_hash && uf.workflow_hash !== st.workflow_hash ? "pinned workflow.yaml changed outside norn story edit" : null;
    const gone = st.step !== "$done" && !stepOf(wf, st.step) ? `step '${st.step}' no longer exists in workflow ${wf.name}` : null;
    const reason = drift ?? gone;
    if (reason) return park(ctx, story, uf, st, "workflow", reason, "workflow.drift");
  }
  // While a git operation is in progress in the worktree (an agent's merge)
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
      // The story's round is finished; the next round or the PR merge is the person's
      return ctx.noop(ref, ref.slice ? "slice.done" : "story.round_done", ref.slice ? "integrated" : "round done");
    case "stuck":
      if (slicesCanResume(story, uf, st, wf)) return resumeSlices(ctx, story, uf, st, wf);
      return ctx.noop(ref, "unit.stuck", `stuck: ${st.park.reason} — ${cmd.runRerun(ref.key)}`);
    case "parked": {
      // An implicit ask a later fact shows the agent has moved past resolves itself
      const moved = implicitAskResolved(st, uf);
      if (moved) return resolveImplicitAsk(ctx, story, uf, st, wf, moved);
      // A story waiting at a gate with a `stale` route goes back to update when the base moved under it
      if (ref.slice === null && st.park.kind === "gate" && story.base && edgeOf(wf, st.step, "stale") && isStale(wf, story.base)) {
        const b = story.base;
        const detail = `${b.behind} behind, conflicts: ${b.conflicts.length ? b.conflicts.join(", ") : "none"}`;
        return classifyNorn(ctx, story, uf, st, wf, "stale", "gate.stale", detail, { receiptRule: "base moved", base: baseOf(b) });
      }
      // Parked keeps the claim; a restart never answers
      return ctx.noop(ref, `unit.parked.${st.park.kind}`, st.park.reason);
    }
  }

  const step = stepOf(wf, st.step);
  if (!step) return ctx.noop(ref, "unit.no_step", st.step);
  if (halted && st.status === "ready") return ctx.noop(ref, "story.halted", "story parked on a remote change");
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

/**
 * Apply a `round` receipt: the old round ends in its own state and round N+1 starts in its own
 * folder with the receipt's workflow pinned, fresh counters, the mode carried over and the cursor at
 * the receipt's step; the receipts after it in the old round are rejected with it. Rejected into the
 * trace when the cursor moved, the round is not finished, or the workflow is gone; a workflow file
 * changed since the edit leaves a finished round with a `workflow` park that asks for the edit
 * again, and an unfinished (forced) round with its own park.
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
    // The edit judged another workflow file; a finished round stays finished and the inbox asks again
    const again = cmd.storyEdit(story.key, { workflow: r.workflow, at: r.to, force: r.forced });
    const reason = `workflow ${r.workflow} changed since ${again}; run it again`;
    // An unfinished (forced) round is untouched — its own gate, ask or stuck park stays
    if (!roundFinished(moved)) return reject(reason, "round.workflow_changed");
    return reject(reason, "round.workflow_changed", roundRejected(moved, { kind: "workflow", reason, since: ctx.nowIso, receipt_id: r.receipt_id, command: again }));
  }
  if (!stepOf(loaded.workflow, r.to)) return reject(`workflow ${r.workflow} has no step '${r.to}'`);
  const n = (st.round ?? 1) + 1;
  // the receipts after the round receipt were made for the round it ends: rejected into the trace, never applied to round N+1
  const after = uf.unapplied.filter((x) => x.n > nr.n);
  const rejected = after.map((x) => ({ n: x.n, receipt_id: x.receipt.receipt_id, reason: `round ${st.round ?? 1} ended at receipt ${nr.n} (round.start); receipt ${x.n} (${x.receipt.kind}) was made for it` }));
  const through = { ...moved, applied_through: after.at(-1)?.n ?? nr.n };
  // A forced round ends at $done in its own state, recorded as ended by the person at its step
  const at = st.step;
  const ended: UnitState =
    roundFinished(st) || at === "$done" ? toDone(through) : { ...toDone(through), ended: { by: "person", at, receipt_id: r.receipt_id } };
  const mode = st.mode ?? story.mode;
  const state = initialState({ unit: uf.unit, workflow: loaded.workflow, workflowName: r.workflow, workflowHash: r.workflow_hash, now: ctx.nowIso, tick_id: ctx.facts.tick_id, at: r.to, round: n, ...(mode ? { mode } : {}) });
  ctx.emit({
    kind: "round_start",
    unit: uf.unit,
    rule: "round.start",
    receipt_n: nr.n,
    ended,
    rejected,
    round: { n, workflow: r.workflow, dir: roundRunStatePath(story, n, r.workflow) },
    workflow_source: loaded.source,
    state,
    commit: commitFor(ctx, story, uf, `norn: ${story.key} round ${n} (${r.workflow}) at ${r.to}`, state.step),
    // The issue label follows the round; it is never read back as a request for one
    label: story.frontmatter && st.workflow !== r.workflow ? { number: story.frontmatter.number, remove: `${WF_LABEL}${st.workflow}`, add: `${WF_LABEL}${r.workflow}` } : null,
  });
}
