/** Shared test fixtures: workflows, states, receipts and Facts builders. */
import { DEFAULT_CONFIG, deriveUlid, type Receipt, type ResolvedConfig, type UnitState, type Workflow } from "@norn/schema";
import { initialState } from "../src/apply.ts";
import type { LoadedWorkflow, RepoWorkflows } from "../src/decide/index.ts";
import type { Facts, NumberedReceipt, SliceFileFacts, StoryFacts, UnitFacts, UnitRef, WorktreeFacts } from "../src/facts.ts";
import { sha256 } from "../src/hash.ts";

export const T0 = Date.parse("2026-10-23T10:00:00.000Z");
export const TICK = "01JAAAAAAAAAAAAAAAAAAAAAAA";
export const HB = "01JBBBBBBBBBBBBBBBBBBBBBBB";
export const at = (ms = T0) => new Date(ms).toISOString();
let rid = 0;
export const rid_ = () => deriveUlid("01JCCCCCCCCCCCCCCCCCCCCCCC", rid++);

/** PRD §11 slice example. */
export const SLICE_WF: Workflow = {
  name: "slice",
  start: "implement",
  steps: {
    implement: { type: "agent", skill: "implement", outcomes: { done: { to: "test", means: "every acceptance criterion (or rework point) has a passing test" } } },
    test: { type: "check", run: "bun test", timeout: "10m", outcomes: { pass: "review", fail: { to: "implement", counter: "test_loop" } } },
    review: {
      type: "agent",
      skill: "review",
      outcomes: {
        approve: { to: "qa", means: "all criteria met, no blocking findings" },
        changes_requested: { to: "implement", counter: "review_loop", means: "blocking findings in the receipt" },
      },
    },
    qa: {
      type: "agent",
      skill: "qa",
      outcomes: {
        pass: { to: "integrate", means: "every criterion verified with evidence" },
        fail: { to: "implement", counter: "qa_loop", means: "a criterion fails; repro in the receipt" },
        partial: { to: "human-qa", means: "criteria only a person can check are listed with prepared evidence" },
      },
    },
    "human-qa": { type: "gate", outcomes: { approve: "integrate", reject: { to: "implement", counter: "qa_loop" } } },
    integrate: { type: "git", action: "integrate", outcomes: { done: "$done", conflict: { to: "merge", counter: "conflict_loop" } } },
    merge: { type: "agent", skill: "merge", outcomes: { done: "integrate" } },
  },
  counters: { test_loop: { max: 5 }, review_loop: { max: 3 }, qa_loop: { max: 2 }, conflict_loop: { max: 2 } },
};

/** A small story workflow: attended refine → slices → test → open-pr → ready gate. */
export const STORY_WF: Workflow = {
  name: "story",
  start: "refine",
  steps: {
    refine: { type: "agent", skill: "refine", attended: true, outcomes: { done: "slices" } },
    slices: { type: "slices", outcomes: { done: "test", stuck: "$stuck" } },
    test: { type: "check", run: "bun test", timeout: "5m", outcomes: { pass: "open-pr", fail: { to: "fix", counter: "fix_loop" } } },
    fix: { type: "agent", skill: "implement", outcomes: { done: "test" } },
    "open-pr": { type: "git", action: "open-pr", outcomes: { done: "ready" } },
    ready: { type: "gate", prompt: "PR ready for review?", outcomes: { approve: "$done" } },
  },
  counters: { fix_loop: { max: 2 } },
};

/** Unattended single-step story workflow, for auto-mode scheduling tests. */
export const SOLO_WF: Workflow = {
  name: "solo",
  start: "implement",
  steps: { implement: { type: "agent", skill: "implement", nudges: 2, retries: 1, outcomes: { done: "$done" } } },
};

export const loaded = (wf: Workflow): LoadedWorkflow => ({ name: wf.name, workflow: wf, source: JSON.stringify(wf), issues: [] });
export const WORKFLOWS: RepoWorkflows = { slice: loaded(SLICE_WF), story: loaded(STORY_WF), solo: loaded(SOLO_WF) };

export const CONFIG: ResolvedConfig = { ...DEFAULT_CONFIG, runner: { adapter: "herdr" } };

