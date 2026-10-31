import { describe, expect, test } from "bun:test";
import { HEARTBEAT_BEGIN, collapseHeartbeat, renderHandoff, renderHandoffStatus, STATUS_BEGIN, STATUS_END } from "../../src/handoff.ts";
import type { Decision } from "../../src/actions.ts";
import { inboxChanges } from "../../src/inbox/history.ts";
import { buildInbox } from "../../src/inbox/items.ts";
import { startAgentCommand } from "../../src/commands.ts";
import type { StoryFacts } from "../../src/facts.ts";
import type { RemotePullRequest } from "../../src/ports.ts";
import { at, CONFIG, facts, numbered, receipt, SLICE_WF, sliceUnit, STORY_WF, stateFor, storyFacts, storyUnit, T0, unitFacts } from "../fixtures.ts";

const SLICE = sliceUnit("gh-1", "02", "form");

describe("handoff.md (S9, O6)", () => {
  const st = stateFor(SLICE, SLICE_WF, {
    step: "review",
    attempt: 2,
    counters: { test_loop: 1, review_loop: 2, qa_loop: 0, conflict_loop: 0 },
    status: "parked",
    park: { kind: "ask", reason: "Which DB?", since: at() },
    last_outcome: { step: "test", outcome: "pass", source: "classified", at: at(), receipt_id: "01JCCCCCCCCCCCCCCCCCCCCCCC" },
  });

  test("status block is rendered from state", () => {
    expect(renderHandoffStatus(st, { workflow: SLICE_WF })).toMatchSnapshot();
  });

  test("heartbeat repeats collapse into (×n) with the newest time", () => {
    let lines: string[] = [];
    lines = collapseHeartbeat(lines, { at: "t1", text: "implement: nudged (silent)" });
    lines = collapseHeartbeat(lines, { at: "t2", text: "implement: nudged (silent)" });
    lines = collapseHeartbeat(lines, { at: "t3", text: "implement: nudged (silent)" });
    lines = collapseHeartbeat(lines, { at: "t4", text: "implement.done → test" });
    expect(lines).toEqual(["- t3 implement: nudged (silent) (×3)", "- t4 implement.done → test"]);
  });

  test("renderHandoff replaces the status block, keeps agent sections, appends heartbeat lines", () => {
    const first = renderHandoff(null, renderHandoffStatus(st), [{ at: "t1", text: "parked: ask" }]);
    expect(first).toMatchSnapshot();
    const edited = first.replace("## Progress\n", "## Progress\n- form renders\n");
    const st2 = { ...st, status: "running" as const, park: null };
    const second = renderHandoff(edited, renderHandoffStatus(st2), [{ at: "t2", text: "parked: ask" }, { at: "t3", text: "answered" }]);
    expect(second).toContain("- form renders");
    expect(second).toContain("- Status: running");
    expect(second).not.toContain("Which DB?");
    expect(second.split(STATUS_BEGIN)).toHaveLength(2);
    expect(second.split(HEARTBEAT_BEGIN)).toHaveLength(2);
    expect(second).toContain("- t2 parked: ask (×2)\n- t3 answered\n");
    expect(renderHandoff("# Notes\n", renderHandoffStatus(st2))).toStartWith(`${STATUS_BEGIN}`);
    expect(renderHandoff("# Notes\n", renderHandoffStatus(st2))).toContain(`${STATUS_END}\n\n# Notes\n`);
  });
});

