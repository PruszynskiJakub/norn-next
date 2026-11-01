/**
 * Hand-built decide cases for the rule ids no golden case reaches (refactor Phase 0.1). Each case
 * is a whole decide input and the rule it must fire; `golden.test.ts` runs them and counts them
 * toward rule coverage. Built from `fixtures.ts`.
 */
import type { LeaseFile, ResolvedConfig, UnitState, Workflow } from "@norn/schema";
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
const ALL: RepoWorkflows = { ...WORKFLOWS, gitty: loaded(GIT_WF), routed: loaded(ROUTED_WF) };

const agentLease = (run_id: string | null = null): LeaseFile => ({ version: 1, kind: "agent", repo: "/x", story: "gh-9", slice: null, run_id, holder: { pid: 1, pid_start: "1" }, created_at: at() });
const checkLease = (): LeaseFile => ({ version: 1, kind: "check", repo: "/x", story: "gh-9", slice: null, run_id: null, holder: { pid: 1, pid_start: "1" }, created_at: at() });

/**
 * The story unit of `gh-1` on `wf`, its state patched, with a live run's facts when `run` is given.
 * Its refine is recorded as finished (GR8), so a cursor past refine does not mirror first.
 */
function story(wf: Workflow, patch: Partial<UnitState> = {}, run: Partial<RunFacts> | null = null, sf: Partial<StoryFacts> = {}, uf: Partial<UnitFacts> = {}): StoryFacts {
  const unit = storyUnit();
  const st = stateFor(unit, wf, patch);
  const rf: RunFacts | null = run && { run_id: RUN, session: { runner: "herdr", session_id: "s1" }, process_alive: true, pane: null, hooks: [], last_hook_at: null, last_activity_at: T0, transcript: "/t.jsonl", ...run };
  const base = storyFacts("gh-1", []);
  return storyFacts("gh-1", [unitFacts(unit, wf, st, { run: rf, worktree: worktree(STORY_WT), ...uf })], { frontmatter: { ...base.frontmatter!, workflow: wf.name, refined_body_hash: sha256("body") }, ...sf });
}

