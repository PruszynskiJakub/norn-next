import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ClaimBlob, type LeaseFile, type Receipt, type UnitState, ulid } from "@norn/schema";
import {
  acquireClaim,
  appendReceipt,
  appendTrace,
  gitOk,
  leasesDir,
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
import { formatInbox, formatOrient, formatStatus, formatTimeline, loadProjectView, orientReport, prCommand, receiptSummary, stepTitle } from "../src/index.ts";

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
  await gitOk(repo, ["init", "-q", repo]);
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
  appendTrace(repo, {
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
  test("stories, slices, inbox, runs, timeline, recently done", async () => {
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
      next: 'norn answer gh-12 "…"',
    });
    expect(s.claim).toEqual({ state: "mine", holder: "me@box", expires_at: ago(-8), unclaimed: false });
    expect(s.counters).toEqual([{ name: "test_loop", value: 0, max: 3 }]);

    expect(s.slices.map((x) => [x.key, x.status, x.slice_status, x.integrated, x.depends_on])).toEqual([
      ["gh-12/01", "running", "active", false, []],
      ["gh-12/02", "done", "integrated", true, ["gh-12/01"]],
      ["gh-12/03", "not_started", "planned", false, ["gh-12/02"]],
    ]);
    const s1 = s.slices[0];
    expect(s1).toMatchObject({ title: "Add form", attempt: 2, age: "30m", next: "norn trace gh-12/01" });
    expect(s1?.counters).toEqual([{ name: "test_loop", value: 1, max: 3 }]);
    expect(s.slices[2]).toMatchObject({ workflow: "slice", step: null, attempt: null, age: null });

    expect(v.inbox.groups.answer.map((i) => i.id)).toEqual([ASK]);
    expect(v.inbox.groups.running.map((i) => i.slice)).toEqual(["gh-12/01"]);
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

    expect(v.timeline["gh-12/01"]?.map((e) => [e.source, e.kind])).toEqual([
      ["receipt", "check"],
      ["tick", "launch"],
      ["receipt", "started"],
      ["hook", "tool_use"],
    ]);
    expect(v.timeline["gh-12/01"]?.[1]?.summary).toBe("tick launch-ready-auto → launch");
    expect(v.timeline["gh-12"]?.map((e) => e.kind)).toEqual(["ask", "wait"]);
    expect(v.timeline["gh-12/03"]).toEqual([]);

    expect(v.recently_done).toEqual([{ unit: "gh-12/02", title: "Wire API", done_at: ago(60), age: "1h" }]);
    expect(JSON.parse(JSON.stringify(v))).toEqual(v);
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
    expect(v.inbox.groups.unclaimed.map((i) => i.command)).toEqual(["norn take gh-12"]);
  });

  test("corrupt state is reported, not guessed (S2)", async () => {
    const { repo, home } = await seed();
    writeFileSync(join(unitDir(storyDir(repo, "gh-12", "fix-login"), "02-wire-api"), "state.json"), "{}");
    const v = await loadProjectView({ repoRoot: repo, home, now: NOW, holder: "me@box", liveness: () => true, env: {} });
    const s2 = v.stories[0]?.slices[1];
    expect(s2?.status).toBe("corrupt");
    expect(s2?.next).toBe("norn why gh-12/02");
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

  test("orientReport: slices, PR command per provider, waiting items, notes by unit; formatOrient renders it", async () => {
    const v = await seedOrient();
    expect(orientReport(v, "gh-99", "gh")).toBeNull();
    const r = orientReport(v, "gh-12/02", "glab");
    if (!r) throw new Error("unreachable");
    expect(r).toMatchObject({ key: "gh-12/02", story: "gh-12", title: "Fix login", claim: "held here", branch: "gh-12-fix-login", pr_command: "glab mr view gh-12-fix-login", note_count: 2 });
    expect(r.slices.map((s) => [s.key, s.status, s.integrated])).toEqual([
      ["gh-12/01", "running", false],
      ["gh-12/02", "done", true],
      ["gh-12/03", "not_started", false],
    ]);
    expect(r.waiting.map((w) => [w.group, w.unit, w.command])).toEqual([["answer", "gh-12", 'norn answer gh-12 "…"']]);
    expect(r.running.map((w) => w.unit)).toEqual(["gh-12/01"]);
    expect(r.notes.map((g) => [g.unit, g.notes.length])).toEqual([["gh-12/02", 2]]);
    expect(r.look).toEqual({ spec: `${r.root}/.agents/specs/gh-12-fix-login`, trace: "norn trace gh-12/02", why: "norn why gh-12/02", status: "norn status gh-12/02" });
    expect(prCommand("gh", "b", true)).toBe("gh pr view b --web");

    const md = formatOrient(r, NOW);
    expect(md).toStartWith("# Orient: gh-12 — Fix login\n");
    expect(md).toContain("> 4. Never edit code, commit, or report an outcome");
    expect(md).toContain("- gh-12/02 Wire API — done, integrated");
    expect(md).toContain("- #7 draft, open — https://x/pull/7 (seen 1h ago)");
    expect(md).toContain("**Answer** gh-12 (implement), 40m: Which OAuth provider?\n  - `norn answer gh-12 \"…\"`");
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
    expect(status).toContain('→ norn answer gh-12 "…"');
    expect(status).toContain("gh-12/01   Add form — running implement#2 30m [test_loop 1/3]");
    expect(status).toContain("gh-12/02   Wire API — done 1h integrated after 01");
    expect(status).toContain("gh-12/01   implement#2 auto claude alive");
    expect(status).toContain("1 item needs you");

    const inbox = formatInbox(v);
    expect(inbox.split("\n").slice(0, 3)).toEqual(["Answer (1) · agents waiting for your answer", "  gh-12      implement: Which OAuth provider? · 40m", '      $ norn answer gh-12 "…"']);
    expect(inbox).toContain("Running (1) · agents and checks at work");
    expect(inbox).toContain("Recently done (1) · finished in the last 24h");
    expect(formatTimeline(v.timeline["gh-12/01"] ?? [])).toContain("check fail at test#1: bun test (exit 1, 2.3s)");
  });

  test("an item line names its step once, also when the title already starts with it (F4)", () => {
    expect(stepTitle("refine", "refine: attended step — work with the agent")).toBe("refine: attended step — work with the agent");
    expect(stepTitle("implement", "implement #2 (queued)")).toBe("implement #2 (queued)");
    expect(stepTitle("plan", "plan is ready (manual): start an agent in the worktree")).toBe("plan is ready (manual): start an agent in the worktree");
    expect(stepTitle("implement", "Which OAuth provider?")).toBe("implement: Which OAuth provider?");
    expect(stepTitle("qa", "quality check failed")).toBe("qa: quality check failed");
    expect(stepTitle(null, "done")).toBe("done");
  });

  test("formatInbox: Notes after Running, its header naming each story's clearing approval once (NT5)", () => {
    const note = (id: string, story: string, cleared_by: string) => ({ id, group: "notes", story, slice: null, step: "qa", title: `qa note on ${story}: x`, command: `norn why ${story} --receipt r`, since: "", age: "1m", cleared_by });
    const run = { id: "r", group: "running", story: "gh-3", slice: null, step: "qa", title: "qa #1 (auto)", command: "norn trace gh-3", since: "", age: "1m" };
    const notes = [note("a", "gh-1", "cleared by gh-1 human-qa approval"), note("b", "gh-1", "cleared by gh-1 human-qa approval"), note("c", "gh-2", "cleared when the story is done")];
    const v = { stories: [{}], inbox: { at: "", pending: 0, groups: { your_turn: [], answer: [], approve: [], unblock: [], check: [], unclaimed: [], running: [run], notes, recently_done: [] } } } as unknown as Parameters<typeof formatInbox>[0];
    const out = formatInbox(v).split("\n");
    expect(out.indexOf("Running (1) · agents and checks at work")).toBe(0);
    expect(out).toContain("Notes (3) · agents' notes for you, no action needed · cleared by gh-1 human-qa approval; cleared when the story is done");
    // NT6: the header line alone, with the command that lists them; `notes` lists them
    const at = out.indexOf("Notes (3) · agents' notes for you, no action needed · cleared by gh-1 human-qa approval; cleared when the story is done");
    expect(out[at + 1]).toBe("      $ norn inbox --notes");
    expect(out.some((l) => l.includes("qa note on"))).toBe(false);
    const listed = formatInbox(v, { notes: true });
    expect(listed).toContain("  gh-1       qa note on gh-1: x · 1m");
    expect(listed).not.toContain("norn inbox --notes");
  });

  test("formatInbox prints paths under home as ~/…", () => {
    const item = { id: "approve:gh-1:qa#1", group: "approve", story: "gh-1", slice: null, step: "human-qa", title: "evidence attached", command: "norn approve gh-1", since: "", age: "1m", detail: "step qa#1 reported partial (receipt 0009)", full: "Report: /Users/me/wt/runs/_story/receipts/0009-done.json" };
    const v = { inbox: { at: "", pending: 1, groups: { your_turn: [], answer: [], approve: [item], unblock: [], check: [], unclaimed: [], running: [], notes: [], recently_done: [] } } } as unknown as Parameters<typeof formatInbox>[0];
    expect(formatInbox(v, { details: true, home: "/Users/me/" })).toContain("      | Report: ~/wt/runs/_story/receipts/0009-done.json");
    expect(formatInbox(v, { details: true })).toContain("      | Report: /Users/me/wt/runs/_story/receipts/0009-done.json");
  });

  test("empty inbox and empty project", () => {
    const empty = {
      at: "",
      repo: "",
      holder: "",
      runner: null,
      heartbeat: { holder: "", last_tick_at: null, age: null, down: false },
      stories: [],
      inbox: { at: "", pending: 0, groups: { your_turn: [], answer: [], approve: [], unblock: [], check: [], unclaimed: [], running: [], notes: [], recently_done: [] } },
      runs: [],
      timeline: {},
      recently_done: [],
      errors: [],
    };
    expect(formatInbox(empty)).toBe("Inbox empty — no stories yet.\nLabel an issue `norn` (the config's `remote.label`) and assign it to yourself, then run `norn sync`.\n");
    expect(formatInbox({ ...empty, stories: [{} as never] })).toBe("Inbox empty — nothing needs you.\n");
    expect(formatStatus(empty)).toContain("No stories.");
  });

  test("receiptSummary is one line", () => {
    const r = receipt({ kind: "done", outcome: "done", handoff: "line one\nline two", findings: [{ severity: "minor", title: "x" }] });
    expect(receiptSummary(r)).toBe("done done at implement#1 (1 finding) — line one line two");
  });
});