describe("inbox (O1)", () => {
  test("groups items with reason, age and exact command", () => {
    const now = T0 + 90 * 60_000;
    const ask = stateFor(sliceUnit("gh-1", "01", "a"), SLICE_WF, { status: "parked", park: { kind: "ask", reason: "Which DB?", since: at(T0), receipt_id: "01JCCCCCCCCCCCCCCCCCCCCCCC" } });
    const gate = stateFor(sliceUnit("gh-1", "02", "b"), SLICE_WF, { step: "human-qa", status: "parked", park: { kind: "gate", reason: "approve or reject human-qa", since: at(T0) } });
    const stuck = stateFor(sliceUnit("gh-1", "03", "c"), SLICE_WF, { status: "stuck", park: { kind: "exhausted", reason: "review_loop 3/3 at review.changes_requested", since: at(T0) } });
    const runningSt = stateFor(sliceUnit("gh-1", "04", "d"), SLICE_WF, { status: "running", run: { run_id: "01JDDDDDDDDDDDDDDDDDDDDDDD", step: "implement", attempt: 1, started_at: at(T0), how: "auto" } });
    const story = stateFor(storyUnit(), STORY_WF);
    const units = [
      unitFacts(storyUnit(), STORY_WF, story),
      unitFacts(sliceUnit("gh-1", "01", "a"), SLICE_WF, ask),
      unitFacts(sliceUnit("gh-1", "02", "b"), SLICE_WF, gate),
      unitFacts(sliceUnit("gh-1", "03", "c"), SLICE_WF, stuck),
      unitFacts(sliceUnit("gh-1", "04", "d"), SLICE_WF, runningSt),
    ];
    const released = storyFacts("gh-2", [unitFacts(storyUnit("gh-2"), STORY_WF, stateFor(storyUnit("gh-2"), STORY_WF))], { claim: { state: "none" } });
    const inbox = buildInbox(facts([storyFacts("gh-1", units), released], {}, now), CONFIG);
    const view = Object.fromEntries(Object.entries(inbox.groups).map(([g, items]) => [g, items.map((i) => `${i.slice ?? i.story} | ${i.title} | ${i.age} | ${i.command}`)]));
    expect(view).toEqual({
      your_turn: [`gh-1 | refine: attended step — work with the agent | 1h | cd /r-worktrees/gh-1-login && claude --permission-mode auto -- 'Use the norn skill, then run \`norn brief\`.'`],
      answer: ['gh-1/01 | Which DB? | 1h | norn story answer gh-1/01 "…"'],
      approve: ["gh-1/02 | approve or reject human-qa | 1h | norn story approve gh-1/02"],
      unblock: ["gh-1/03 | review_loop 3/3 at review.changes_requested | 1h | norn run rerun gh-1/03"],
      check: [],
      unclaimed: ["gh-2 | Unclaimed — Login form | 2h | norn story checkout gh-2"],
      notes: [],
      running: ["gh-1/04 | implement #1 (auto) | 1h | norn run list gh-1/04"],
      recently_done: [],
    });
    expect(inbox.pending).toBe(5);
    expect(inbox.groups.answer[0]?.id).toBe("01JCCCCCCCCCCCCCCCCCCCCCCC");
  });

  test("a runner that opens terminals for a person: Your turn shows norn open, the typed command in the detail (MO5)", () => {
    const st = stateFor(storyUnit(), STORY_WF, { status: "parked", park: { kind: "attended", reason: "attended", since: at(T0) } });
    const f = facts([storyFacts("gh-1", [unitFacts(storyUnit(), STORY_WF, st)])]);
    f.machine.runner_capabilities = { send: true, resume: true, open: true };
    expect(buildInbox(f, CONFIG).groups.your_turn).toMatchObject([
      { command: "norn story start gh-1", detail: `by hand: cd /r-worktrees/gh-1-login && claude --permission-mode auto -- 'Use the norn skill, then run \`norn brief\`.'` },
    ]);
  });

  test("a story taken in but not started: Your turn (norn watch) while no heartbeat runs, else Running (GR2)", () => {
    const fresh = storyFacts("gh-1", [unitFacts(storyUnit(), STORY_WF, null)]);
    const down = buildInbox(facts([fresh]), CONFIG);
    expect(down.groups.your_turn).toMatchObject([{ id: "not-started:gh-1", story: "gh-1", command: "norn watch" }]);
    expect(down.pending).toBe(1);
    const up = buildInbox(facts([fresh], { heartbeat: { last_tick_at: T0 - 10_000 } }), CONFIG);
    expect(up.groups.your_turn).toEqual([]);
    expect(up.groups.running).toMatchObject([{ id: "not-started:gh-1", title: "taken in — the next tick starts it" }]);
    // released or held elsewhere: nothing for this checkout
    expect(buildInbox(facts([{ ...fresh, claim: { state: "none" } }]), CONFIG).pending).toBe(0);
  });

  test("manual ready step under Your turn notes the MO2 downgrade", () => {
    const st = stateFor(SLICE, SLICE_WF);
    const f = facts([storyFacts("gh-1", [unitFacts(SLICE, SLICE_WF, st)])]);
    f.machine.runner = null;
    const item = buildInbox(f, CONFIG).groups.your_turn[0];
    expect(item).toMatchObject({ title: "implement is ready (manual): start an agent in the worktree", detail: "auto requested, no runner; running manual (MO2)" });
    expect(item?.command).toStartWith("cd ");
  });
});

