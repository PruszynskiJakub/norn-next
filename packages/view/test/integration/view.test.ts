import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ClaimBlob, type LeaseFile, type Receipt, type UnitState, ulid } from "@norn/schema";
import {
  acquireClaim,
  appendHookTrace,
  appendReceipt,
  bindNornHome,
  appendTrace,
  leasesDir,
  machineDir,
  pinWorkflow,
  sha256,
  storyDir,
  storyFile,
  storyUnitDir,
  unitDir,
  writeSliceFile,
  writeState,
  writeStoryFile,
  writePrFacts,
  writeUnitMarker,
} from "@norn/store";
import { formatInbox, formatStatus, formatStoryView, formatTimeline, loadProjectView, loadTimelines, orientReport, prCommand } from "../../src/index.ts";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "norn-view-"));
  dirs.push(d);
  return d;
}

const NOW = Date.parse("2026-10-23T12:00:00.000Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

const WF = `name: slice
start: implement
steps:
  implement:
    type: agent
    skill: implement
    outcomes: { done: { to: test, means: "tests pass" } }
  test:
    type: check
    run: bun test
    timeout: 10m
    outcomes: { pass: $done, fail: { to: implement, counter: test_loop } }
counters: { test_loop: { max: 3 } }
`;

function state(over: Partial<UnitState>): UnitState {
  return {
    version: 1,
    story: "gh-12",
    slice: null,
    unit_dir: "_story",
    workflow: "slice",
    workflow_hash: sha256(WF),
    step: "implement",
    attempt: 1,
    visits: { implement: 1 },
    step_entered_at: ago(120),
    status: "ready",
    park: null,
    counters: {},
    nudges_used: 0,
    retries_used: 0,
    applied_through: 0,
    run: null,
    last_outcome: null,
    created_at: ago(300),
    updated_at: ago(120),
    last_tick_id: null,
    ...over,
  };
}

function receipt(over: Record<string, unknown>): Receipt {
  return { receipt_id: ulid(NOW), run_id: null, step: "implement", attempt: 1, at: ago(60), by: "agent", ...over } as Receipt;
}

const RUN = ulid(NOW - 30 * 60_000);
const ASK = ulid(NOW - 40 * 60_000);

async function seed() {
  const repo = tmp();
  const home = tmp();
  Bun.spawnSync(["git", "init", "-q", repo], { cwd: repo });
  bindNornHome(repo, home);
  const spec = storyDir(repo, "gh-12", "fix-login");
  writeStoryFile(
    storyFile(spec),
    { id: "gh-12", slug: "fix-login", provider: "gh", number: 12, url: "https://x/12", title: "Fix login", assignee: null, workflow: "story", status: "active", intake_at: ago(600) },
    "\nspec\n",
  );
  writeSliceFile(join(spec, "slices/01-add-form.md"), { id: "gh-12/01", title: "Add form", depends_on: [], status: "active" }, "");
  writeSliceFile(join(spec, "slices/02-wire-api.md"), { id: "gh-12/02", title: "Wire API", depends_on: ["gh-12/01"], status: "integrated" }, "");
  writeSliceFile(join(spec, "slices/03-docs.md"), { id: "gh-12/03", title: "Docs", depends_on: ["gh-12/02"], status: "planned" }, "");

  // story unit: parked on an ask
  const su = storyUnitDir(spec);
  pinWorkflow(su, WF);
  appendReceipt(su, receipt({ kind: "ask", receipt_id: ASK, question: "Which OAuth provider?", at: ago(40) }));
  writeState(su, state({ status: "parked", park: { kind: "ask", reason: "Which OAuth provider?", since: ago(40), receipt_id: ASK }, applied_through: 1, mode: "auto" }));

  // slice 01: running, second attempt, counter used
  const u1 = unitDir(spec, "01-add-form");
  pinWorkflow(u1, WF);
  appendReceipt(u1, receipt({ kind: "check", step: "test", outcome: "fail", command: "bun test", exit_code: 1, duration_ms: 2300, output_tail: "x", at: ago(50) }));
  appendReceipt(u1, receipt({ kind: "started", run_id: RUN, attempt: 2, how: "auto", agent: "claude", worktree: "/w", at: ago(30) }));
  writeState(
    u1,
    state({
      slice: "gh-12/01",
      unit_dir: "01-add-form",
      attempt: 2,
      visits: { implement: 2, test: 1 },
      status: "running",
      counters: { test_loop: 1 },
      applied_through: 2,
      run: { run_id: RUN, step: "implement", attempt: 2, started_at: ago(30), how: "auto", agent: "claude", session: { runner: "herdr", session_id: "s1" } },
    }),
  );

  // slice 02: done an hour ago
  const u2 = unitDir(spec, "02-wire-api");
  pinWorkflow(u2, WF);
  writeState(u2, state({ slice: "gh-12/02", unit_dir: "02-wire-api", step: "$done", status: "done", updated_at: ago(60) }));

  // trace: a tick decision and a hook for slice 01, a tick for the story
  const tick = ulid(NOW - 31 * 60_000);
  appendTrace(repo, {
    type: "tick",
    tick_id: tick,
    at: ago(31),
    heartbeat_id: null,
    duration_ms: 5,
    facts: {},
    decisions: [
      { unit: "gh-12/01", rule: "launch-ready-auto", action: { kind: "launch" }, result: { ok: true } },
      { unit: "gh-12", rule: "noop", action: { kind: "wait" }, result: { ok: true } },
    ],
  });
  appendHookTrace(repo, { story: "gh-12", slice: "gh-12/01" }, {
    type: "hook",
    id: ulid(NOW),
    fact: { event: "tool_use", at: ago(20), agent: "claude", native: "PreToolUse", cwd: "/w", story: "gh-12", slice: "gh-12/01", run_id: RUN, tool: "Bash" },
  });

  // this machine's agent lease for the run
  const lease: LeaseFile = { version: 1, kind: "agent", repo, story: "gh-12", slice: "gh-12/01", run_id: RUN, holder: { pid: 4242, pid_start: "x" }, created_at: ago(30) };
  mkdirSync(leasesDir(home), { recursive: true });
  writeFileSync(join(leasesDir(home), "agent-1.json"), JSON.stringify(lease));

  // claim held by me
  const blob: ClaimBlob = { version: 1, story: "gh-12", holder: "me@box", heartbeat_id: ulid(NOW), acquired_at: ago(100), renewed_at: ago(2), expires_at: ago(-8), last_tick_id: null };
  const c = await acquireClaim(repo, null, blob, { now: NOW });
  if (!c.ok) throw new Error("claim");
  return { repo, home };
}

function tree(root: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      const s = statSync(p);
      if (s.isDirectory()) walk(p);
      else out.push(`${p}:${s.size}:${s.mtimeMs}`);
    }
  };
  walk(root);
  return out;
}

