import { describe, expect, test } from "bun:test";
import type { LeaseFile, UnitState } from "@norn/schema";
import { type Action, legacyAction } from "../src/actions.ts";
import { applyReceipts } from "../src/apply.ts";
import { decide, isSideAction, unitDecision } from "../src/decide/index.ts";
import { isIntakeCommit, nornTrailers } from "../src/policy.ts";
import type { RunFacts, StoryFacts, UnitFacts } from "../src/facts.ts";
import type { WorktreeStatus } from "../src/ports.ts";
import { sha256 } from "../src/hash.ts";
import {
  at,
  CONFIG,
  facts,
  HB,
  numbered,
  receipt,
  SLICE_WF,
  sliceFile,
  sliceUnit,
  SOLO_WF,
  STORY_WF,
  stateFor,
  storyFacts,
  storyUnit,
  T0,
  TICK,
  unitFacts,
  WORKFLOWS,
  worktree as worktreeOf,
} from "./fixtures.ts";

const wtStatus = (path: string, branch: string): WorktreeStatus => ({ path, branch, head: "h", clean: true, staged: [], unstaged: [], untracked: [], ahead: 0, behind: 0, upstream: null, rebase_in_progress: false });

const RUN = "01JDDDDDDDDDDDDDDDDDDDDDDD";
const kinds = (f: Parameters<typeof decide>[0]) => decide(f, WORKFLOWS, CONFIG).map((d) => `${d.unit} ${d.action.kind} ${d.rule}`);
const only = (f: Parameters<typeof decide>[0], unit = "gh-1"): Action => {
  const d = decide(f, WORKFLOWS, CONFIG).find((x) => x.unit === unit);
  if (!d) throw new Error(`no decision for ${unit}`);
  return d.action;
};

/** A story on the solo workflow (story-level agent step), with its state patched. */
function solo(patch: Partial<UnitState> = {}, run: Partial<RunFacts> | null = null, story: Partial<StoryFacts> = {}, key = "gh-1", intake = T0 - 3_600_000) {
  const unit = storyUnit(key);
  const st = stateFor(unit, SOLO_WF, patch);
  const rf: RunFacts | null = run && { run_id: RUN, session: { runner: "herdr", session_id: "s1" }, process_alive: true, pane: null, hooks: [], last_hook_at: null, last_activity_at: T0, transcript: "/t.jsonl", ...run };
  return storyFacts(key, [unitFacts(unit, SOLO_WF, st, { run: rf, worktree: { path: `/r-worktrees/${key}-login`, exists: true, status: null, last_commit_at: null, last_file_change_at: null, slot: 1 } })], { ...story, frontmatter: { ...storyFacts(key, []).frontmatter!, workflow: "solo", intake_at: at(intake) } });
}
const running = (p: Partial<UnitState> = {}): Partial<UnitState> => ({
  status: "running",
  run: { run_id: RUN, step: "implement", attempt: 1, started_at: at(T0 - 60_000), how: "auto", session: { runner: "herdr", session_id: "s1" } },
  updated_at: at(T0 - 60_000),
  ...p,
});

describe("claims (T1–T10)", () => {
  test("held by another heartbeat → nothing but a noop", () => {
    const s = solo({}, null, { claim: { state: "other", sha: "x", blob: { version: 1, story: "gh-1", holder: "ann@pc", heartbeat_id: HB, acquired_at: at(), renewed_at: at(), expires_at: at(T0 + 1), last_tick_id: null } } });
    expect(kinds(facts([s]))).toEqual(["gh-1 noop claim.other"]);
  });
  test("fresh intake story without a claim acquires one; a released story waits for take (T10)", () => {
    const fresh = storyFacts("gh-1", [unitFacts(storyUnit(), null, null)], { claim: { state: "none" } });
    fresh.frontmatter = { ...fresh.frontmatter!, status: "new" };
    const a = only(facts([fresh]));
    expect(a).toMatchObject({ kind: "claim", op: "acquire", expected: null, blob: { holder: "jakub@mac", heartbeat_id: HB, expires_at: at(T0 + 600_000) } });
    expect(kinds(facts([solo({}, null, { claim: { state: "none" } })]))).toEqual(["gh-1 noop claim.unclaimed"]);
  });
  test("renewal due → renew with CAS on the current sha (T4)", () => {
    const later = T0 + 4 * 60_000;
    const a = decide(facts([solo()], {}, later), WORKFLOWS, CONFIG)[0]?.action;
    expect(a).toMatchObject({ kind: "claim", op: "renew", expected: "c1", blob: { renewed_at: at(later), acquired_at: at() } });
  });
  test("R1.1/R1.3: renewal is a side action — a merged PR is cleaned up in the same tick", () => {
    const later = T0 + 4 * 60_000;
    const s = solo({}, null, { pr: { number: 9, url: "u", state: "merged", is_draft: false, head_sha: "abc" } });
    expect(decide(facts([s], {}, later), WORKFLOWS, CONFIG).map((d) => `${d.unit} ${d.action.kind} ${d.rule}`)).toEqual(["gh-1 claim claim.renew", "gh-1 cleanup_merged_story remote.pr_merged"]);
  });
  test("R1.3: renewal due and a done receipt waiting → the receipt is applied in the same tick", () => {
    const later = T0 + 4 * 60_000;
    const s = solo(running());
    const st = s.units[0]!.state!;
    s.units[0]!.unapplied = [numbered(2, receipt(st, "done", { outcome: "done", handoff: "ok" }))];
    const ds = decide(facts([s], {}, later), WORKFLOWS, CONFIG);
    expect(ds.map((d) => `${d.unit} ${d.action.kind} ${d.rule}`)).toEqual(["gh-1 claim claim.renew", "gh-1 apply_receipts receipts.apply"]);
    expect(isSideAction(ds[0]!.action)).toBe(true);
    expect(unitDecision(ds, "gh-1")?.rule).toBe("receipts.apply");
  });
  test("R3.1: the intake claim carries what to remove if it is lost — from the intake_only fact, never decided without it", () => {
    const fresh = (patch: Partial<StoryFacts>) => {
      const s = storyFacts("gh-1", [unitFacts(storyUnit(), null, null)], { claim: { state: "none" }, ...patch });
      s.frontmatter = { ...s.frontmatter!, status: "new" };
      const a = only(facts([s]));
      return a.kind === "claim" ? a : null;
    };
    expect(fresh({})).toMatchObject({ rule: "claim.acquire.intake" });
    expect(fresh({})).not.toHaveProperty("lost_intake");
    const clean = { ...worktreeOf("/r-worktrees/gh-1-login"), status: wtStatus("/r-worktrees/gh-1-login", "gh-1-login") };
    expect(fresh({ intake_only: true, worktree: clean })?.lost_intake).toEqual({ drop: { worktree: "/r-worktrees/gh-1-login", branch: "gh-1-login" } });
    expect(fresh({ intake_only: true, worktree: null })?.lost_intake).toEqual({ drop: { worktree: null, branch: "gh-1-login" } });
    expect(fresh({ intake_only: false, worktree: clean })?.lost_intake).toEqual({ keep: "gh-1-login has commits beyond the intake" });
    const dirty = { ...clean, status: { ...clean.status, clean: false, untracked: ["x"] } };
    expect(fresh({ intake_only: true, worktree: dirty })?.lost_intake).toEqual({ keep: "/r-worktrees/gh-1-login has uncommitted changes" });
  });
  test("R3.2: the base record wins — no acquire for a story the base records as done or whose PR merged", () => {
    // a stale local intake (status new) of a story the base already records as done (A21)
    const fresh = storyFacts("gh-1", [unitFacts(storyUnit(), null, null)], { claim: { state: "none" }, base_status: "done" });
    fresh.frontmatter = { ...fresh.frontmatter!, status: "new" };
    expect(kinds(facts([fresh]))).toEqual(["gh-1 noop story.finished"]);
    expect(kinds(facts([{ ...fresh, base_status: null, pr: { number: 9, url: "u", state: "merged", is_draft: false, head_sha: "abc" } }]))).toEqual(["gh-1 noop story.finished"]);
    // the same intake with the base not recording it acquires as before
    expect(kinds(facts([{ ...fresh, base_status: null }]))).toEqual(["gh-1 claim claim.acquire.intake"]);
    // an expired claim — even this heartbeat's own — is not re-acquired once the base says done
    const blob = { version: 1 as const, story: "gh-1", holder: "jakub@mac", heartbeat_id: HB, acquired_at: at(), renewed_at: at(), expires_at: at(T0 - 1), last_tick_id: null };
    expect(kinds(facts([solo({}, null, { claim: { state: "expired", sha: "c1", blob }, base_status: "done" })]))).toEqual(["gh-1 noop story.finished"]);
    // another heartbeat's expired claim on a merged story is not re-acquired either
    const theirs = { ...blob, heartbeat_id: "01JEEEEEEEEEEEEEEEEEEEEEEE", holder: "ann@pc" };
    expect(kinds(facts([solo({}, null, { claim: { state: "expired", sha: "c1", blob: theirs }, merged_by_ancestry: true })]))).toEqual(["gh-1 noop story.finished"]);
  });
});