describe("the inbox points only at a worktree on disk, as decide does (refactor 3.4)", () => {
  // The view (`norn inbox`) records the conventional worktree path with `exists: false` when it
  // is gone; observe (the tick's notifier) reports no worktree. Both must give the same inbox.
  const gone = (uf: ReturnType<typeof unitFacts>) => ({ ...uf, worktree: uf.worktree && { ...uf.worktree, exists: false } });
  const absent = (uf: ReturnType<typeof unitFacts>) => ({ ...uf, worktree: null });
  const manual = (uf: ReturnType<typeof unitFacts>) => {
    const f = facts([storyFacts("gh-1", [uf], { worktree: null })]);
    f.machine.runner = null;
    return buildInbox(f, CONFIG);
  };

  test("a manual ready step whose worktree is gone: start command without cd, same as no worktree", () => {
    const uf = unitFacts(SLICE, SLICE_WF, stateFor(SLICE, SLICE_WF));
    const view = manual(gone(uf)).groups.your_turn[0];
    expect(view?.command).toBe("claude --permission-mode auto -- 'Use the norn skill, then run `norn brief`.'");
    expect(view).toEqual(manual(absent(uf)).groups.your_turn[0]);
    // on disk: the person is told to cd into it
    expect(manual(uf).groups.your_turn[0]?.command).toStartWith("cd /r-worktrees/gh-1-login--02-form && ");
  });

  test("a running unit whose worktree is gone reaches no worktree (HC3)", () => {
    const st = stateFor(SLICE, SLICE_WF, { status: "running", run: { run_id: "01JDDDDDDDDDDDDDDDDDDDDDDD", step: "implement", attempt: 1, started_at: at(), how: "auto" } });
    const uf = unitFacts(SLICE, SLICE_WF, st);
    const running = (u: ReturnType<typeof unitFacts>) => buildInbox(facts([storyFacts("gh-1", [u])]), CONFIG).groups.running;
    expect(running(gone(uf))[0]?.reach?.worktree).toBeNull();
    expect(running(gone(uf))).toEqual(running(absent(uf)));
    expect(running(uf)[0]?.reach?.worktree).toBe("/r-worktrees/gh-1-login--02-form");
  });
});

describe("start command for a person (MO2, B3)", () => {
  test("carries the agent's configured args, ended by --", () => {
    expect(startAgentCommand("/w", "claude", ["--allowedTools", "Bash(git:*)", "Read"])).toBe(
      "cd /w && claude --allowedTools 'Bash(git:*)' Read -- 'Use the norn skill, then run `norn brief`.'",
    );
  });
  test("no args, no --", () => {
    expect(startAgentCommand(null, "codex")).toBe("codex 'Use the norn skill, then run `norn brief`.'");
  });
});

describe("inbox audit fixes", () => {
  test("GR6: a finished story with no claim is not 'Unclaimed'", () => {
    const unit = storyUnit("gh-7");
    const done = storyFacts("gh-7", [unitFacts(unit, STORY_WF, stateFor(unit, STORY_WF, { step: "$done", status: "done", updated_at: at() }))], { claim: { state: "none" } });
    const inbox = buildInbox(facts([done]), CONFIG);
    expect(inbox.groups.unclaimed).toEqual([]);
    const recorded = storyFacts("gh-7", [unitFacts(unit, STORY_WF, stateFor(unit, STORY_WF))], { claim: { state: "none" } });
    recorded.frontmatter = { ...recorded.frontmatter!, status: "done" };
    expect(buildInbox(facts([recorded]), CONFIG).groups.unclaimed).toEqual([]);
  });

  test("C1: a manual run that ended its turn without reporting is surfaced, once per counted nudge", () => {
    const unit = storyUnit();
    const wf = { ...STORY_WF, steps: { ...STORY_WF.steps, fix: { type: "agent" as const, skill: "implement", outcomes: { done: "test" } } } };
    const st = stateFor(unit, wf, {
      step: "fix",
      status: "running",
      park: null,
      nudges_used: 1,
      run: { run_id: "01JDDDDDDDDDDDDDDDDDDDDDDD", step: "fix", attempt: 1, started_at: at(T0 - 60_000), how: "manual" },
      last_outcome: { step: "fix", outcome: "silent", source: "classified", at: at(T0 - 1000), receipt_id: "01JCCCCCCCCCCCCCCCCCCCCCCC" },
    });
    const s = storyFacts("gh-1", [unitFacts(unit, wf, st)], { mode: "manual" });
    const item = buildInbox(facts([s]), CONFIG).groups.your_turn[0];
    expect(item).toMatchObject({ id: "silent:gh-1:fix#1:1", title: "agent ended its turn without reporting — reopen the agent and run norn brief" });
    // activity after the classification → the agent is back; nothing to surface
    s.units[0]!.run = { run_id: "01JDDDDDDDDDDDDDDDDDDDDDDD", session: null, process_alive: null, pane: null, hooks: [], last_hook_at: T0, last_activity_at: T0, transcript: null };
    expect(buildInbox(facts([s]), CONFIG).groups.your_turn).toEqual([]);
  });
});

