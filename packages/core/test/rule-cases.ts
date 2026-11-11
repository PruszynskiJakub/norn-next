/**
 * Hand-built decide cases for the rule ids no golden case reaches (refactor Phase 0.1). Each case
 * is a whole decide input and the rule it must fire; `golden.test.ts` runs them and counts them
 * toward rule coverage. Built from `fixtures.ts`.
 */
import type { LeaseFile, ResolvedConfig, UnitState, UnitStateRecord, Workflow } from "@norn/schema";
import type { RepoWorkflows } from "../src/decide/index.ts";
import type { Facts, RunFacts, StoryFacts, UnitFacts } from "../src/facts.ts";
import { sha256 } from "../src/hash.ts";
import { at, CONFIG, facts, loaded, numbered, receipt, SLICE_WF, sliceFile, sliceUnit, SOLO_WF, STORY_WF, stateFor, storyFacts, storyUnit, T0, unitFacts, WORKFLOWS, worktree } from "./fixtures.ts";

export interface RuleCase {
  name: string;
  rule: string;
  facts: Facts;
  workflows: RepoWorkflows;
  config: ResolvedConfig;
}

const RUN = "01JDDDDDDDDDDDDDDDDDDDDDDD";
const OTHER_RUN = "01JEEEEEEEEEEEEEEEEEEEEEEE";
const STORY_WT = "/r-worktrees/gh-1-login";
const MIN = 60_000;
const HOUR = 60 * MIN;

/** Extra workflows: git push / update steps, and a declared `stalled` route (OVERRIDABLE_ROUTES). */
const GIT_WF: Workflow = {
  name: "gitty",
  start: "push",
  steps: {
    push: { type: "git", action: "push", outcomes: { done: "update" } },
    update: { type: "git", action: "update", outcomes: { done: "$done", conflict: "$stuck" } },
  },
};
const ROUTED_WF: Workflow = {
  name: "routed",
  start: "implement",
  steps: {
    implement: { type: "agent", skill: "implement", outcomes: { done: "$done", stalled: "review" } },
    review: { type: "agent", skill: "review", outcomes: { approve: "$done" } },
  },
};
/** A gate with a `stale` route, stale when merely behind (as `release` is). */
const STALE_WF: Workflow = {
  name: "staled",
  start: "ready",
  steps: {
    update: { type: "git", action: "update", outcomes: { done: "ready", conflict: "$stuck" } },
    ready: { type: "gate", outcomes: { approve: "$done", reject: "$stuck", stale: { to: "update", counter: "stale_loop" } } },
  },
  counters: { stale_loop: { max: 3 } },
  base: { stale: "behind" },
};
const MERGE_WF: Workflow = {
  ...STALE_WF,
  name: "merging",
  steps: { ...STALE_WF.steps, ready: { type: "gate", outcomes: { approve: "merge", reject: "$stuck" } }, merge: { type: "merge", outcomes: { stale: { to: "update", counter: "stale_loop" } } } },
};
const ALL: RepoWorkflows = { ...WORKFLOWS, gitty: loaded(GIT_WF), routed: loaded(ROUTED_WF), staled: loaded(STALE_WF), merging: loaded(MERGE_WF) };

const agentLease = (run_id: string | null = null): LeaseFile => ({ version: 1, kind: "agent", repo: "/x", story: "gh-9", slice: null, run_id, holder: { pid: 1, pid_start: "1" }, created_at: at() });
const checkLease = (): LeaseFile => ({ version: 1, kind: "check", repo: "/x", story: "gh-9", slice: null, run_id: null, holder: { pid: 1, pid_start: "1" }, created_at: at() });

/**
 * The story unit of `gh-1` on `wf`, its state patched, with a live run's facts when `run` is given.
 * Its refine is recorded as finished, so a cursor past refine does not mirror first.
 */
function story(wf: Workflow, patch: Partial<UnitStateRecord> = {}, run: Partial<RunFacts> | null = null, sf: Partial<StoryFacts> = {}, uf: Partial<UnitFacts> = {}): StoryFacts {
  const unit = storyUnit();
  const st = stateFor(unit, wf, patch);
  const rf: RunFacts | null = run && { run_id: RUN, session: { runner: "herdr", session_id: "s1" }, process_alive: true, pane: null, hooks: [], last_hook_at: null, last_activity_at: T0, transcript: "/t.jsonl", ...run };
  const base = storyFacts("gh-1", []);
  return storyFacts("gh-1", [unitFacts(unit, wf, st, { run: rf, worktree: worktree(STORY_WT), ...uf })], { frontmatter: { ...base.frontmatter!, workflow: wf.name, refined_body_hash: sha256("body") }, ...sf });
}