describe("corrupt units (S2)", () => {
  test("decide says whether act writes corrupt into state: only the unit's own runs/ files, never a broken state.json or story.md", () => {
    const corrupt = (file: string) => {
      const s = solo();
      s.units[0]!.errors = [{ file, errors: [{ path: "", message: "bad" }] }];
      return only(facts([s]));
    };
    expect(corrupt(".agents/specs/gh-1-login/runs/_story/receipts/0001-done.json")).toMatchObject({ kind: "mark_corrupt", mark_state: true });
    expect(corrupt(".agents/specs/gh-1-login/runs/_story/state.json")).toMatchObject({ kind: "mark_corrupt", mark_state: false });
    const broken = solo({}, null, { frontmatter: null, frontmatter_error: { file: ".agents/specs/gh-1-login/story.md", errors: [{ path: "", message: "bad" }] } });
    expect(only(facts([broken]))).toMatchObject({ kind: "mark_corrupt", rule: "story.corrupt", mark_state: false });
  });
  test("never touched: mark once, then noop forever", () => {
    const s = solo();
    s.units[0]!.errors = [{ file: "runs/_story/state.json", errors: [{ path: "/step", message: "bad" }] }];
    s.units[0]!.unapplied = [numbered(1, receipt(s.units[0]!.state!, "done", { outcome: "done", handoff: "" }))];
    expect(kinds(facts([s]))).toEqual(["gh-1 mark_corrupt unit.corrupt"]);
    s.units[0]!.state = { ...s.units[0]!.state!, status: "corrupt" };
    expect(kinds(facts([s]))).toEqual(["gh-1 noop unit.corrupt"]);
  });
});

describe("receipts first (C2)", () => {
  test("a done receipt wins over a dead process", () => {
    const s = solo(running(), { process_alive: false });
    const st = s.units[0]!.state!;
    s.units[0]!.unapplied = [numbered(1, receipt(st, "done", { outcome: "done", handoff: "ok" }))];
    const a = only(facts([s]));
    expect(a).toMatchObject({ kind: "apply_receipts", applied: [1], advance: { to: "$done" }, state: { status: "done", applied_through: 1 } });
    expect(a.kind === "apply_receipts" && a.commit?.trailers).toEqual({ "Norn-Story": "gh-1", "Norn-Step": "implement", "Norn-Tick": facts([]).tick_id });
  });
  test("answer delivered into the live session", () => {
    const s = solo(running({ status: "parked", park: { kind: "ask", reason: "Q?", since: at() } }));
    const st = s.units[0]!.state!;
    s.units[0]!.unapplied = [numbered(1, receipt(st, "answer", { answer: "yes" }, "human"))];
    expect(only(facts([s]))).toMatchObject({ kind: "apply_receipts", input: { run_id: RUN, session: { runner: "herdr", session_id: "s1" }, text: "yes" } });
  });
});