describe("inbox: the person's last actions (F21, F25, F35, Q6)", () => {
  const story = storyUnit();
  const doneStory = (patch: Partial<StoryFacts> = {}) =>
    storyFacts("gh-1", [unitFacts(story, STORY_WF, stateFor(story, STORY_WF, { step: "$done", status: "done", updated_at: at(T0 - 60_000) }))], patch);
  const pr = (over: Partial<RemotePullRequest> = {}): RemotePullRequest => ({ number: 7, url: "https://github.com/o/r/pull/7", state: "open", is_draft: false, head_sha: "a".repeat(40), ...over });

  test("story at $done with an open PR: 'Merge PR #N' under Your turn with its URL, not under Recently done", () => {
    const inbox = buildInbox(facts([doneStory({ pr: pr() })]), CONFIG);
    expect(inbox.groups.recently_done).toEqual([]);
    expect(inbox.groups.your_turn).toEqual([
      expect.objectContaining({ id: "merge:gh-1:7", story: "gh-1", step: null, title: "Merge PR #7", command: "gh pr merge 7", url: "https://github.com/o/r/pull/7", detail: "https://github.com/o/r/pull/7" }),
    ]);
    expect(inbox.pending).toBe(1);
  });

  test("a draft PR says so and how to mark it ready", () => {
    const item = buildInbox(facts([doneStory({ pr: pr({ is_draft: true }) })]), CONFIG).groups.your_turn[0];
    expect(item).toMatchObject({ title: "Merge PR #7 (still a draft)", detail: "https://github.com/o/r/pull/7 · draft: mark it ready first (gh pr ready 7)" });
  });

  test("merged PR or PR not fetched: no merge item", () => {
    expect(buildInbox(facts([doneStory({ pr: pr({ state: "merged" }) })]), CONFIG).groups.your_turn).toEqual([]);
    const notFetched = buildInbox(facts([doneStory({ pr: undefined })]), CONFIG);
    expect(notFetched.groups.your_turn).toEqual([]);
    expect(notFetched.groups.recently_done[0]?.title).toBe("workflow done — waiting for the PR merge (GR6)");
  });

  test("branch already in origin/<base> (merged by ancestry): no merge item, not 'waiting for the PR merge'", () => {
    const inbox = buildInbox(facts([doneStory({ pr: pr(), merged_by_ancestry: true })]), CONFIG);
    expect(inbox.groups.your_turn).toEqual([]);
    expect(inbox.groups.recently_done[0]?.title).toBe("done");
  });

  test("story.md says done (merge seen, PR not fetched): plain 'done', no merge item", () => {
    const s = doneStory({ pr: pr() });
    s.frontmatter = { ...s.frontmatter!, status: "done" };
    const inbox = buildInbox(facts([s]), CONFIG);
    expect(inbox.groups.your_turn).toEqual([]);
    expect(inbox.groups.recently_done[0]?.title).toBe("done");
  });

  test("PR head changed after the ready approval: a Check item naming both heads", () => {
    const inbox = buildInbox(facts([doneStory({ pr: pr({ head_sha: "b".repeat(40) }), ready_head_sha: "a".repeat(40) })]), CONFIG);
    expect(inbox.groups.check).toEqual([
      expect.objectContaining({
        id: `head:gh-1:${"b".repeat(40)}`,
        title: "PR #7 head changed after ready approval (aaaaaaa → bbbbbbb)",
        command: `git log --stat ${"a".repeat(40)}..${"b".repeat(40)}`,
        url: "https://github.com/o/r/pull/7",
      }),
    ]);
    expect(buildInbox(facts([doneStory({ pr: pr(), ready_head_sha: "a".repeat(40) })]), CONFIG).groups.check).toEqual([]);
  });

  test("BS10.2 (dogfood D6): a PR remembered from before the ready approval is no head change", () => {
    const old = { pr: undefined, pr_seen: { pr: pr({ head_sha: "c".repeat(40) }), observed_at: T0 - 20_000 }, ready_head_sha: "a".repeat(40), ready_approved_at: at(T0 - 10_000) };
    expect(buildInbox(facts([doneStory(old)]), CONFIG).groups.check).toEqual([]);
    // seen after the approval (or fetched this tick): the head did change
    const later = { ...old, pr_seen: { ...old.pr_seen, observed_at: T0 - 5_000 } };
    expect(buildInbox(facts([doneStory(later)]), CONFIG).groups.check.map((i) => i.id)).toEqual([`head:gh-1:${"c".repeat(40)}`]);
    const fetched = { ...old, pr: pr({ head_sha: "c".repeat(40) }) };
    expect(buildInbox(facts([doneStory(fetched)]), CONFIG).groups.check.map((i) => i.id)).toEqual([`head:gh-1:${"c".repeat(40)}`]);
  });

  test("commits outside norn: one Check item per branch, newest commit in the id", () => {
    const c = (sha: string, branch: string, subject: string, ms: number) => ({ sha: sha.repeat(40), subject, author: "Jakub", at: at(ms), branch });
    const s = doneStory({ pr: pr(), foreign_commits: [c("d", "gh-1-login", "resolve conflicts", T0 - 1000), c("e", "gh-1-login", "Merge origin/main", T0 - 5000), c("f", "gh-1/02-form", "tweak", T0 - 2000)] });
    const check = buildInbox(facts([s]), CONFIG).groups.check;
    expect(check.map((i) => [i.id, i.title, i.detail, i.command])).toEqual([
      [`foreign:gh-1:${"d".repeat(40)}`, "2 commits outside norn on gh-1-login", "ddddddd resolve conflicts (Jakub) · eeeeeee Merge origin/main (Jakub)", `git log --stat -n 2 ${"d".repeat(40)}`],
      [`foreign:gh-1:${"f".repeat(40)}`, "1 commit outside norn on gh-1/02-form", "fffffff tweak (Jakub)", `git log --stat -n 1 ${"f".repeat(40)}`],
    ]);
    expect(check[0]?.since).toBe(at(T0 - 5000));
  });

  test("a gate item names the report by receipt number; its full text gives the report and evidence folder, absolute", () => {
    const unit = sliceUnit("gh-1", "02", "form");
    const st = stateFor(unit, SLICE_WF, {
      step: "human-qa",
      status: "parked",
      park: { kind: "gate", reason: "evidence attached", since: at(T0) },
      last_outcome: { step: "qa", outcome: "partial", source: "reported", at: at(T0), receipt_id: "01JCCCCCCCCCCCCCCCCCCCCCCC" },
    });
    const qa = numbered(9, receipt({ step: "qa", attempt: 1, run: null }, "done", { outcome: "partial", handoff: "AC7 needs a browser", evidence: "evidence/01JDDDDDDDDDDDDDDDDDDDDDDD" }));
    const uf = unitFacts(unit, SLICE_WF, st, { last_outcome_receipt: { ...qa, file: ".agents/specs/gh-1-login/runs/02-form/receipts/0009-done.json" } });
    const item = buildInbox(facts([storyFacts("gh-1", [uf])]), CONFIG).groups.approve[0];
    const dir = "/r-worktrees/gh-1-login--02-form/.agents/specs/gh-1-login/runs/02-form";
    expect(item?.detail).toBe('step qa#1 reported partial (receipt 0009) · or reject: norn story reject gh-1/02 --reason "…"');
    expect(item?.full).toBe(`Report: ${dir}/receipts/0009-done.json\nEvidence: ${dir}/evidence/01JDDDDDDDDDDDDDDDDDDDDDDD/`);
  });
});