/** A running agent run of the cursor step, started `ago` ms before T0. */
function running(step: string, ago = MIN, p: Partial<UnitState> = {}): Partial<UnitState> {
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

const ready = (step: string, p: Partial<UnitState> = {}): Partial<UnitState> => ({ status: "ready", park: null, step, ...p });
const noWorktree: Partial<UnitFacts> = { worktree: { ...worktree(STORY_WT), exists: false } };
const config = (p: Partial<ResolvedConfig> = {}): ResolvedConfig => ({ ...CONFIG, ...p });
const machine = (p: Partial<Facts["machine"]>): Partial<Facts> => ({ machine: { ...facts([]).machine, ...p } });

/** A story at its slices step with the given slice files and slice units. */
function atSlices(files: StoryFacts["slices"], slices: UnitFacts[] = [], p: Partial<UnitState> = {}): StoryFacts {
  const s = story(STORY_WF, ready("slices", p));
  return { ...s, slices: files, units: [...s.units, ...slices] };
}
function sliceAt(nn: string, slug: string, patch: Partial<UnitState>, uf: Partial<UnitFacts> = {}): UnitFacts {
  const unit = sliceUnit("gh-1", nn, slug);
  return unitFacts(unit, SLICE_WF, stateFor(unit, SLICE_WF, patch), uf);
}

const c = (name: string, rule: string, f: Facts, cfg: ResolvedConfig = CONFIG, workflows: RepoWorkflows = ALL): RuleCase => ({ name, rule, facts: f, workflows, config: cfg });

function cases(): RuleCase[] {
  const out: RuleCase[] = [];

  // ---- repo and claims
  out.push(c("dead lease files are reclaimed", "leases.reclaim", facts([], machine({ dead_lease_files: ["agent-1.json"] }))));
  out.push(c("an unreadable claim ref", "claim.corrupt", facts([story(SOLO_WF, {}, null, { claim: { state: "corrupt", sha: "c9", error: { file: "refs/norn/claims/gh-1", errors: [{ path: "", message: "invalid JSON" }] } } })])));
  out.push(c("a story file that failed validation", "story.corrupt", facts([story(SOLO_WF, {}, null, { frontmatter: null, frontmatter_error: { file: ".agents/specs/gh-1-login/story.md", errors: [{ path: "/id", message: "bad" }] } })])));

  // ---- remote mirror (GR8)
  {
    const s = story(SOLO_WF);
    out.push(c("the issue title changed", "remote.mirror", facts([{ ...s, issue: { ...s.issue!, title: "Login form v2" } }])));
    const past = story(STORY_WF, ready("slices"));
    out.push(c("refine finished: the body hash is recorded", "remote.mirror.refined", facts([{ ...past, frontmatter: { ...past.frontmatter!, refined_body_hash: undefined } }])));
    out.push(c("the issue body changed after refine", "remote.mirror.body_changed", facts([{ ...s, issue: { ...s.issue!, body: "new body" } }])));
  }

  // ---- mailbox (T9)
  {
    const s = story(SOLO_WF);
    out.push(c("an unreadable mailbox receipt", "mailbox.reject", facts([{ ...s, mailbox: [{ ref: "refs/norn/mailbox/gh-1/01JFFFFFFFFFFFFFFFFFFFFFFF", sha: "m1", id: "01JFFFFFFFFFFFFFFFFFFFFFFF", receipt: null, error: null }] }])));
  }

  // ---- story start
  {
    const fresh = (wfName: string, uf: Partial<UnitFacts> = {}, sf: Partial<StoryFacts> = {}) => {
      const s = storyFacts("gh-1", [unitFacts(storyUnit(), null, null, uf)], sf);
      return { ...s, frontmatter: { ...s.frontmatter!, workflow: wfName } };
    };
    out.push(c("the story names a workflow that does not exist", "start.workflow_invalid", facts([fresh("nope")])));
    out.push(c("the story worktree is missing at start", "start.no_worktree", facts([fresh("solo", noWorktree, { worktree: null })])));
  }

  // ---- unit guards
  {
    const unit = storyUnit();
    const s = storyFacts("gh-1", [unitFacts(unit, null, stateFor(unit, SOLO_WF))], { frontmatter: { ...storyFacts("gh-1", []).frontmatter!, workflow: "solo" } });
    out.push(c("the pinned workflow is missing", "unit.workflow_missing", facts([s])));
  }
  out.push(c("the pinned workflow changed outside norn", "workflow.drift", facts([story(SOLO_WF, {}, null, {}, { workflow_hash: "edited" })])));
  out.push(c("a rebase waits in the unit's worktree past the step's deadline", "unit.rebase_in_progress", facts([story(SOLO_WF, running("implement", 2 * HOUR), null, {}, { worktree: { ...worktree(STORY_WT), in_progress: { operation: "rebase", unmerged: ["X.txt"] } } })])));
  out.push(c("a ready unit whose cursor is $done", "unit.no_step", facts([story(SOLO_WF, ready("$done"))])));
  // gh-71 D7 (B34): a held story whose record is still flat moves into round 1 first
  out.push(c("a held story with a flat record", "round.migrate", facts([story(STORY_WF, { step: "slices" }, null, {}, { record: "runs/_story" })])));
  // gh-71 D5 (B35): an older norn's remote park on a finished round is dropped by the holder's tick
  out.push(c("a finished round an older norn parked for the issue", "remote.unpark_finished", facts([{ ...story(STORY_WF, { step: "$done", status: "stuck", park: { kind: "remote", reason: "remote: issue closed, unassigned or unlabelled", since: at() } }, null, {}, { record: "runs/_story/rounds/01-story" }), issue: null }])));
  // gh-71 D1 (B1, B6): a round receipt on a finished round starts the next round; stale or changed ones are rejected
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
    // GR7: the story unit parked on a remote change halts its ready slices
    const s = story(STORY_WF, { status: "stuck", step: "slices", park: { kind: "remote", reason: "remote: issue closed", since: at() } });
    const slice = sliceAt("01", "form", {}, { worktree: worktree("/r-worktrees/gh-1-login--01-form") });
    out.push(c("a ready slice of a story parked on the remote", "story.halted", facts([{ ...s, issue: null, units: [...s.units, slice], slices: [sliceFile("gh-1", "01", "form", [], "active")] }])));
  }

  // ---- agent steps: start
  out.push(c("auto requested but no runner", "agent.ready.manual.no_runner", facts([story(SOLO_WF)], machine({ runner: null }))));
  out.push(c("the unit worktree is missing", "agent.no_worktree", facts([story(SOLO_WF, {}, null, { worktree: null }, noWorktree)])));

  // ---- agent steps: running
  out.push(c("an attended run in progress", "agent.attended.running", facts([story(STORY_WF, running("refine"), {})])));
  out.push(c("running without a run record", "agent.running.no_run", facts([story(SOLO_WF, { ...running("implement"), run: null })])));
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
    // R4.2: resume instead of send, but max_agents is full and the lease is not the run's own
    const run = running("implement");
    const st = { ...run, run: { ...run.run!, agent_session_id: "sess-1" } } as Partial<UnitState>;
    out.push(
      c(
        "a resumed nudge waits for a free agent slot",
        "agent.nudge.queued",
        facts([story(SOLO_WF, st, { hooks: [hook("turn_end")] })], machine({ runner_capabilities: { send: false, resume: true }, leases: [agentLease()] })),
        config({ max_agents: 1 }),
      ),
    );
  }

  // ---- answers (B2) resumed in a fresh process
  {
    const parked = (uf: Partial<UnitFacts>) => {
      const run = running("implement");
      const st = { ...run, status: "parked", park: { kind: "ask", reason: "Q?", since: at() }, run: { ...run.run!, agent_session_id: "sess-1" } } as Partial<UnitState>;
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
  out.push(c("max_checks in use", "check.queued", facts([story(STORY_WF, ready("test"))], machine({ leases: [checkLease()] })), config({ max_checks: 1 })));

  // ---- gates and git steps
  out.push(c("a ready unit at a gate step", "gate.wait", facts([story(STORY_WF, ready("ready"))])));
  out.push(c("a git step with no worktree", "git.no_worktree", facts([story(STORY_WF, ready("open-pr"), null, { worktree: null, pr: null }, noWorktree)])));
  out.push(c("open-pr with a PR already open runs again: the body is updated (GR9, main 0.9.x)", "git.open-pr", facts([story(STORY_WF, ready("open-pr"), null, { pr: { number: 7, url: "u", state: "open", is_draft: true, head_sha: "h" } })])));
  out.push(c("a push step", "git.push", facts([story(GIT_WF, ready("push"))])));
  out.push(c("an update step with no base observed", "git.update.no_base", facts([story(GIT_WF, ready("update"))])));
  {
    // K6: one integration per story per tick — two slices at integrate, then a slice before a story update
    const files = [sliceFile("gh-1", "01", "form", [], "active"), sliceFile("gh-1", "02", "api", [], "active")];
    const a = sliceAt("01", "form", ready("integrate"), { worktree: worktree("/r-worktrees/gh-1-login--01-form") });
    const b = sliceAt("02", "api", ready("integrate"), { worktree: worktree("/r-worktrees/gh-1-login--02-api") });
    out.push(c("a second slice integrate in the same tick", "git.integrate.queued", facts([atSlices(files, [a, b], { status: "running" })])));
    const base = { ref: "refs/remotes/origin/main", sha: "b".repeat(40), head: "c".repeat(40), merge_base: "d".repeat(40), behind: 1, ahead: 1, conflicts: [] };
    const upd = story(GIT_WF, ready("update"), null, { base });
    out.push(c("a story update after a slice integrate in the same tick", "git.update.queued", facts([{ ...upd, slices: [files[0] as StoryFacts["slices"][number]], units: [a, ...upd.units] }])));
  }

  // ---- slices (W2)
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
    // §10: the slices step parked the story stuck (its classify receipt) and a slice can start now
    const rid = "01JGGGGGGGGGGGGGGGGGGGGGGG";
    const s = atSlices([sliceFile("gh-1", "01", "form")], [], {
      status: "stuck",
      park: { kind: "stuck", reason: "no slice files", since: at(), receipt_id: rid },
      last_outcome: { step: "slices", outcome: "stuck", at: at(), receipt_id: rid },
    } as Partial<UnitState>);
    out.push(c("a stuck slices step resumes once a slice can start", "slices.resume", facts([s])));
  }
  return out;
}

export const RULE_CASES: RuleCase[] = cases();