describe("loadProjectView", () => {
  test("stories, slices, inbox, runs, recently done", async () => {
    const { repo, home } = await seed();
    const v = await loadProjectView({ repoRoot: repo, home, now: NOW, holder: "me@box", liveness: () => true, env: {} });

    expect(v.errors).toEqual([]);
    expect(v.stories.map((s) => s.key)).toEqual(["gh-12"]);
    const s = v.stories[0];
    if (!s) throw new Error("unreachable");
    expect(s).toMatchObject({
      title: "Fix login",
      url: "https://x/12",
      workflow: "slice",
      mode: "auto",
      effective_mode: "manual",
      mode_downgraded: true,
      status: "parked",
      step: "implement",
      attempt: 1,
      story_status: "active",
      park: { kind: "ask", reason: "Which OAuth provider?" },
      age: "40m",
      next: 'norn story answer gh-12 "…"',
    });
    expect(s.claim).toEqual({ state: "mine", holder: "me@box", expires_at: ago(-8), unclaimed: false });
    expect(s.counters).toEqual([{ name: "test_loop", value: 0, max: 3 }]);

    expect(s.slices.map((x) => [x.key, x.status, x.slice_status, x.integrated, x.depends_on])).toEqual([
      ["gh-12/01", "running", "active", false, []],
      ["gh-12/02", "done", "integrated", true, ["gh-12/01"]],
      ["gh-12/03", "not_started", "planned", false, ["gh-12/02"]],
    ]);
    const s1 = s.slices[0];
    expect(s1).toMatchObject({ title: "Add form", attempt: 2, age: "30m", next: "norn run list gh-12/01" });
    expect(s1?.counters).toEqual([{ name: "test_loop", value: 1, max: 3 }]);
    expect(s.slices[2]).toMatchObject({ workflow: "slice", step: null, attempt: null, age: null });

    expect(v.inbox.groups.answer.map((i) => i.id)).toEqual([ASK]);
    expect(v.inbox.groups.running.map((i) => i.slice)).toEqual(["gh-12/01"]);
    // refactor 3.4: no worktree on disk → the inbox reaches none (observe reports none either)
    expect(v.inbox.groups.running[0]?.reach?.worktree).toBeNull();
    expect(v.inbox.groups.recently_done.map((i) => i.slice)).toEqual(["gh-12/02"]);
    expect(v.inbox.pending).toBe(1);

    expect(v.runs).toEqual([
      {
        unit: "gh-12/01",
        story: "gh-12",
        slice: "gh-12/01",
        run_id: RUN,
        step: "implement",
        attempt: 2,
        started_at: ago(30),
        how: "auto",
        agent: "claude",
        session: { runner: "herdr", session_id: "s1" },
        alive: true,
        lease: { kind: "agent", file: "agent-1.json", slot: null },
        last_hook_at: ago(20),
        classified: null,
        machine: null,
      },
    ]);

    // D1 (B3): the project view carries no timeline
    expect("timeline" in v).toBe(false);

    expect(v.recently_done).toEqual([{ unit: "gh-12/02", title: "Wire API", done_at: ago(60), age: "1h" }]);
    expect(JSON.parse(JSON.stringify(v))).toEqual(v);
  });

  test("timelines are a separate read: receipts and trace events per unit (B3, D1)", async () => {
    const { repo, home } = await seed();
    const t = loadTimelines({ repoRoot: repo, home, now: NOW, env: {} });
    expect(t.errors).toEqual([]);
    expect(t.timeline["gh-12/01"]?.map((e) => [e.source, e.kind])).toEqual([
      ["receipt", "check"],
      ["tick", "launch"],
      ["receipt", "started"],
      ["hook", "tool_use"],
    ]);
    expect(t.timeline["gh-12/01"]?.[1]?.summary).toBe("tick launch-ready-auto → launch");
    expect(t.timeline["gh-12"]?.map((e) => e.kind)).toEqual(["ask", "wait"]);
    expect(t.timeline["gh-12/03"]).toEqual([]);
    expect(formatTimeline(t.timeline["gh-12/01"] ?? [])).toContain("check fail at test#1: bun test (exit 1, 2.3s)");
  });

  test("trace window: the timeline read keeps 14 days; the project view reads no trace, so a broken line is not its error (B3, D1)", async () => {
    const { repo, home } = await seed();
    const old = NOW - 20 * 86_400_000;
    appendTrace(repo, { type: "tick", tick_id: ulid(old), at: new Date(old).toISOString(), heartbeat_id: null, duration_ms: 5, facts: {}, decisions: [{ unit: "gh-12", rule: "old", action: { kind: "wait" }, result: { ok: true } }] });
    writeFileSync(join(machineDir(repo), "2026-10-22.jsonl"), '{"type":"tick",broken\n');
    const v = await loadProjectView({ repoRoot: repo, home, now: NOW, holder: "me@box", liveness: () => true, env: {} });
    expect(v.errors).toEqual([]);
    const t = loadTimelines({ repoRoot: repo, home, now: NOW, env: {} });
    expect(t.timeline["gh-12"]?.map((e) => e.summary)).not.toContainEqual(expect.stringContaining("old"));
    expect(t.errors.map((e) => e.file)).toEqual(["2026-10-22.jsonl:1"]);
  });

  test("dead lease → alive false; claim by someone else hides the story from the inbox", async () => {
    const { repo, home } = await seed();
    const v = await loadProjectView({ repoRoot: repo, home, now: NOW, holder: "you@there", liveness: () => false, env: {} });
    expect(v.runs[0]?.alive).toBe(false);
    expect(v.stories[0]?.claim.state).toBe("other");
    expect(v.inbox.pending).toBe(0);
    expect(formatStatus(v)).toContain("held by me@box");
  });

  test("an expired claim shows unclaimed", async () => {
    const { repo, home } = await seed();
    const v = await loadProjectView({ repoRoot: repo, home, now: NOW + 3_600_000, holder: "me@box", liveness: () => true, env: {} });
    expect(v.stories[0]?.claim).toMatchObject({ state: "expired", unclaimed: true });
    expect(v.inbox.groups.unclaimed.map((i) => i.command)).toEqual(["norn story checkout gh-12"]);
  });

  test("corrupt state is reported, not guessed (S2)", async () => {
    const { repo, home } = await seed();
    writeFileSync(join(unitDir(storyDir(repo, "gh-12", "fix-login"), "02-wire-api"), "state.json"), "{}");
    const v = await loadProjectView({ repoRoot: repo, home, now: NOW, holder: "me@box", liveness: () => true, env: {} });
    const s2 = v.stories[0]?.slices[1];
    expect(s2?.status).toBe("corrupt");
    expect(s2?.next).toBe("norn run view gh-12/02 --why");
    expect(v.inbox.groups.unblock.map((i) => i.slice)).toEqual(["gh-12/02"]);
  });

  test("reads specs from story worktrees beside the repo", async () => {
    const parent = tmp();
    const repo = join(parent, "app");
    mkdirSync(repo);
    const wt = join(parent, "app-worktrees", "gh-7-thing");
    writeStoryFile(
      storyFile(storyDir(wt, "gh-7", "thing")),
      { id: "gh-7", slug: "thing", provider: "gh", number: 7, url: "u", title: "Thing", assignee: null, workflow: "story", status: "new", intake_at: ago(5) },
      "",
    );
    writeUnitMarker(wt, { repo, story: "gh-7", slice: null, unit: "_story", spec_dir: ".agents/specs/gh-7-thing" });
    const v = await loadProjectView({ repoRoot: repo, home: tmp(), now: NOW, holder: "me@box", env: {} });
    expect(v.stories.map((s) => [s.key, s.status, s.root])).toEqual([["gh-7", "not_started", wt]]);
  });

  test("worktrees are found by folder shape and marker (refactor 5.2): a slice's own, a mislabelled story folder skipped", async () => {
    const parent = tmp();
    const repo = join(parent, "app");
    mkdirSync(repo);
    const fm = (n: number, slug: string) => ({ id: `gh-${n}`, slug, provider: "gh", number: n, url: "u", title: `T${n}`, assignee: null, workflow: "story", status: "active", intake_at: ago(5) }) as const;
    const wt = join(parent, "app-worktrees", "gh-7-thing");
    const spec = storyDir(wt, "gh-7", "thing");
    writeStoryFile(storyFile(spec), fm(7, "thing"), "");
    writeSliceFile(join(spec, "slices/01-login-form.md"), { id: "gh-7/01", title: "Form", depends_on: [], status: "active" }, "");
    writeUnitMarker(wt, { repo, story: "gh-7", slice: null, unit: "_story", spec_dir: ".agents/specs/gh-7-thing" });
    // the slice's worktree folder keeps the slug it was cut with; its marker names the slice
    const sliceWt = `${wt}--01-form`;
    const u1 = unitDir(storyDir(sliceWt, "gh-7", "thing"), "01-login-form");
    pinWorkflow(u1, WF);
    writeState(u1, state({ story: "gh-7", slice: "gh-7/01", unit_dir: "01-login-form", status: "parked", park: { kind: "stuck", reason: "blocked", since: ago(3), receipt_id: ASK } }));
    writeUnitMarker(sliceWt, { repo, story: "gh-7", slice: "gh-7/01", unit: "01-login-form", spec_dir: ".agents/specs/gh-7-thing" });
    // a story-shaped folder whose marker names another story is not that story's worktree
    const wrong = join(parent, "app-worktrees", "gh-8-other");
    writeStoryFile(storyFile(storyDir(wrong, "gh-9", "else")), fm(9, "else"), "");
    writeUnitMarker(wrong, { repo, story: "gh-9", slice: null, unit: "_story", spec_dir: ".agents/specs/gh-9-else" });

    const v = await loadProjectView({ repoRoot: repo, home: tmp(), now: NOW, holder: "me@box", env: {} });
    expect(v.stories.map((s) => s.key)).toEqual(["gh-7"]);
    expect(v.stories[0]?.slices.map((s) => [s.key, s.status, s.park?.reason])).toEqual([["gh-7/01", "parked", "blocked"]]);
  });

  test("the default holder is this machine's (machineHolder, R7.2): its claims are mine", async () => {
    const { repo, home } = await seed();
    const v = await loadProjectView({ repoRoot: repo, home, now: NOW, liveness: () => true, env: { USER: "me", NORN_MACHINE: "box" } });
    expect(v.holder).toBe("me@box");
    expect(v.stories[0]?.claim.state).toBe("mine");
  });

  test("never writes and stays fast", async () => {
    const { repo, home } = await seed();
    const before = [...tree(repo), ...tree(home)];
    const t0 = performance.now();
    await loadProjectView({ repoRoot: repo, home, now: NOW, holder: "me@box", env: {} });
    expect(performance.now() - t0).toBeLessThan(1000);
    expect([...tree(repo), ...tree(home)]).toEqual(before);
  });
});