/** A running agent run of the cursor step, started `ago` ms before T0. */
function running(step: string, ago = MIN, p: Partial<UnitStateRecord> = {}): Partial<UnitStateRecord> {
  return {
    status: "running",
    park: null,
    step,
    run: { run_id: RUN, step, attempt: 1, started_at: at(T0 - ago), how: "auto", session: { runner: "herdr", session_id: "s1" } },
    updated_at: at(T0 - ago),
    ...p,
  };
}

/** A hook fact for the run `ago` ms before T0. */
const hook = (event: RunFacts["hooks"][number]["event"], ago = 1000) => ({ event, at: at(T0 - ago), agent: "claude", native: event, cwd: STORY_WT }) as RunFacts["hooks"][number];

const ready = (step: string, p: Partial<UnitStateRecord> = {}): Partial<UnitStateRecord> => ({ status: "ready", park: null, step, ...p });
const noWorktree: Partial<UnitFacts> = { worktree: { ...worktree(STORY_WT), exists: false } };
const config = (p: Partial<ResolvedConfig> = {}): ResolvedConfig => ({ ...CONFIG, ...p });
const machine = (p: Partial<Facts["machine"]>): Partial<Facts> => ({ machine: { ...facts([]).machine, ...p } });

/** A story at its slices step with the given slice files and slice units. */
function atSlices(files: StoryFacts["slices"], slices: UnitFacts[] = [], p: Partial<UnitStateRecord> = {}): StoryFacts {
  const s = story(STORY_WF, ready("slices", p));
  return { ...s, slices: files, units: [...s.units, ...slices] };
}
function sliceAt(nn: string, slug: string, patch: Partial<UnitStateRecord>, uf: Partial<UnitFacts> = {}): UnitFacts {
  const unit = sliceUnit("gh-1", nn, slug);
  return unitFacts(unit, SLICE_WF, stateFor(unit, SLICE_WF, patch), uf);
}

const c = (name: string, rule: string, f: Facts, cfg: ResolvedConfig = CONFIG, workflows: RepoWorkflows = ALL): RuleCase => ({ name, rule, facts: f, workflows, config: cfg });

