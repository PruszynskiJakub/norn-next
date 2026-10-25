/**
 * `norn pane` (O1 "a Herdr status pane"): renders the inbox via @norn/view, refreshing in a
 * loop, frames on the log stream (never stdout, P8), one JSON summary at exit, read only (X1).
 * `--interactive` (HC4–HC8) acts on numbered items through CLI verbs; `--next` (HC10) focuses
 * the agent that waits for its person.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { herdr } from "@norn/adapters";
import { ulid } from "@norn/schema";
import { appendTrace } from "@norn/store";
import { runCli } from "../src/index.ts";
import { createHarness, type Harness, issue } from "./harness.ts";

// whole flows over real git, several ticks each: 5 s is too tight on a loaded machine (full suite)
setDefaultTimeout(30_000);

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
  expect((await h.norn("init")).exit).toBe(0);
});
afterAll(() => h.cleanup());

describe("norn pane", () => {
  test("renders the inbox each interval, clears the screen, writes nothing", async () => {
    const before = h.git(["status", "--porcelain"]);
    const frames: string[] = [];
    const r = await runCli(["pane", "--interval", "1ms", "--max-frames", "2"], { ...h.deps, log: (l) => frames.push(l) });
    expect(r.exit).toBe(0);
    expect(r.value).toEqual({ frames: 2, interval: "1ms" });
    expect(frames).toHaveLength(2);
    for (const f of frames) {
      expect(f.startsWith("\x1b[H\x1b[2J")).toBe(true);
      expect(f).toContain("norn inbox");
      expect(f).toContain("Inbox empty");
    }
    expect(h.git(["status", "--porcelain"])).toBe(before);
  });

  test("bad --interval / --max-frames are usage errors", async () => {
    expect((await h.norn("pane", "--interval", "soon")).exit).toBe(2);
    expect((await h.norn("pane", "--max-frames", "0")).exit).toBe(2);
  });
});

/** A fake Herdr for the cockpit: fixed agents, every call recorded. */
function fakeHerdr(agents: herdr.HerdrAgent[] = []) {
  const calls: string[] = [];
  const cockpit: herdr.HerdrCockpit = {
    async listAgents() {
      return agents;
    },
    async focus(pane) {
      calls.push(`focus ${pane}`);
    },
    async label(pane, l) {
      calls.push(`label ${pane} ${l.title} ${l.state_labels.idle ?? "-"} ${l.ttl_ms}`);
    },
    async openCommand(cwd, command) {
      calls.push(`open ${cwd} ${command}`);
      return { pane_id: "w9:p1" };
    },
    async pluginLinked() {
      return null;
    },
  };
  return { cockpit, calls };
}

async function* lines(...ls: string[]) {
  for (const l of ls) yield l;
}

describe("norn pane --interactive (HC4–HC8) and --next (HC10)", () => {
  let c: Harness;
  const wt5 = () => `${c.root}-worktrees/gh-5-pay-invoices`;
  beforeAll(async () => {
    c = await createHarness();
    expect((await c.norn("init")).exit).toBe(0);
    c.git(["add", "-A"]);
    c.git(["commit", "-q", "-m", "norn init"]);
    c.git(["push", "-q", "origin", "main"]);
    c.remote.issues = [issue(5, "Pay invoices"), issue(6, "Export report")];
    for (let i = 0; i < 3; i++) {
      c.clock.advance(60_000);
      await c.tick();
    }
  });
  afterAll(() => c.cleanup());

  test("one line per command; misfits are refused, go starts a manual agent beside the cockpit", async () => {
    const h = fakeHerdr();
    const frames: string[] = [];
    const r = await runCli(["pane", "--interactive", "--interval", "1h"], {
      ...c.deps,
      herdr: h.cockpit,
      input: lines("y 1", "a 9 hi", "1", "v 2", "q"),
      log: (l) => frames.push(l),
    });
    expect(r.exit).toBe(0);
    expect(r.value).toEqual({ frames: 5, interval: "1h", interactive: true, commands: 5 });
    expect(frames[0]).toContain("[1]  gh-5");
    expect(frames[0]).toContain("[2]  gh-6");
    expect(frames[1]).toContain("[1] is not a gate (Approve)");
    expect(frames[2]).toContain("no item 9 in this frame");
    expect(frames[3]).toContain("started an agent for gh-5 in w9:p1");
    expect(h.calls).toEqual([`open ${c.root} cd ${wt5()} && claude 'Use the norn skill, then run \`norn brief\`.'`]);
    expect(frames[4]).toContain("ok: norn trace gh-6");
  });

  test("outside Herdr, go shows the command (HC8)", async () => {
    const frames: string[] = [];
    await runCli(["pane", "--interactive", "--interval", "1h"], { ...c.deps, herdr: null, input: lines("2"), log: (l) => frames.push(l) });
    expect(frames[1]).toContain("$ cd ");
    expect(frames[1]).toContain("gh-6-export-report");
  });

  test("an attended agent waiting for its person: labelled, and --next focuses its pane", async () => {
    const env = { ...c.deps.env, NORN_AGENT_PID: String(process.pid), NORN_AGENT_SESSION_ID: "sess-5" };
    const brief = await runCli(["brief", "--json"], { ...c.deps, cwd: wt5(), env });
    expect(brief.exit).toBe(0);
    const runId = (brief.value as { run_id: string }).run_id;
    c.clock.advance(1000);
    await c.tick();
    appendTrace(c.root, { type: "hook", id: ulid(c.clock.now()), fact: { event: "turn_end", at: c.clock.iso(), agent: "claude", native: "Stop", cwd: wt5(), story: "gh-5", run_id: runId, agent_session_id: "sess-5" } });
    const agents: herdr.HerdrAgent[] = [{ pane_id: "w9:p5", workspace_id: "w9", agent: "claude", status: "idle", cwd: wt5(), agent_session_id: "sess-5" }];

    // HC2: before attended_wait the agent is merely running — nothing to focus
    c.clock.advance(30_000);
    const early = await runCli(["pane", "--next"], { ...c.deps, herdr: fakeHerdr(agents).cockpit });
    expect(early.value).toEqual({ focused: null, item: null });

    c.clock.advance(3 * 60_000);
    const h = fakeHerdr(agents);
    const next = await runCli(["pane", "--next"], { ...c.deps, herdr: h.cockpit });
    expect(next.value).toMatchObject({ focused: "w9:p5", item: expect.stringMatching(new RegExp(`^attended:gh-5:${runId}:`)) });
    expect(h.calls).toEqual(["focus w9:p5"]);

    const frames: string[] = [];
    const lab = fakeHerdr(agents);
    await runCli(["pane", "--interactive", "--interval", "5s", "--max-frames", "1"], { ...c.deps, herdr: lab.cockpit, input: lines(), log: (l) => frames.push(l) });
    expect(frames[0]).toContain("refine: the agent is waiting for you");
    expect(lab.calls).toEqual(["label w9:p5 gh-5 · refine norn: your turn 15000"]);
  });
});