describe("orient", () => {
  /** seed + a done report with notes on slice 02, and the story PR as a sync saw it */
  async function seedOrient() {
    const seeded = await seed();
    const u2 = unitDir(storyDir(seeded.repo, "gh-12", "fix-login"), "02-wire-api");
    appendReceipt(u2, receipt({ kind: "done", outcome: "done", handoff: "wired", at: ago(70), notes: [{ text: "retries are capped at 3; confirm" }, { text: "renamed fetchUser\nto loadUser", criterion: "AC2" }] }));
    writePrFacts(seeded.repo, { "gh-12": { pr: { number: 7, url: "https://x/pull/7", state: "open", is_draft: true, head_sha: "" }, observed_at: NOW - 3_600_000 } });
    return loadProjectView({ repoRoot: seeded.repo, home: seeded.home, now: NOW, holder: "me@box", liveness: () => true, env: {} });
  }

  test("StoryView carries the branch, the PR last seen and the open notes", async () => {
    const v = await seedOrient();
    const s = v.stories[0];
    expect(s?.branch).toBe("gh-12-fix-login");
    expect(s?.pr).toEqual({ number: 7, url: "https://x/pull/7", state: "open", is_draft: true, seen_at: ago(60) });
    expect(s?.notes.map((n) => [n.unit, n.text])).toEqual([
      ["gh-12/02", "retries are capped at 3; confirm"],
      ["gh-12/02", "renamed fetchUser\nto loadUser"],
    ]);
  });

  test("orientReport: slices with their steps, PR command and state, waiting items, notes by unit; formatStoryView renders it", async () => {
    const v = await seedOrient();
    expect(orientReport(v, "gh-99", "gh")).toBeNull();
    const r = orientReport(v, "gh-12/02", "glab");
    if (!r) throw new Error("unreachable");
    expect(r).toMatchObject({ key: "gh-12/02", story: "gh-12", title: "Fix login", claim: "held here", branch: "gh-12-fix-login", pr_command: "glab mr view gh-12-fix-login", note_count: 2 });
    expect(r.slices.map((s) => [s.key, s.status, s.workflow, s.step, s.attempt, s.integrated, s.depends_on])).toEqual([
      ["gh-12/01", "running", "slice", "implement", 2, false, []],
      ["gh-12/02", "done", "slice", "$done", 1, true, ["gh-12/01"]],
      ["gh-12/03", "not_started", "slice", null, null, false, ["gh-12/02"]],
    ]);
    expect(r.pr_state).toBe("draft");
    expect(r.waiting.map((w) => [w.group, w.unit, w.command])).toEqual([["answer", "gh-12", 'norn story answer gh-12 "…"']]);
    expect(r.running.map((w) => w.unit)).toEqual(["gh-12/01"]);
    expect(r.notes.map((g) => [g.unit, g.notes.length])).toEqual([["gh-12/02", 2]]);
    expect(r.look).toEqual({ spec: `${r.root}/.agents/specs/gh-12-fix-login`, trace: "norn run list gh-12/02", why: "norn run view gh-12/02 --why", status: "norn story view gh-12/02" });
    expect(prCommand("gh", "b", true)).toBe("gh pr view b --web");

    const md = formatStoryView(r, NOW);
    expect(md).toStartWith("# gh-12 — Fix login\n\n## The story\n");
    expect(md).not.toContain("> 4. Never edit code");
    expect(formatStoryView(r, NOW, { rules: true })).toContain("> 4. Never edit code, commit, or report an outcome");
    expect(md).toContain("- gh-12/02 Wire API — done, integrated · after 01 · slice\n");
    expect(md).toContain("- #7 draft, open — https://x/pull/7 (seen 1h ago)");
    expect(md).toContain("**Answer** gh-12 (implement), 40m: Which OAuth provider?\n  - `norn story answer gh-12 \"…\"`");
    expect(md).toContain("## Open notes (2)");
    expect(md).toContain("### gh-12/02 (2)\n\n- [implement] retries are capped at 3; confirm\n- [implement · AC2] renamed fetchUser\n  to loadUser\n");
  });
});