describe("agent steps: modes and caps (§6, MO2, K1)", () => {
  test("auto + runner → start_run with a started receipt and the run applied", () => {
    const a = only(facts([solo()]));
    expect(a.kind).toBe("start_run");
    if (a.kind !== "start_run") return;
    expect(a.launch).toMatchObject({ agent: "claude", cwd: "/r-worktrees/gh-1-login", prompt: "Use the norn skill, then run `norn brief`.", env: { NORN_STORY: "gh-1", NORN_RUN: a.launch.run_id, NORN_SLOT: "1", PORT_BASE: "4010" } });
    expect(a.receipts).toEqual([{ n: 1, receipt: expect.objectContaining({ kind: "started", how: "auto", run_id: a.launch.run_id, step: "implement", attempt: 1 }) }]);
    expect(a.state).toMatchObject({ status: "running", applied_through: 1, run: { run_id: a.launch.run_id, how: "auto" } });
    // R2.1 (N6): the started receipts are committed and pushed in the launch tick
    expect(a.commit).toMatchObject({ cwd: "/r-worktrees/gh-1-login", branch: "gh-1-login", push: true, trailers: { "Norn-Story": "gh-1", "Norn-Step": "implement" } });
  });
  test("manual mode, attended steps and missing runner wait for a person", () => {
    expect(kinds(facts([solo({}, null, { mode: "manual" })]))).toEqual(["gh-1 noop agent.ready.manual"]);
    const noRunner = facts([solo()]);
    noRunner.machine.runner = null;
    expect(kinds(noRunner)).toEqual(["gh-1 noop agent.ready.manual.no_runner"]);
  });
  test("max_agents caps launches; the oldest story goes first, others queue (K1)", () => {
    const busy: LeaseFile = { version: 1, kind: "agent", repo: "/x", story: "gh-9", slice: null, run_id: null, holder: { pid: 1, pid_start: "1" }, created_at: at() };
    const f = facts([solo({}, null, {}, "gh-3", T0 - 10), solo({}, null, {}, "gh-2", T0 - 20)]);
    f.machine.leases = [busy];
    expect(kinds(f)).toEqual(["gh-2 start_run agent.start", "gh-3 noop agent.queued"]);
  });
  test("a running step is never launched again (MO3)", () => {
    expect(kinds(facts([solo(running(), {})]))).toEqual(["gh-1 noop agent.running"]);
  });
});

describe("classification (§10, C1, MO4)", () => {
  test("turn ended without receipt → silent → nudge in the same session", () => {
    const a = only(facts([solo(running(), { hooks: [{ event: "turn_end", at: at(T0 - 1000), agent: "claude", native: "Stop", cwd: "/w" }] })]));
    expect(a).toMatchObject({ kind: "nudge", rule: "agent.silent.nudge", input: { session: { session_id: "s1" } }, snapshot: { transcript: "/t.jsonl" }, state: { nudges_used: 1, status: "running" } });
    expect(a.kind === "nudge" && a.receipts[0]?.receipt).toMatchObject({ kind: "classify", outcome: "silent", route: "nudge", counter: { name: "nudges", value: 1, max: 2 } });
  });
  test("a turn end before the last nudge is not silent again", () => {
    const st = running({ nudges_used: 1, updated_at: at(T0 - 500) });
    expect(kinds(facts([solo(st, { hooks: [{ event: "turn_end", at: at(T0 - 1000), agent: "claude", native: "Stop", cwd: "/w" }] })]))).toEqual(["gh-1 noop agent.running"]);
  });
  test("nudges exhausted → classify to $stuck", () => {
    const a = only(facts([solo(running({ nudges_used: 2, updated_at: at(T0 - 5000) }), { pane: { alive: true, state: "idle", since: T0 - 1000 } })]));
    expect(a).toMatchObject({ kind: "classify", outcome: "silent", state: { status: "stuck", park: { kind: "exhausted", reason: "silent: nudges 2/2 at implement" } }, kill: null });
  });
  test("died → retry_fresh with a new launch and started receipt", () => {
    const a = only(facts([solo(running(), { process_alive: false })]));
    expect(a.kind).toBe("retry_fresh");
    if (a.kind !== "retry_fresh") return;
    expect(a.kill).toEqual({ runner: "herdr", session_id: "s1" });
    expect(a.receipts.map((r) => [r.n, r.receipt.kind])).toEqual([[1, "classify"], [2, "started"]]);
    expect(a.state).toMatchObject({ retries_used: 1, status: "running", applied_through: 2, run: { run_id: a.launch?.run_id } });
  });
  test("died before it got going: what the session printed is in the classify detail (B3)", () => {
    const output = "Error: Input must be provided either through stdin or as a prompt argument when using --print";
    const a = only(facts([solo(running(), { process_alive: false, output })]));
    expect(a.kind === "retry_fresh" && a.receipts[0]?.receipt).toMatchObject({ kind: "classify", outcome: "died", detail: `process gone, no receipt; it printed: ${output}` });
    // a run that worked for a while (hooks, long ago) keeps the plain detail
    const long = running({ run: { ...running().run!, started_at: at(T0 - 30 * 60_000) } });
    const hooks = [{ event: "turn_start" as const, at: at(T0 - 29 * 60_000), agent: "claude", native: "UserPromptSubmit", cwd: "/w" }];
    const b = only(facts([solo(long, { process_alive: false, output, hooks })]));
    expect(b.kind === "retry_fresh" && b.receipts[0]?.receipt).toMatchObject({ kind: "classify", outcome: "died", detail: "process gone, no receipt" });
  });
  test("timeout after the deadline; stalled after no activity", () => {
    const old = running({ run: { ...running().run!, started_at: at(T0 - 61 * 60_000) }, updated_at: at(T0 - 61 * 60_000) });
    expect(only(facts([solo(old, {})]))).toMatchObject({ kind: "nudge", rule: "agent.timeout.nudge" });
    const quiet = running({ updated_at: at(T0 - 16 * 60_000), run: { ...running().run!, started_at: at(T0 - 16 * 60_000) } });
    expect(only(facts([solo(quiet, { last_activity_at: T0 - 16 * 60_000 })]))).toMatchObject({ kind: "nudge", rule: "agent.stalled.nudge" });
  });
  test("waiting for input → implicit ask parks with the pending command", () => {
    const a = only(facts([solo(running(), { hooks: [{ event: "permission_prompt", at: at(T0 - 10), agent: "claude", native: "Notification", cwd: "/w", message: "Allow rm -rf?", command: "rm -rf build" }] })]));
    expect(a).toMatchObject({ kind: "park", rule: "agent.ask.implicit", state: { park: { kind: "ask", reason: "Allow rm -rf?" } }, notify: { group: "answer", detail: "pending command: rm -rf build" } });
    expect(a.kind === "park" && a.receipts[0]?.receipt).toMatchObject({ kind: "ask", implicit: true, command: "rm -rf build" });
  });
  test("BS5.1 (dogfood D3): an owed commit deferred by an agent's merge never takes the unit's action", () => {
    const midMerge = (s: StoryFacts, inProgress: { operation: "merge" | null; unmerged: string[] }) => {
      const u = s.units[0]!;
      u.uncommitted = true;
      u.worktree = { ...u.worktree!, in_progress: inProgress };
      return s;
    };
    const merging = { operation: "merge" as const, unmerged: ["a.ts"] };
    // nothing in progress: the recovered commit comes first, as before
    expect(only(facts([midMerge(solo(running(), {}), { operation: null, unmerged: [] })]))).toMatchObject({ kind: "commit_push", rule: "recover.commit" });
    // a second permission prompt mid-merge (pane waiting after an answered ask) parks again as an implicit ask
    const pane = { alive: true, state: "waiting_input" as const, since: null, detail: "Do you want to proceed?\n ❯ 1. Yes\n   2. No" };
    expect(only(facts([midMerge(solo(running(), { pane }), merging)]))).toMatchObject({ kind: "park", rule: "agent.ask.implicit" });
    // the deadline still fires, and a died agent is still retried
    const old = running({ run: { ...running().run!, started_at: at(T0 - 61 * 60_000) }, updated_at: at(T0 - 61 * 60_000) });
    expect(only(facts([midMerge(solo(old, {}), merging)]))).toMatchObject({ kind: "nudge", rule: "agent.timeout.nudge" });
    expect(only(facts([midMerge(solo(running(), { process_alive: false }), merging)])).kind).toBe("retry_fresh");
    // resolved but not concluded (no unmerged path, MERGE_HEAD still there) is still in progress
    expect(only(facts([midMerge(solo(running(), {}), { operation: "merge", unmerged: [] })]))).toMatchObject({ kind: "noop", rule: "agent.running" });
  });
  test("attended runs only classify died (MO4)", () => {
    const wf = { ...SOLO_WF, steps: { implement: { ...SOLO_WF.steps.implement!, attended: true } } } as typeof SOLO_WF;
    const s = solo(running(), { hooks: [{ event: "turn_end", at: at(T0 - 10), agent: "claude", native: "Stop", cwd: "/w" }] });
    s.units[0]!.workflow = wf;
    expect(kinds(facts([s]))).toEqual(["gh-1 noop agent.attended.running"]);
  });
});