function cases(): RuleCase[] {
  const out: RuleCase[] = [];

  // ---- repo and claims
  out.push(c("dead lease files are reclaimed", "leases.reclaim", facts([], machine({ dead_lease_files: ["agent-1.json"] }))));
  out.push(
    c("a unit worktree lost its .norn-unit: act writes it back", "worktree.marker", {
      ...facts([story(SOLO_WF)]),
      unmarked: [{ path: "/r-worktrees/gh-1-login", marker: { repo: "/r", story: "gh-1", slice: null, unit: "_story", spec_dir: ".agents/specs/gh-1-login" } }],
    }),
  );
  out.push(c("an unreadable claim ref", "claim.corrupt", facts([story(SOLO_WF, {}, null, { claim: { state: "corrupt", sha: "c9", error: { file: "refs/norn/claims/gh-1", errors: [{ path: "", message: "invalid JSON" }] } } })])));
  out.push(
    c(
      "a finished round whose claim was released and whose PR merged afterwards is taken back for the cleanup",
      "claim.reacquire.merged",
      facts([story(SOLO_WF, { step: "$done", status: "done" }, null, { claim: { state: "none" }, pr: { number: 9, url: "u", state: "merged", is_draft: false, head_sha: "abc" } })]),
    ),
  );
  out.push(c("a story file that failed validation", "story.corrupt", facts([story(SOLO_WF, {}, null, { frontmatter: null, frontmatter_error: { file: ".agents/specs/gh-1-login/story.md", errors: [{ path: "/id", message: "bad" }] } })])));

  // ---- remote mirror
  {
    const s = story(SOLO_WF);
    out.push(c("the issue title changed", "remote.mirror", facts([{ ...s, issue: { ...s.issue!, title: "Login form v2" } }])));
    const past = story(STORY_WF, ready("slices"));
    out.push(c("refine finished: the body hash is recorded", "remote.mirror.refined", facts([{ ...past, frontmatter: { ...past.frontmatter!, refined_body_hash: undefined } }])));
    out.push(c("the issue body changed after refine", "remote.mirror.body_changed", facts([{ ...s, issue: { ...s.issue!, body: "new body" } }])));
    const pr = { number: 7, url: "u", state: "open" as const, is_draft: true, head_sha: "", title: "Login form", head: "gh-1-login", base_branch: "main", merged_at: null };
    out.push(c("the issue renamed with its PR open: the PR takes the new title", "remote.pr_title", facts([{ ...s, pr, issue: { ...s.issue!, title: "Login form v2" } }])));
  }

  // ---- mailbox
  {
    const s = story(SOLO_WF);
    out.push(c("an unreadable mailbox receipt", "mailbox.reject", facts([{ ...s, mailbox: [{ ref: "refs/norn/mailbox/gh-1/01JFFFFFFFFFFFFFFFFFFFFFFF", sha: "m1", id: "01JFFFFFFFFFFFFFFFFFFFFFFF", receipt: null, error: null }] }])));
  }

  // ---- superseded records
  {
    const s = story(SOLO_WF);
    const other = { state: "other" as const, sha: "c2", blob: { ...(s.claim as Extract<StoryFacts["claim"], { state: "mine" }>).blob, holder: "ann@pc", heartbeat_id: OTHER_RUN } };
    out.push(c("taken over without a release: the local record is set aside", "record.superseded", facts([{ ...s, claim: other, local_record: { last_receipt: "0003-done", on_ref: false } }])));
    out.push(c("released cleanly: the local record on the ref is removed quietly", "record.released", facts([{ ...s, claim: other, local_record: { last_receipt: "0003-done", on_ref: true } }])));
  }

  // ---- story start
  {
    const fresh = (wfName: string, uf: Partial<UnitFacts> = {}, sf: Partial<StoryFacts> = {}) => {
      const s = storyFacts("gh-1", [unitFacts(storyUnit(), null, null, uf)], sf);
      return { ...s, frontmatter: { ...s.frontmatter!, workflow: wfName } };
    };
    out.push(c("the story names a workflow that does not exist", "start.workflow_invalid", facts([fresh("nope")])));
    out.push(c("the story worktree is missing at start", "start.no_worktree", facts([fresh("solo", noWorktree, { worktree: null })])));
    // gh-195/10 review#2 F3: a checkout cut short left the record on its ref but not in the machine dir
    // gh-195/10 review#2 F1: a story held here from its record alone, nothing pending
    out.push(c("a story held from its record without a branch", "story.record_only", facts([story(SOLO_WF, ready("implement"), null, { record_only: true, frontmatter: null, worktree: null })])));
    out.push(c("the story's record ref is here but its run state is not", "start.record_unplaced", facts([fresh("solo", {}, { record_unplaced: "0123456789abcdef0123456789abcdef01234567" })])));
  }

  // ---- unit guards
  {
    const unit = storyUnit();
    const s = storyFacts("gh-1", [unitFacts(unit, null, stateFor(unit, SOLO_WF))], { frontmatter: { ...storyFacts("gh-1", []).frontmatter!, workflow: "solo" } });
    out.push(c("the pinned workflow is missing", "unit.workflow_missing", facts([s])));
  }
  out.push(c("the pinned workflow changed outside norn", "workflow.drift", facts([story(SOLO_WF, {}, null, {}, { workflow_hash: "edited" })])));
  out.push(c("a rebase waits in the unit's worktree past the step's deadline", "unit.rebase_in_progress", facts([story(SOLO_WF, running("implement", 2 * HOUR), null, {}, { worktree: { ...worktree(STORY_WT), in_progress: { operation: "rebase", unmerged: ["X.txt"] } } })])));
  // Under record.policy remote, a held story whose record changed since the ref it last saw
  out.push(
    c(
      "a held story's record changed under the remote policy: push it after the branch",
      "record.push",
      facts([{ ...story(SOLO_WF, running("implement", MIN)), record: { tree: "b".repeat(40), pushed: { sha: "c".repeat(40), tree: "a".repeat(40) } } }]),
      { ...CONFIG, record: { policy: "remote" } },
    ),
  );
  out.push(c("a held story with a flat record", "round.migrate", facts([story(STORY_WF, { step: "slices" }, null, {}, { record: "runs/_story" })])));
  // An older norn's remote park on a finished round is dropped by the holder's tick
  out.push(c("a finished round an older norn parked for the issue", "remote.unpark_finished", facts([{ ...story(STORY_WF, { step: "$done", status: "stuck", park: { kind: "remote", reason: "remote: issue closed, unassigned or unlabelled", since: at() } }, null, {}, { record: "runs/_story/rounds/01-story" }), issue: null }])));
  // The issue closed on a finished round with no PR closes the story
  {
    const s = story(STORY_WF, { step: "$done", status: "done", park: null }, null, {}, { record: "runs/_story/rounds/01-story" });
    out.push(c("the issue closed on a finished round with no PR", "remote.issue_closed", facts([{ ...s, issue: { ...(s.issue as NonNullable<typeof s.issue>), state: "closed" } }])));
  }
  // A round receipt on a finished round starts the next round; stale or changed ones are rejected
  {
    const done = stateFor(storyUnit(), SOLO_WF, { step: "$done", status: "done", park: null });
    const roundOn = (p: Record<string, unknown>, st: Pick<UnitState, "step" | "attempt" | "run"> = done) =>
      story(SOLO_WF, { step: "$done", status: "done", park: null }, null, {}, { record: "runs/_story/rounds/01-solo", unapplied: [numbered(1, receipt(st, "round", { workflow: "story", workflow_hash: sha256(JSON.stringify(STORY_WF)), to: "refine", forced: false, left_at: "$done", ...p }, "human"))] });
    out.push(c("a round receipt on a finished round", "round.start", facts([roundOn({})])));
    out.push(c("a round receipt for another cursor", "round.reject", facts([roundOn({}, { ...done, step: "implement" })])));
    out.push(c("a round receipt whose workflow file changed since the edit", "round.workflow_changed", facts([roundOn({ workflow_hash: "b".repeat(64) })])));
  }
  out.push(c("a stuck unit waits for unstick", "unit.stuck", facts([story(SOLO_WF, { status: "stuck", park: { kind: "exhausted", reason: "nudges 2/2", since: at() } })])));
  {
    const st = stateFor(storyUnit(), SOLO_WF);
    const r = receipt({ ...st, step: "elsewhere" }, "done", { outcome: "done", handoff: "h" });
    out.push(c("a receipt for another step is rejected", "receipts.reject", facts([story(SOLO_WF, {}, null, {}, { unapplied: [numbered(1, r)] })])));
  }
  {
    // The story unit parked on a remote change halts its ready slices
    const s = story(STORY_WF, { status: "stuck", step: "slices", park: { kind: "remote", reason: "remote: issue closed", since: at() } });
    const slice = sliceAt("01", "form", {}, { worktree: worktree("/r-worktrees/gh-1-login--01-form") });
    out.push(c("a ready slice of a story parked on the remote", "story.halted", facts([{ ...s, issue: null, units: [...s.units, slice], slices: [sliceFile("gh-1", "01", "form", [], "active")] }])));
  }

  // ---- agent steps: start
  out.push(c("auto requested but no runner", "agent.ready.manual.no_runner", facts([story(SOLO_WF)], machine({ runner: null }))));
  out.push(c("the unit worktree is missing", "agent.no_worktree", facts([story(SOLO_WF, {}, null, { worktree: null }, noWorktree)])));
  // Bundled skills in the unit's worktree differ from the running norn's

  // ---- agent steps: running
  out.push(c("an attended run in progress", "agent.attended.running", facts([story(STORY_WF, running("refine"), {})])));
  out.push(c("running with no facts for the run", "agent.running.unobserved", facts([story(SOLO_WF, running("implement"))])));
  out.push(c("no activity for the stalled window", "agent.stalled.nudge", facts([story(SOLO_WF, running("implement", 20 * MIN), { last_activity_at: T0 - 20 * MIN })])));
  out.push(c("the deadline passed", "agent.timeout.nudge", facts([story(SOLO_WF, running("implement", 2 * HOUR), { hooks: [hook("tool_use")], last_activity_at: T0 - 1000 })])));
  out.push(c("a turn ended in manual mode surfaces in the inbox", "agent.silent.surface", facts([story(SOLO_WF, running("implement"), { hooks: [hook("turn_end")] }, { mode: "manual" })])));
  out.push(
    c(
      "a runner that can neither type nor resume retries instead of nudging",
      "agent.silent.retry.no_nudge",
      facts([story(SOLO_WF, running("implement"), { hooks: [hook("turn_end")] })], machine({ runner_capabilities: { send: false, resume: false } })),
    ),
  );
  out.push(c("nudges used up: stuck", "agent.silent.stuck", facts([story(SOLO_WF, running("implement", MIN, { nudges_used: 2 }), { hooks: [hook("turn_end")] })])));
  out.push(c("a declared stalled route moves to another step", "agent.stalled.route", facts([story(ROUTED_WF, running("implement", 20 * MIN), { last_activity_at: T0 - 20 * MIN })])));
  {
    // Resume instead of send, but max_agents is full and the lease is not the run's own
    const run = running("implement");
    const st = { ...run, run: { ...run.run!, agent_session_id: "sess-1" } } as Partial<UnitStateRecord>;
    out.push(
      c(
        "a resumed nudge waits for a free agent slot",
        "agent.nudge.queued",
        facts([story(SOLO_WF, st, { hooks: [hook("turn_end")] })], machine({ runner_capabilities: { send: false, resume: true }, leases: [agentLease()] })),
        config({ max_agents: 1 }),
      ),
    );
  }

  // ---- answers resumed in a fresh process
  {
    const parked = (uf: Partial<UnitFacts>) => {
      const run = running("implement");
      const st = { ...run, status: "parked", park: { kind: "ask", reason: "Q?", since: at() }, run: { ...run.run!, agent_session_id: "sess-1" } } as Partial<UnitStateRecord>;
      const s = story(SOLO_WF, st, null, {}, uf);
      const unit = s.units[0] as UnitFacts;
      unit.unapplied = [numbered(1, receipt(unit.state as UnitState, "answer", { answer: "yes" }, "human"))];
      return s;
    };
    const resumeOnly = { runner_capabilities: { send: false, resume: true } };
    out.push(c("an answer waits for a free agent slot", "answer.resume.queued", facts([parked({})], machine({ ...resumeOnly, leases: [agentLease()] })), config({ max_agents: 1 })));
    out.push(c("an answer waits while another run shows activity", "answer.resume.wait_active", facts([parked({ step_runs: [{ run_id: OTHER_RUN, last_hook_at: T0 - 1000, ended: false }] })], machine(resumeOnly))));
  }

  // ---- checks
  out.push(c("a check is already running", "check.running", facts([story(STORY_WF, ready("test"), null, {}, { lease: checkLease() })])));
  out.push(c("a check with no worktree", "check.no_worktree", facts([story(STORY_WF, ready("test"), null, { worktree: null }, noWorktree)])));
  out.push(c("max_agents in use by checks", "check.queued", facts([story(STORY_WF, ready("test"))], machine({ leases: [checkLease()] })), config({ max_agents: 1 })));

  // ---- gates and git steps
  out.push(c("a ready unit at a gate step", "gate.wait", facts([story(STORY_WF, ready("ready"))])));
  out.push(c("a ready unit at a merge step", "merge.wait", facts([story(MERGE_WF, ready("merge"))])));
  out.push(c("a story waiting at a merge step for its PR", "unit.parked.merge", facts([story(MERGE_WF, { status: "parked", step: "merge", park: { kind: "merge", reason: "merge: waiting for the story's PR to merge", since: at() } })])));
  out.push(c("a git step with no worktree", "git.no_worktree", facts([story(STORY_WF, ready("open-pr"), null, { worktree: null, pr: null }, noWorktree)])));
  out.push(c("open-pr with a PR already open runs again: the body is updated (main 0.9.x)", "git.open-pr", facts([story(STORY_WF, ready("open-pr"), null, { pr: { number: 7, url: "u", state: "open", is_draft: true, head_sha: "h" } })])));
  out.push(c("a push step", "git.push", facts([story(GIT_WF, ready("push"))])));
  {
    // Parked at a stale-routed gate, the base moved, the story's PR known only from the last sync
    const base = { ref: "refs/remotes/origin/main", sha: "b".repeat(40), head: "c".repeat(40), merge_base: "d".repeat(40), behind: 1, ahead: 1, conflicts: [] };
    const parked = { status: "parked", step: "ready", park: { kind: "gate", reason: "waiting for approve / reject", since: at() } } as const;
    const prSeen = { pr: { number: 7, url: "u", state: "open", is_draft: true, head_sha: "c".repeat(40) } as const, observed_at: T0 };
    const { pr: _, ...unfetched } = story(STALE_WF, parked, null, { base, pr_seen: prSeen });
    out.push(c("a stale-routed gate whose base moved, the story PR not fetched this tick", "gate.stale.awaits_sync", facts([unfetched])));
    // Since the ready approve only a clean base merge and green checks: the approval carries over
    const merged = { ...base, behind: 0 };
    out.push(c("a ready gate whose approval carries over a clean base merge", "gate.carried", facts([story(STALE_WF, parked, null, { base: merged, ready_since: { carry: true, resolved: false, merges: ["e".repeat(40)] } })])));
  }
  {
    // Waiting at ready past open-pr, the local head holds a code change the open PR lacks
    const parked = { status: "parked", step: "ready", park: { kind: "gate", reason: "PR ready for review?", since: at() } } as const;
    const pr = { number: 7, url: "u", state: "open", is_draft: true, head_sha: "c".repeat(40) } as const;
    out.push(c("a ready gate whose local head changes code the open PR lacks", "open_pr.guard", facts([story(STORY_WF, parked, null, { pr, pr_unpushed: ["src/a.ts"] })])));
    const { pr: _, ...unfetched } = story(STORY_WF, parked, null, { pr_seen: { pr, observed_at: T0 }, pr_unpushed: ["src/a.ts"] });
    out.push(c("the same, the story PR not fetched this tick", "open_pr.guard.awaits_sync", facts([unfetched])));
  }
  out.push(c("an update step with no base observed", "git.update.no_base", facts([story(GIT_WF, ready("update"))])));
  {
    // One integration per story per tick — two slices at integrate, then a slice before a story update
    const files = [sliceFile("gh-1", "01", "form", [], "active"), sliceFile("gh-1", "02", "api", [], "active")];
    const a = sliceAt("01", "form", ready("integrate"), { worktree: worktree("/r-worktrees/gh-1-login--01-form") });
    const b = sliceAt("02", "api", ready("integrate"), { worktree: worktree("/r-worktrees/gh-1-login--02-api") });
    out.push(c("a second slice integrate in the same tick", "git.integrate.queued", facts([atSlices(files, [a, b])])));
    const base = { ref: "refs/remotes/origin/main", sha: "b".repeat(40), head: "c".repeat(40), merge_base: "d".repeat(40), behind: 1, ahead: 1, conflicts: [] };
    const upd = story(GIT_WF, ready("update"), null, { base });
    out.push(c("a story update after a slice integrate in the same tick", "git.update.queued", facts([{ ...upd, slices: [files[0] as StoryFacts["slices"][number]], units: [a, ...upd.units] }])));
  }

  // ---- slices
  out.push(c("no slice files", "slices.none", facts([atSlices([])])));
  out.push(
    c(
      "a not-started slice's file failed validation",
      "slices.file_invalid",
      facts([atSlices([{ ...sliceFile("gh-1", "01", "form"), frontmatter: null, error: { file: "x", errors: [{ path: "", message: "bad" }] } }])]),
    ),
  );
  out.push(
    c(
      "a started slice's file failed validation",
      "slices.file_invalid",
      facts([atSlices([{ ...sliceFile("gh-1", "01", "form"), frontmatter: null, error: { file: "x", errors: [{ path: "", message: "bad" }] } }], [sliceAt("01", "form", {})])]),
    ),
  );
  out.push(c("no slice can start", "slices.blocked", facts([atSlices([sliceFile("gh-1", "01", "form", ["gh-1/02"]), sliceFile("gh-1", "02", "api", ["gh-1/01"])])])));
  out.push(
    c(
      "every active slice is stuck",
      "slices.slice_stuck",
      facts([atSlices([sliceFile("gh-1", "01", "form", [], "active")], [sliceAt("01", "form", { status: "stuck", park: { kind: "exhausted", reason: "review_loop 3/3", since: at() } })])]),
    ),
  );
  out.push(c("a slice names a workflow that does not exist", "slices.workflow_invalid", facts([atSlices([sliceFile("gh-1", "01", "form", [], "planned", "nope")])])));
  {
    // The slices step parked the story stuck (its classify receipt) and a slice can start now
    const rid = "01JGGGGGGGGGGGGGGGGGGGGGGG";
    const s = atSlices([sliceFile("gh-1", "01", "form")], [], {
      status: "stuck",
      park: { kind: "stuck", reason: "no slice files", since: at(), receipt_id: rid },
      last_outcome: { step: "slices", outcome: "stuck", at: at(), receipt_id: rid },
    } as Partial<UnitStateRecord>);
    out.push(c("a stuck slices step resumes once a slice can start", "slices.resume", facts([s])));
  }
  return out;
}

export const RULE_CASES: RuleCase[] = cases();
