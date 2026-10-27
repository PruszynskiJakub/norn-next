/**
 * decide at story level (claims T1–T10, corrupt S2, remote lifecycle GR6–GR8, mailbox T9) and the
 * per-unit dispatch (receipts C2 → drift S7 → recovery commit → step semantics by type).
 */
import {
  type ClaimBlob,
  parseDuration,
  sliceBranch,
  type StoryFrontmatter,
  type UnitState,
} from "@norn/schema";
import type { ClaimAction, UpdateStoryMirrorAction } from "../actions.ts";
import type { StoryFacts, UnitFacts, UnitRef } from "../facts.ts";
import { sha256 } from "../hash.ts";
import { bodyChangedItem } from "../inbox/items.ts";
import { mergedIntoBase, prBaseBranch, storyFinished, storyUnit } from "../policy.ts";
import type { RemoteIssue } from "../ports.ts";
import { epoch, iso } from "../time.ts";
import { edgeOf, isStale, stepOf } from "../workflow.ts";
import { applyAction, classifyRun, implicitAskResolved, launchUnknown, resolveImplicitAsk, startRun } from "./agent.ts";
import { commitFor, type Ctx, gitBusy, nextReceiptNumber, park, sliceFileOf, unitItem } from "./receipts.ts";
import { baseOf, classifyNorn, resumeSlices, runCheck, runGit, slicesCanResume, slicesStep, startStoryUnit } from "./steps.ts";

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
    if (!ours && !fresh) return ctx.noop(ref, "claim.unclaimed", `unclaimed — norn take ${story.key} (T10)`);
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
    const errors = story.frontmatter_error ? [story.frontmatter_error] : [{ file: `${story.spec_dir}/story.md`, errors: [{ path: "", message: "missing" }] }];
    // S2: a broken story.md is surfaced, never written into the unit's state
    if (!ctx.has(ref.key)) ctx.emit({ kind: "mark_corrupt", unit: ref, rule: "story.corrupt", errors, mark_state: false, notify: null });
    return;
  }
  const fm = story.frontmatter;
  const halted = su?.state?.park?.kind === "remote";

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

/** GR6 merged → cleanup; GR7 closed/unassigned/unlabelled → park "remote: …"; GR8 mirror + body change. */
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
  const st = su?.state;
  const reason = remoteProblem(story, ctx.config.remote.label, ctx.facts.repo.default_branch);
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

/** GR8: the story unit has left a step whose skill is `refine` (cursor elsewhere, or re-entered later). */
function refineFinished(uf: UnitFacts | null): boolean {
  const st = uf?.state;
  const wf = uf?.workflow;
  if (!st || !wf) return false;
  return Object.entries(wf.steps).some(([name, step]) => step.type === "agent" && step.skill === "refine" && ((st.visits[name] ?? 0) >= 2 || ((st.visits[name] ?? 0) >= 1 && st.step !== name)));
}

function remoteProblem(story: StoryFacts, label: string, base: string): string | null {
  if (story.pr?.state === "closed") return "remote: PR closed unmerged";
  // BS11 (old norn 0.1.1): a merge into the wrong base skipped story review — park, never clean up
  if (story.pr?.state === "merged" && !mergedIntoBase(story, base)) return `remote: PR merged into ${prBaseBranch(story.pr)}, not ${base}`;
  const issue = story.issue;
  if (issue === undefined) return null;
  if (issue === null) return "remote: issue closed, unassigned or unlabelled";
  if (issue.state === "closed") return "remote: issue closed";
  if (!issue.labels.includes(label)) return `remote: label '${label}' removed`;
  if (!issue.assignees.length) return "remote: issue unassigned";
  return null;
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
  const atCursor = (u: UnitFacts) => !!u.state && u.state.step === r.step && u.state.attempt === r.attempt && !u.errors.length;
  let target: UnitFacts | undefined;
  if (r.slice !== undefined) {
    // routed by unit when the receipt names one (story unit = null)
    const unit = story.units.find((u) => u.unit.slice === r.slice);
    if (!unit) return reject(`no unit ${r.slice ?? story.key} in story ${story.key}`);
    if (!atCursor(unit)) return reject(`stale: ${unit.unit.key} is not at ${r.step}#${r.attempt}`);
    target = unit;
  } else {
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

export function decideUnit(ctx: Ctx, story: StoryFacts, uf: UnitFacts, halted: boolean): void {
  const ref = uf.unit;
  if (uf.errors.length) {
    if (uf.state?.status === "corrupt") return ctx.noop(ref, "unit.corrupt", "corrupt; never touched (S2)");
    const notify = unitItem(ctx, story, uf, uf.state as UnitState);
    // S2: only the unit's own runs/ files mark its state corrupt, and only a state.json that reads
    const own = uf.errors.every((e) => e.file.includes(`/runs/${ref.dir}/`));
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
  if (!wf) return ctx.emit({ kind: "mark_corrupt", unit: ref, rule: "unit.workflow_missing", errors: [{ file: `runs/${ref.dir}/workflow.yaml`, errors: [{ path: "", message: "pinned workflow missing" }] }], mark_state: false, notify: null });

  // R5.1: a run whose launch is unknown is looked for before anything else is decided for the unit
  if (uf.run?.launch_unknown) return launchUnknown(ctx, story, uf, st, wf);
  // C2: receipts first — they always win over runner facts
  if (uf.unapplied.length) return applyAction(ctx, story, uf, st, wf, uf.unapplied, "receipts.apply");

  // S7: pinned workflow edited outside `norn workflow`, or cursor step gone
  if (st.status !== "stuck" || st.park?.kind !== "workflow") {
    const drift = uf.workflow_hash && uf.workflow_hash !== st.workflow_hash ? "pinned workflow.yaml changed outside norn workflow (S7)" : null;
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
      return ctx.noop(ref, ref.slice ? "slice.done" : "story.wait_merge", ref.slice ? "integrated" : "workflow done; waiting for the PR merge (GR6)");
    case "stuck":
      if (slicesCanResume(story, uf, st, wf)) return resumeSlices(ctx, story, uf, st, wf);
      return ctx.noop(ref, "unit.stuck", `stuck: ${st.park?.reason ?? "?"} — norn unstick ${ref.key}`);
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