/** Story on STORY_WF positioned at `step`, with optional slices. */
function storyAt(step: string, extra: Partial<StoryFacts> = {}, slices: Array<{ nn: string; deps?: string[]; state?: Partial<UnitState> | null; status?: "planned" | "integrated" }> = []) {
  const unit = storyUnit();
  const st = stateFor(unit, STORY_WF, { step, visits: { [step]: 1 }, status: "ready", park: null });
  const units = [unitFacts(unit, STORY_WF, st)];
  for (const s of slices) {
    const ref = sliceUnit("gh-1", s.nn, `s${s.nn}`);
    if (s.state !== undefined && s.state !== null) units.push(unitFacts(ref, SLICE_WF, stateFor(ref, SLICE_WF, s.state)));
  }
  return storyFacts("gh-1", units, { slices: slices.map((s) => sliceFile("gh-1", s.nn, `s${s.nn}`, s.deps ?? [], s.status ?? "planned")), ...extra });
}

describe("check, git, gate steps (W2)", () => {
  test("check runs automatically, capped by max_checks; a live check lease waits", () => {
    const a = only(facts([storyAt("test")]));
    expect(a).toMatchObject({ kind: "run_check", command: "bun test", timeout_ms: 300_000, cwd: "/r-worktrees/gh-1-login" });
    // a check carries no Transition: act writes its receipt after the effect
    expect(a).not.toHaveProperty("state");
    expect(a.kind === "run_check" && a.log_path).toBe(`.agents/specs/gh-1-login/runs/_story/logs/${a.kind === "run_check" ? a.run_id : ""}.log`);
    const leased = storyAt("test");
    leased.units[0]!.lease = { version: 1, kind: "check", repo: "/r", story: "gh-1", slice: null, run_id: RUN, holder: { pid: 1, pid_start: "1" }, created_at: at() };
    expect(kinds(facts([leased]))).toEqual(["gh-1 noop check.running"]);
  });
  test("open-pr runs git with the spec folder's pr.md as body file; an already open PR runs it too (GR9)", () => {
    const pr = { base: "main", title: "Login form", body_file: expect.stringMatching(/^\.agents\/specs\/gh-1-[^/]+\/pr\.md$/), body: expect.stringMatching(/^Closes /) };
    expect(only(facts([storyAt("open-pr")]))).toMatchObject({ kind: "run_git", action: "open-pr", pr });
    const withPr = storyAt("open-pr", { pr: { number: 7, url: "u", state: "open", is_draft: true, head_sha: "", head: "gh-1-login", base_branch: "main", merged_at: null } });
    expect(only(facts([withPr]))).toMatchObject({ kind: "run_git", action: "open-pr", pr });
  });
  test("integrate is serialized per story (K6)", () => {
    const f = storyAt("slices", {}, [
      { nn: "01", state: { step: "integrate", visits: { integrate: 1 } } },
      { nn: "02", state: { step: "integrate", visits: { integrate: 1 } } },
    ]);
    expect(kinds(facts([f]))).toEqual(["gh-1 noop slices.wait", "gh-1/01 run_git git.integrate", "gh-1/02 noop git.integrate.queued"]);
  });
});