describe("inbox history (O1, O4)", () => {
  const unit = sliceUnit("gh-1", "02", "form");
  const gate = stateFor(unit, SLICE_WF, { step: "human-qa", status: "parked", park: { kind: "gate", reason: "approve or reject human-qa", since: at(T0 - 60_000) } });

  test("items needing a person appear once with their since; running items are not tracked", () => {
    const f = facts([storyFacts("gh-1", [unitFacts(unit, SLICE_WF, gate), unitFacts(sliceUnit("gh-1", "03", "c"), SLICE_WF, stateFor(sliceUnit("gh-1", "03", "c"), SLICE_WF, { status: "running" }))])]);
    const first = inboxChanges({}, buildInbox(f, CONFIG), f, []);
    expect(first.changes).toEqual([
      expect.objectContaining({ event: "appeared", id: "approve:gh-1/02:human-qa#1", group: "approve", slice: "gh-1/02", step: "human-qa", at: at(T0 - 60_000), command: "norn story approve gh-1/02" }),
    ]);
    expect(Object.keys(first.open)).toEqual(["approve:gh-1/02:human-qa#1"]);
    expect(inboxChanges(first.open, buildInbox(f, CONFIG), f, []).changes).toEqual([]);
  });

  test("a resolved item names the receipt that resolved it and its time", () => {
    const f0 = facts([storyFacts("gh-1", [unitFacts(unit, SLICE_WF, gate)])]);
    const { open } = inboxChanges({}, buildInbox(f0, CONFIG), f0, []);
    const approve = numbered(8, { ...receipt(gate, "approve", { comment: "ok" }, "human"), who: "jakub@mac", at: at(T0 + 5_000) });
    const pre = facts([storyFacts("gh-1", [unitFacts(unit, SLICE_WF, gate, { unapplied: [{ ...approve, file: ".agents/specs/gh-1-login/runs/02-form/receipts/0008-approve.json" }] })])], {}, T0 + 10_000);
    const post = facts([storyFacts("gh-1", [unitFacts(unit, SLICE_WF, stateFor(unit, SLICE_WF, { step: "integrate", status: "ready" }))])], {}, T0 + 10_000);
    const decisions = [{ unit: "gh-1/02", rule: "receipts.apply", action: { kind: "apply_receipts", applied: [8] } }] as unknown as Decision[];
    const r = inboxChanges(open, buildInbox(post, CONFIG), pre, decisions);
    expect(r.changes).toEqual([expect.objectContaining({ event: "resolved", id: "approve:gh-1/02:human-qa#1", at: at(T0 + 5_000), resolved_by: "approve by jakub@mac (0008-approve.json)" })]);
    expect(r.open).toEqual({});
    // nothing acted on it: it just left
    expect(inboxChanges(open, buildInbox(post, CONFIG), pre, []).changes[0]).toMatchObject({ resolved_by: "no longer pending", at: at(T0 + 10_000) });
  });
});