describe("formatters", () => {
  test("formatStatus and formatInbox render compact text", async () => {
    const { repo, home } = await seed();
    const v = await loadProjectView({ repoRoot: repo, home, now: NOW, holder: "me@box", liveness: () => true, env: {} });
    const status = formatStatus(v);
    expect(status).toContain("gh-12 Fix login");
    expect(status).toContain("slice · auto→manual · mine · parked implement#1 (ask: Which OAuth provider?) 40m [test_loop 0/3]");
    expect(status).toContain('→ norn story answer gh-12 "…"');
    expect(status).toContain("gh-12/01   Add form — running implement#2 30m [test_loop 1/3]");
    expect(status).toContain("gh-12/02   Wire API — done 1h integrated after 01");
    expect(status).toContain("gh-12/01   implement#2 auto claude alive");
    expect(status).toContain("1 item needs you");

    const inbox = formatInbox(v);
    expect(inbox.split("\n").slice(0, 3)).toEqual(["Answer (1) · agents waiting for your answer", "  gh-12      round 1 · slice · implement: Which OAuth provider? · 40m", '      $ norn story answer gh-12 "…"']);
    expect(inbox).toContain("Running (1) · agents and checks at work");
    expect(inbox).toContain("Recently done (1) · finished in the last 24h");
  });
});