describe("slices step (W2)", () => {
  test("starts slices whose depends_on are integrated, each with a worktree, slot and pinned workflow", () => {
    const f = storyAt("slices", {}, [{ nn: "01", status: "integrated" }, { nn: "02", deps: ["gh-1/01"] }, { nn: "03", deps: ["gh-1/02"] }]);
    const a = only(facts([f]));
    expect(a.kind).toBe("start_slices");
    if (a.kind !== "start_slices") return;
    expect(a.starts.map((s) => s.unit.key)).toEqual(["gh-1/02"]);
    expect(a.starts[0]).toMatchObject({
      workflow: "slice",
      slice_status: "active",
      worktree: { path: "/r-worktrees/gh-1-login--02-s02", branch: "gh-1/02-s02", from: "gh-1-login", slot: 1 },
      state: { story: "gh-1", slice: "gh-1/02", unit_dir: "02-s02", step: "implement", workflow_hash: sha256(WORKFLOWS.slice!.source) },
    });
    // S4: committed (commitFor) in the worktree the start creates, with the slice and its first step
    expect(a.starts[0]?.commit).toEqual({ cwd: "/r-worktrees/gh-1-login--02-s02", branch: "gh-1/02-s02", message: "norn: start gh-1/02 (slice)", trailers: { "Norn-Story": "gh-1", "Norn-Slice": "gh-1/02", "Norn-Step": "implement", "Norn-Tick": TICK }, push: true });
  });
  test("done when every slice is integrated; stuck when none can ever start", () => {
    expect(only(facts([storyAt("slices", {}, [{ nn: "01", status: "integrated" }, { nn: "02", state: { step: "$done", status: "done" } }])]))).toMatchObject({ kind: "classify", outcome: "done", state: { step: "test" } });
    expect(only(facts([storyAt("slices", {}, [{ nn: "01", deps: ["gh-1/09"] }])]))).toMatchObject({ kind: "classify", outcome: "stuck", state: { status: "stuck" } });
  });
  test("a finished slice releases its worktree and is marked integrated", () => {
    const f = storyAt("slices", {}, [{ nn: "01", state: { step: "$done", status: "done" } }, { nn: "02", deps: ["gh-1/01"] }]);
    f.units[1]!.worktree!.status = wtStatus("/r-worktrees/gh-1-login--01-s01", "gh-1/01-s01");
    expect(decide(facts([f]), WORKFLOWS, CONFIG).find((d) => d.unit === "gh-1/01")?.action).toMatchObject({ kind: "mark_done", slice_status: "integrated", cleanup: { worktree: "/r-worktrees/gh-1-login--01-s01", branch_local: "gh-1/01-s01", release_slot: true } });
  });
  test("the cleanup deletes the slice branch only when decide knows it is in the story branch", () => {
    const cleanup = (patch: Partial<UnitFacts>) => {
      const f = storyAt("slices", {}, [{ nn: "01", state: { step: "$done", status: "done" } }]);
      Object.assign(f.units[1]!, patch);
      const a = decide(facts([f]), WORKFLOWS, CONFIG).find((d) => d.unit === "gh-1/01")?.action;
      return a?.kind === "mark_done" ? a.cleanup : null;
    };
    // the worktree is on the slice branch: act integrates it first, so the branch is in the story branch
    expect(cleanup({ worktree: { ...worktreeOf("/w"), status: wtStatus("/w", "gh-1/01-s01") } })).toEqual({ worktree: "/w", branch_local: "gh-1/01-s01", release_slot: true });
    // no worktree: observe's `branch_in_story` decides
    expect(cleanup({ worktree: null, branch_in_story: true })).toEqual({ worktree: null, branch_local: "gh-1/01-s01", release_slot: true });
    expect(cleanup({ worktree: null, branch_in_story: false })).toEqual({ worktree: null, branch_local: null, branch_kept: "gh-1/01-s01 is not in the story branch", release_slot: true });
    expect(cleanup({ worktree: null })).toEqual({ worktree: null, branch_local: null, branch_kept: "gh-1/01-s01 not observed in the story branch", release_slot: true });
    // a worktree on another branch, with the branch not seen in the story branch, keeps it
    expect(cleanup({ worktree: { ...worktreeOf("/w"), status: wtStatus("/w", "other") } })).toMatchObject({ branch_local: null, branch_kept: "/w is not on gh-1/01-s01" });
  });
});