export const storyUnit = (key = "gh-1"): UnitRef => ({ story: key, slice: null, dir: "_story", key });
export const sliceUnit = (story: string, nn: string, slug: string): UnitRef => ({ story, slice: `${story}/${nn}`, dir: `${nn}-${slug}`, key: `${story}/${nn}` });

export function stateFor(unit: UnitRef, wf: Workflow, patch: Partial<UnitState> = {}): UnitState {
  return { ...initialState({ unit, workflow: wf, workflowName: wf.name, workflowHash: sha256(JSON.stringify(wf)), now: at() }), ...patch };
}

/** Receipt with a header matching the state's cursor. */
export function receipt<K extends Receipt["kind"]>(st: Pick<UnitState, "step" | "attempt" | "run">, kind: K, body: Record<string, unknown> = {}, by: "agent" | "human" | "norn" = "agent"): Extract<Receipt, { kind: K }> {
  return { kind, receipt_id: rid_(), run_id: st.run?.run_id ?? null, step: st.step, attempt: st.attempt, at: at(), by, ...body } as unknown as Extract<Receipt, { kind: K }>;
}
export const numbered = (n: number, r: Receipt): NumberedReceipt => ({ n, file: `${String(n).padStart(4, "0")}-${r.kind}.json`, receipt: r });

export const worktree = (path: string, slot: number | null = 1): WorktreeFacts => ({ path, exists: true, status: null, last_commit_at: null, last_file_change_at: null, slot });

export function unitFacts(unit: UnitRef, wf: Workflow | null, state: UnitState | null, patch: Partial<UnitFacts> = {}): UnitFacts {
  return {
    unit,
    state,
    workflow: wf,
    workflow_hash: state?.workflow_hash ?? null,
    errors: [],
    unapplied: [],
    last_check: null,
    last_findings: null,
    worktree: worktree(unit.slice ? `/r-worktrees/gh-1-login--${unit.dir}` : "/r-worktrees/gh-1-login"),
    run: null,
    lease: null,
    uncommitted: false,
    ...patch,
  };
}

export function sliceFile(story: string, nn: string, slug: string, depends: string[] = [], status: "planned" | "active" | "integrated" | "dropped" = "planned", workflow?: string): SliceFileFacts {
  return {
    key: `${story}/${nn}`,
    file: `.agents/specs/${story}-login/slices/${nn}-${slug}.md`,
    nn,
    slug,
    frontmatter: { id: `${story}/${nn}`, title: slug, depends_on: depends, status, ...(workflow ? { workflow } : {}) },
    error: null,
  };
}

export function storyFacts(key: string, units: UnitFacts[], patch: Partial<StoryFacts> = {}, intakeMs = T0 - 3_600_000): StoryFacts {
  const n = Number(key.split("-")[1]);
  return {
    key,
    slug: "login",
    spec_dir: `.agents/specs/${key}-login`,
    branch: `${key}-login`,
    frontmatter: {
      id: key,
      slug: "login",
      provider: "gh",
      number: n,
      url: `https://github.com/o/r/issues/${n}`,
      title: "Login form",
      assignee: "jakub",
      labels: ["norn"],
      workflow: "story",
      status: "active",
      intake_at: at(intakeMs),
      body_hash: sha256("body"),
    },
    frontmatter_error: null,
    worktree: worktree(`/r-worktrees/${key}-login`),
    claim: { state: "mine", sha: "c1", blob: { version: 1, story: key, holder: "jakub@mac", heartbeat_id: HB, acquired_at: at(), renewed_at: at(), expires_at: at(T0 + 600_000), last_tick_id: null } },
    mailbox: [],
    issue: { provider: "gh", number: n, url: `https://github.com/o/r/issues/${n}`, title: "Login form", body: "body", state: "open", assignees: ["jakub"], labels: ["norn"], updated_at: at() },
    pr: null,
    units,
    slices: [],
    mode: "auto",
    ...patch,
  };
}

export function facts(stories: StoryFacts[], patch: Partial<Facts> = {}, now = T0): Facts {
  return {
    tick_id: TICK,
    now,
    repo: { root: "/r", default_branch: "main", remote: "origin" },
    machine: { holder: "jakub@mac", heartbeat_id: HB, runner: "herdr", leases: [] },
    remote: { issues: undefined },
    stories,
    orphans: { worktrees: [], branches: [] },
    ...patch,
  };
}