describe("unpushed runs (R2.3)", () => {
  test("a non-holder's local receipts are a Check item naming the holder, resolved by norn tidy", () => {
    const s = storyFacts("gh-9", [unitFacts(storyUnit("gh-9"), STORY_WF, stateFor(storyUnit("gh-9"), STORY_WF))], {
      claim: { state: "other", sha: "x", blob: { version: 1, story: "gh-9", holder: "ann@pc", heartbeat_id: "01JEEEEEEEEEEEEEEEEEEEEEEE", acquired_at: at(), renewed_at: at(), expires_at: at(T0 + 600_000), last_tick_id: null } },
      unpushed_runs: [{ unit: "gh-9", files: [".agents/specs/gh-9-login/runs/_story/receipts/0035-done.json", ".agents/specs/gh-9-login/runs/_story/state.json"] }],
    });
    const inbox = buildInbox(facts([s]), CONFIG);
    expect(inbox.groups.check).toHaveLength(1);
    expect(inbox.groups.check[0]).toMatchObject({
      id: expect.stringMatching(/^unpushed:gh-9:[0-9a-f]{12}$/),
      story: "gh-9",
      slice: null,
      title: "local work on gh-9 is not in the record (0035-done) — the story is now held by ann@pc",
      command: "norn tidy",
    });
    // nothing else of a story held elsewhere is shown
    expect(inbox.pending).toBe(1);
  });
});