describe("story lifecycle (GR6–GR8)", () => {
  test("PR merged → cleanup", () => {
    const f = storyAt("ready", { pr: { number: 7, url: "u", state: "merged", is_draft: false, head_sha: "", head: "gh-1-login", base_branch: "main", merged_at: at() } }, [{ nn: "01", status: "integrated" }]);
    expect(only(facts([f]))).toMatchObject({ kind: "cleanup_merged_story", local_branches: ["gh-1/01-s01", "gh-1-login"], remote_branches: ["gh-1/01-s01"], refs: ["refs/norn/claims/gh-1"], story_status: "done" });
  });
  test("issue closed / unlabelled / PR closed → park remote under Unblock, once", () => {
    const closed = storyAt("test", { issue: null });
    const a = only(facts([closed]));
    expect(a).toMatchObject({ kind: "park", state: { park: { kind: "remote", reason: "remote: issue closed, unassigned or unlabelled" } }, notify: { group: "unblock", command: "norn unstick gh-1" } });
    const parked = storyAt("test", { issue: null });
    parked.units[0]!.state = { ...parked.units[0]!.state!, status: "stuck", park: { kind: "remote", reason: "x", since: at() } };
    expect(kinds(facts([parked]))).toEqual(["gh-1 noop unit.stuck"]);
    const unl = storyAt("test");
    unl.issue = { ...unl.issue!, labels: [] };
    expect(only(facts([unl]))).toMatchObject({ state: { park: { reason: "remote: label 'norn' removed" } } });
  });
  test("issue edited → mirror; body changed after refine → inbox item", () => {
    const f = storyAt("test");
    f.issue = { ...f.issue!, title: "Login v2", body: "new body" };
    f.frontmatter = { ...f.frontmatter!, refined_body_hash: sha256("body") };
    expect(only(facts([f]))).toMatchObject({ kind: "update_story_mirror", fields: { title: "Login v2", body_hash: sha256("new body") }, notify: { title: "issue body changed since refine", group: "your_turn" } });
  });
  test("S4: a mirror commit carries the story unit's step (commitFor); none before the story starts", () => {
    const f = storyAt("test");
    f.issue = { ...f.issue!, title: "Login v2" };
    expect(only(facts([f]))).toMatchObject({
      kind: "update_story_mirror",
      commit: { cwd: "/r-worktrees/gh-1-login", branch: "gh-1-login", message: "norn: mirror gh-1 from the remote issue", trailers: { "Norn-Story": "gh-1", "Norn-Step": "test", "Norn-Tick": TICK }, push: true },
    });
    const refined = storyAt("slices", {}, [{ nn: "01", state: { status: "running" } }]);
    refined.units[0]!.state = { ...refined.units[0]!.state!, visits: { refine: 1, slices: 1 } };
    const r = only(facts([refined]));
    expect(r.kind === "update_story_mirror" && r.commit?.trailers).toEqual({ "Norn-Story": "gh-1", "Norn-Step": "slices", "Norn-Tick": TICK });
    // a story nobody started: the commit still goes to the story worktree, without Norn-Step
    const fresh = storyFacts("gh-1", [], { issue: { ...f.issue! } });
    const m = only(facts([fresh]));
    expect(m.kind === "update_story_mirror" && m.commit).toEqual({ cwd: "/r-worktrees/gh-1-login", branch: "gh-1-login", message: "norn: mirror gh-1 from the remote issue", trailers: { "Norn-Story": "gh-1", "Norn-Tick": TICK }, push: true });
    // no story worktree (observe gives the story unit the story's worktree): nothing to commit in
    const gone = { ...f.worktree!, exists: false };
    expect(only(facts([{ ...f, worktree: gone, units: [{ ...f.units[0]!, worktree: gone }] }]))).toMatchObject({ kind: "update_story_mirror", commit: null });
  });
  test("GR7: a remote park goes through park() — stuck, kind remote, the same commit as any stuck unit", () => {
    const a = only(facts([storyAt("test", { issue: null })]));
    expect(a).toMatchObject({
      kind: "park",
      rule: "remote.park",
      state: { status: "stuck", park: { kind: "remote" } },
      commit: { message: "norn: gh-1 stuck (remote: issue closed, unassigned or unlabelled)", trailers: { "Norn-Story": "gh-1", "Norn-Step": "test", "Norn-Tick": TICK }, push: true },
    });
  });
});

describe("mailbox (T9)", () => {
  test("a matching receipt is imported into the parked unit; unmatched ones are rejected", () => {
    const f = storyAt("ready");
    f.units[0]!.state = { ...f.units[0]!.state!, status: "parked", park: { kind: "gate", reason: "x", since: at() } };
    const r = receipt(f.units[0]!.state!, "approve", {}, "human");
    f.mailbox = [{ ref: "refs/norn/inbox/gh-1/A", sha: "s", id: "A", receipt: r, error: null }];
    expect(only(facts([f]))).toMatchObject({ kind: "import_mailbox", receipts: [{ n: 1, receipt: r }], refs: [{ ref: "refs/norn/inbox/gh-1/A", sha: "s" }] });
    f.mailbox = [{ ref: "refs/norn/inbox/gh-1/B", sha: "s", id: "B", receipt: { ...r, attempt: 5 }, error: null }];
    expect(only(facts([f]))).toMatchObject({ kind: "reject_receipt", reason: "no unit at ready#5" });
  });
  test("a receipt naming its unit is routed to that unit, even when another unit has the same cursor", () => {
    const gate: Partial<UnitState> = { step: "human-qa", attempt: 1, visits: { "human-qa": 1 }, status: "parked", park: { kind: "gate", reason: "x", since: at() } };
    const story = storyAt("slices", {}, [{ nn: "01", state: gate }, { nn: "02", state: gate }]);
    const s2 = story.units[2]!;
    const r = { ...receipt(s2.state!, "approve", {}, "human"), slice: s2.unit.slice };
    story.mailbox = [{ ref: "refs/norn/inbox/gh-1/A", sha: "s", id: "A", receipt: r, error: null }];
    const d = decide(facts([story]), WORKFLOWS, CONFIG).find((x) => x.action.kind === "import_mailbox");
    expect(d?.unit).toBe(s2.unit.key);
    story.mailbox = [{ ref: "refs/norn/inbox/gh-1/B", sha: "s", id: "B", receipt: { ...r, slice: "gh-1/09" }, error: null }];
    expect(decide(facts([story]), WORKFLOWS, CONFIG).find((x) => x.action.kind === "reject_receipt")?.action).toMatchObject({ reason: "no unit gh-1/09 in story gh-1" });
    story.mailbox = [{ ref: "refs/norn/inbox/gh-1/C", sha: "s", id: "C", receipt: { ...r, attempt: 3 }, error: null }];
    expect(decide(facts([story]), WORKFLOWS, CONFIG).find((x) => x.action.kind === "reject_receipt")?.action).toMatchObject({ reason: "stale: gh-1/02 is not at human-qa#3" });
  });
});

describe("intake and start (GR2, W8, W9)", () => {
  test("new issue → intake with workflow from the norn:wf label", () => {
    const f = facts([]);
    f.remote.issues = [{ provider: "gh", number: 5, url: "u5", title: "Fix Łódź bug!", body: "b", state: "open", assignees: ["jakub"], labels: ["norn", "norn:wf:solo"], updated_at: at() }];
    const a = decide(f, WORKFLOWS, CONFIG)[0]?.action;
    expect(a).toMatchObject({
      kind: "intake_story",
      key: "gh-5",
      slug: "fix-lodz-bug",
      story_file: ".agents/specs/gh-5-fix-lodz-bug/spec.md",
      worktree: { path: "/r-worktrees/gh-5-fix-lodz-bug", branch: "gh-5-fix-lodz-bug", from: "main" },
      frontmatter: { workflow: "solo", status: "new", intake_at: at(), body_hash: sha256("b") },
    });
  });
  test("O5/F5: an intake decision is keyed by the new story, so `norn why gh-5` covers it", () => {
    const f = facts([]);
    f.remote.issues = [{ provider: "gh", number: 5, url: "u5", title: "Fix", body: "b", state: "open", assignees: ["jakub"], labels: ["norn"], updated_at: at() }];
    const d = decide(f, WORKFLOWS, CONFIG).find((x) => x.action.kind === "intake_story");
    expect(d?.unit).toBe("gh-5");
    expect(d?.rule).toBe("remote.intake");
    // S4, T7: committed in the worktree intake creates, no step yet, not pushed before the claim
    expect(d?.action).toMatchObject({ commit: { cwd: "/r-worktrees/gh-5-fix", branch: "gh-5-fix", message: "norn: intake gh-5 Fix", trailers: { "Norn-Story": "gh-5", "Norn-Tick": TICK }, push: false } });
    expect(d?.action.kind === "intake_story" && Object.keys(d.action.commit.trailers)).toEqual(["Norn-Story", "Norn-Tick"]);
  });
  test("story unit starts with its pinned workflow; invalid workflows are refused", () => {
    const f = storyFacts("gh-1", [unitFacts(storyUnit(), null, null)]);
    expect(only(facts([f]))).toMatchObject({ kind: "start_unit", workflow: "story", worktree: null, state: { step: "refine", status: "parked", mode: "auto" } });
    f.frontmatter = { ...f.frontmatter!, workflow: "slice" };
    expect(only(facts([f]))).toMatchObject({ kind: "notify", rule: "start.workflow_invalid", item: { group: "unblock" } });
  });
});

describe("determinism (O5)", () => {
  test("same facts → identical decisions", () => {
    const f = () => facts([solo(running(), { process_alive: false }), storyAt("slices", {}, [{ nn: "01" }])]);
    expect(decide(f(), WORKFLOWS, CONFIG)).toEqual(decide(f(), WORKFLOWS, CONFIG));
  });
  test("the decided state equals re-applying the decided receipts (S6)", () => {
    const s = solo(running(), { process_alive: false });
    const a = only(facts([s]));
    if (a.kind !== "retry_fresh") throw new Error(a.kind);
    const re = applyReceipts(s.units[0]!.state!, a.receipts.map((r) => numbered(r.n, r.receipt)), { workflow: SOLO_WF, now: at(), limits: CONFIG.limits, tick_id: facts([]).tick_id });
    expect(re.state).toEqual(a.state!);
  });
});

describe("audit fixes", () => {
  test("GR6: a finished story without a claim is never 'unclaimed'", () => {
    const done = solo({ step: "$done", status: "done" }, null, { claim: { state: "none" } });
    expect(kinds(facts([done]))).toEqual(["gh-1 noop story.finished"]);
    const recorded = solo({}, null, { claim: { state: "none" } });
    recorded.frontmatter = { ...recorded.frontmatter!, status: "done" };
    expect(kinds(facts([recorded]))).toEqual(["gh-1 noop story.finished"]);
    const dropped = solo({}, null, { claim: { state: "none" } });
    dropped.frontmatter = { ...dropped.frontmatter!, status: "dropped" };
    expect(kinds(facts([dropped]))).toEqual(["gh-1 noop story.finished"]);
  });

  test("S7/O2: workflow --to / unstick --to moving the cursor off a live run kills it", () => {
    const s = solo(running({ status: "stuck", park: { kind: "stuck", reason: "x", since: at() } }), {});
    const st = s.units[0]!.state!;
    s.units[0]!.unapplied = [numbered(1, receipt(st, "unstick", { to: "implement" }, "human"))];
    expect(only(facts([s]))).toMatchObject({ kind: "apply_receipts", kill: { runner: "herdr", session_id: "s1" }, state: { status: "ready", run: null } });
    const sw = solo(running(), {});
    const st2 = sw.units[0]!.state!;
    sw.units[0]!.unapplied = [numbered(1, receipt(st2, "workflow", { name: "solo", previous: "solo", to: "implement", to_hash: st2.workflow_hash }, "human"))];
    expect(only(facts([sw]))).toMatchObject({ kind: "apply_receipts", kill: { runner: "herdr", session_id: "s1" } });
    // a plain done receipt does not kill
    const d = solo(running(), {});
    d.units[0]!.unapplied = [numbered(1, receipt(d.units[0]!.state!, "done", { outcome: "done", handoff: "" }))];
    expect(only(facts([d]))).toMatchObject({ kind: "apply_receipts", kill: null });
  });

  test("B2: an answer to a headless run resumes the agent session with the answer as the prompt", () => {
    const s = solo(running({ status: "parked", park: { kind: "ask", reason: "Q?", since: at() } }), { process_alive: false });
    const u = s.units[0]!;
    u.state = { ...u.state!, run: { ...u.state!.run!, agent: "claude", agent_session_id: "cs-1", session: { runner: "headless", session_id: "h1" } } };
    u.unapplied = [numbered(1, receipt(u.state, "answer", { answer: "use oauth" }, "human"))];
    const a = only(facts([s]));
    expect(a).toMatchObject({ kind: "apply_receipts", input: null, launch: { run_id: RUN, agent: "claude", resume: "cs-1", prompt: "use oauth" }, state: { status: "running", applied_through: 2 } });
    expect(a.kind === "apply_receipts" && a.receipts).toEqual([{ n: 2, receipt: expect.objectContaining({ kind: "started", run_id: RUN, how: "auto" }) }]);
  });

  test("C1: manual-mode silent is surfaced in the inbox, not typed into nobody; exhausted → $stuck", () => {
    const manual = running({ run: { run_id: RUN, step: "implement", attempt: 1, started_at: at(T0 - 60_000), how: "manual" } });
    const hook = { hooks: [{ event: "turn_end" as const, at: at(T0 - 1000), agent: "claude", native: "Stop", cwd: "/w" }] };
    const a = only(facts([solo(manual, hook, { mode: "manual" })]));
    expect(a).toMatchObject({ kind: "classify", rule: "agent.silent.surface", outcome: "silent", state: { nudges_used: 1, status: "running" } });
    const out = only(facts([solo({ ...manual, nudges_used: 2 }, hook, { mode: "manual" })]));
    expect(out).toMatchObject({ kind: "classify", state: { status: "stuck", park: { kind: "exhausted" } } });
  });

  test("deadline is measured from run.started_at, not the last state write", () => {
    const old = running({ run: { ...running().run!, started_at: at(T0 - 61 * 60_000) }, updated_at: at(T0 - 60_000) });
    expect(only(facts([solo(old, { last_activity_at: T0 })]))).toMatchObject({ kind: "nudge", rule: "agent.timeout.nudge" });
    // just nudged for the timeout: give the agent the stalled window before the next one
    const nudged = { ...old, nudges_used: 1, last_outcome: { step: "implement", outcome: "timeout", source: "classified" as const, at: at(T0 - 60_000), receipt_id: "x" } };
    expect(kinds(facts([solo(nudged, { last_activity_at: T0 })]))).toEqual(["gh-1 noop agent.running"]);
  });

  test("a stuck slice makes the slices step stuck, naming the slice (§10)", () => {
    const f = storyAt("slices", {}, [{ nn: "01", state: { status: "stuck", park: { kind: "stuck", reason: "cannot build", since: at() } } }, { nn: "02", deps: ["gh-1/01"] }]);
    const a = only(facts([f]));
    expect(a).toMatchObject({ kind: "classify", outcome: "stuck", state: { status: "stuck" } });
    expect(a.kind === "classify" && a.receipts[0]?.receipt).toMatchObject({ detail: expect.stringContaining("gh-1/01") });
    // a slice still running → wait
    const g = storyAt("slices", {}, [{ nn: "01", state: { status: "stuck", park: { kind: "stuck", reason: "x", since: at() } } }, { nn: "02", state: { status: "running" } }]);
    expect(kinds(facts([g]))[0]).toBe("gh-1 noop slices.wait");
  });

  test("the slices step resumes by itself once a stuck slice moves again (§10)", () => {
    const stuckSlice = { status: "stuck" as const, park: { kind: "stuck" as const, reason: "cannot build", since: at() } };
    const parkedBy = only(facts([storyAt("slices", {}, [{ nn: "01", state: stuckSlice }])]));
    if (parkedBy.kind !== "classify" || !parkedBy.state) throw new Error("expected the slices step to classify stuck");
    const storyStuck = parkedBy.state;
    const withSlice = (slice: Partial<UnitState>) => {
      const f = storyAt("slices", {}, [{ nn: "01", state: slice }]);
      f.units[0]!.state = storyStuck;
      return f;
    };
    // the slice is still stuck: the story waits for a person
    expect(kinds(facts([withSlice(stuckSlice)]))[0]).toBe("gh-1 noop unit.stuck");
    // a person unstuck the slice: norn unsticks the story back into its slices step
    const a = only(facts([withSlice({ status: "running" })]));
    expect(a).toMatchObject({ kind: "apply_receipts", rule: "slices.resume", state: { step: "slices", status: "ready", park: null } });
    expect(a.kind === "apply_receipts" && a.receipts[0]?.receipt).toMatchObject({ kind: "unstick", by: "norn", step: "slices" });
    // stuck for another reason at the slices step (a remote change): never resumed by norn
    const remote = withSlice({ status: "running" });
    remote.units[0]!.state = { ...storyStuck, park: { kind: "remote", reason: "remote: issue closed", since: at() } };
    expect(kinds(facts([remote]))[0]).toBe("gh-1 noop unit.stuck");
  });

  test("GR8: leaving the refine step records refined_body_hash once", () => {
    const f = storyAt("slices", {}, [{ nn: "01", state: { status: "running" } }]);
    f.units[0]!.state = { ...f.units[0]!.state!, visits: { refine: 1, slices: 1 } };
    expect(only(facts([f]))).toMatchObject({ kind: "update_story_mirror", rule: "remote.mirror.refined", fields: { refined_body_hash: sha256("body") }, notify: null });
    f.frontmatter = { ...f.frontmatter!, refined_body_hash: sha256("body") };
    expect(kinds(facts([f]))[0]).toBe("gh-1 noop slices.wait");
    const atRefine = storyAt("refine");
    atRefine.units[0]!.state = { ...atRefine.units[0]!.state!, status: "parked", park: { kind: "attended", reason: "x", since: at() } };
    expect(kinds(facts([atRefine]))[0]).not.toContain("update_story_mirror");
  });
});

describe("commit trailers (S4, R3.1)", () => {
  test("nornTrailers builds them; isIntakeCommit reads an intake off them, never off a subject", () => {
    expect(nornTrailers(TICK, "gh-1", null, null)).toEqual({ "Norn-Story": "gh-1", "Norn-Tick": TICK });
    expect(nornTrailers(TICK, "gh-1", "gh-1/01", "$done")).toEqual({ "Norn-Story": "gh-1", "Norn-Slice": "gh-1/01", "Norn-Step": "$done", "Norn-Tick": TICK });
    expect(isIntakeCommit(nornTrailers(TICK, "gh-1", null, null), "gh-1")).toBe(true);
    expect(isIntakeCommit(nornTrailers(TICK, "gh-1", null, null), "gh-2")).toBe(false);
    expect(isIntakeCommit(nornTrailers(TICK, "gh-1", null, "plan"), "gh-1")).toBe(false);
    expect(isIntakeCommit(nornTrailers(TICK, "gh-1", "gh-1/01", null), "gh-1")).toBe(false);
    // a person's commit (no Norn-Tick) is never the intake, whatever its subject says
    expect(isIntakeCommit({ "Norn-Story": "gh-1" }, "gh-1")).toBe(false);
    expect(isIntakeCommit({}, "gh-1")).toBe(false);
  });
});

describe("trace compatibility (O5)", () => {
  test("an action an older norn recorded reads as the action decide emits now", () => {
    const check = only(facts([storyAt("test")]));
    const park = only(facts([storyAt("test", { issue: null })]));
    if (park.kind !== "park") throw new Error(park.kind);
    // as an older norn wrote them: an empty Transition on run_check, a copy of state.park on park
    expect(legacyAction({ ...check, receipts: [], state: null, commit: null })).toEqual(check);
    expect(legacyAction({ ...park, park: park.state.park })).toEqual(park);
    expect(legacyAction(check)).toBe(check);
    // a non-empty transition on such a kind is a real difference, kept for the replay diff
    const odd = { ...check, receipts: [], state: park.state, commit: null };
    expect(legacyAction(odd)).toBe(odd);
  });
});
