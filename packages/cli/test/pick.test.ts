/**
 * `norn pick`: raw keys → filter, move, act. Planning is pure (runtime/pick.ts); the command runs
 * verbs through the dispatcher, opens the PR through an outside command and orients through Herdr.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { ProjectView } from "@norn/view";
import { runCli } from "../src/index.ts";
import { filterRows, parseKeys, type PickRow, pickKey, pickRows, renderPick } from "../src/runtime/pick.ts";
import { fakeHerdr } from "./fake-herdr.ts";
import { createHarness, type Harness, issue } from "./harness.ts";

setDefaultTimeout(30_000);

describe("pick keys and planning", () => {
  test("parseKeys: arrows, enter, esc, backspace, control keys, text", () => {
    expect(parseKeys("ab\x1b[A\x1b[B\x1bOB\r\x7f\x0f\x19\x07\x14\x12\x15\x1b")).toEqual([
      { kind: "char", char: "a" },
      { kind: "char", char: "b" },
      { kind: "up" },
      { kind: "down" },
      { kind: "down" },
      { kind: "enter" },
      { kind: "backspace" },
      { kind: "ctrl-o" },
      { kind: "ctrl-y" },
      { kind: "ctrl-g" },
      { kind: "ctrl-t" },
      { kind: "ctrl-r" },
      { kind: "clear" },
      { kind: "esc" },
    ]);
  });

  const item = { id: "g", group: "approve" as const, story: "gh-1", slice: null, step: "ready", title: "Read the draft PR", command: "norn approve gh-1", since: "2026-10-25T12:00:00.000Z", age: "20h" };
  const rows: PickRow[] = [
    { kind: "item", story: "gh-1", unit: "gh-1", item, label: "approve gh-1", cols: [], text: "● approve gh-1 ready read the draft pr" },
    { kind: "story", story: "gh-1", unit: "gh-1", label: "gh-1", cols: [], text: "gh-1 todo app", unclaimed: false },
    { kind: "story", story: "gh-2", unit: "gh-2", label: "gh-2", cols: [], text: "gh-2 search", unclaimed: true },
  ];
  const opts = { provider: "gh" as const, branchOf: (s: string) => `${s}-branch` };
  const s0 = { query: "", cursor: 0, message: null };

  test("typing filters by every word; arrows stay inside the rows", () => {
    expect(filterRows(rows, "GH draft").map((r) => r.kind)).toEqual(["item"]);
    let s = pickKey(s0, { kind: "char", char: "s" }, rows, opts).state;
    expect(s.query).toBe("s");
    s = pickKey({ ...s, query: "" }, { kind: "down" }, rows, opts).state;
    s = pickKey(s, { kind: "down" }, rows, opts).state;
    s = pickKey(s, { kind: "down" }, rows, opts).state;
    expect(s.cursor).toBe(2);
    expect(pickKey(s, { kind: "backspace" }, rows, opts).state.cursor).toBe(0);
  });

  test("enter orients, ⌃o opens the PR, ⌃y approves gates only, ⌃t takes unclaimed stories only, esc quits", () => {
    expect(pickKey(s0, { kind: "enter" }, rows, opts).effect).toEqual({ kind: "orient", story: "gh-1" });
    expect(pickKey(s0, { kind: "ctrl-o" }, rows, { ...opts, provider: "glab" }).effect).toEqual({ kind: "pr", story: "gh-1", argv: ["glab", "mr", "view", "gh-1-branch", "--web"] });
    expect(pickKey(s0, { kind: "ctrl-y" }, rows, opts).effect).toEqual({ kind: "verb", argv: ["approve", "gh-1"] });
    expect(pickKey(s0, { kind: "ctrl-g" }, rows, opts).effect).toEqual({ kind: "go", item });
    const onStory = { ...s0, cursor: 1 };
    expect(pickKey(onStory, { kind: "ctrl-y" }, rows, opts)).toMatchObject({ state: { message: "⌃y approves a gate: pick an approve row" } });
    expect(pickKey(onStory, { kind: "ctrl-t" }, rows, opts)).toMatchObject({ state: { message: "gh-1 is held: nothing to take" } });
    expect(pickKey({ ...s0, cursor: 2 }, { kind: "ctrl-t" }, rows, opts).effect).toEqual({ kind: "verb", argv: ["take", "gh-2"] });
    expect(pickKey(s0, { kind: "esc" }, rows, opts).effect).toEqual({ kind: "quit" });
    expect(pickKey({ ...s0, query: "zzz" }, { kind: "enter" }, rows, opts)).toMatchObject({ state: { message: "no row selected" } });
  });
});

describe("norn pick", () => {
  let c: Harness;
  const wt = () => `${c.root}-worktrees/gh-5-pay-invoices`;
  beforeAll(async () => {
    c = await createHarness();
    expect((await c.norn("init")).exit).toBe(0);
    c.git(["add", "-A"]);
    c.git(["commit", "-q", "-m", "norn init"]);
    c.git(["push", "-q", "origin", "main"]);
    c.remote.issues = [issue(5, "Pay invoices")];
    for (let i = 0; i < 3; i++) {
      c.clock.advance(60_000);
      await c.tick();
    }
  });
  afterAll(() => c.cleanup());

  async function* keys(...ks: string[]) {
    for (const k of ks) yield k;
  }

  test("rows: the item that needs you, then the story; the frame previews the story", async () => {
    const view = { timeline: {}, ...((await runCli(["status", "--json"], c.deps)).value as Omit<ProjectView, "timeline">) };
    const rows = pickRows(view);
    expect(rows.map((r) => [r.kind, r.unit])).toEqual([
      ["item", "gh-5"],
      ["story", "gh-5"],
    ]);
    const frame = renderPick(view, rows, { query: "", cursor: 0, message: null }, { width: 140, height: 20, color: false, provider: "gh", now: c.clock.now() });
    expect(frame).toContain("▸ ▶ your turn  gh-5");
    expect(frame).toContain("│ gh-5 — Pay invoices");
    expect(frame).toContain("PR: none seen yet");
  });

  test("⌃o opens the PR in the browser and exits; enter orients through Herdr and exits; esc quits", async () => {
    const shell: string[][] = [];
    const frames: string[] = [];
    const pr = await runCli(["pick"], { ...c.deps, herdr: null, input: keys("\x1b[B", "\x0f"), shell: async (argv) => (shell.push(argv), { code: 0, stderr: "" }), log: (l) => frames.push(l) });
    expect(pr.value).toEqual({ frames: 2, action: "pr", story: "gh-5", ok: true });
    expect(shell).toEqual([["gh", "pr", "view", "gh-5-pay-invoices", "--web"]]);
    expect(frames[1]).toContain("▸ gh-5");

    const h = fakeHerdr();
    const orient = await runCli(["pick"], { ...c.deps, herdr: h.cockpit, input: keys("\r") });
    expect(orient.value).toEqual({ frames: 1, action: "orient", story: "gh-5", ok: true });
    expect(h.calls).toEqual([`open workspace ${wt()} gh-5 orient focus NORN_ORIENT=1 claude --permission-mode auto -- 'Run \`norn orient gh-5\` and follow it.'`]);

    const refused: string[] = [];
    const quit = await runCli(["pick"], { ...c.deps, herdr: null, input: keys("\x19", "\x1b"), log: (l) => refused.push(l) });
    expect(quit.value).toEqual({ frames: 2, action: "quit", ok: true });
    expect(refused[1]).toContain("⌃y approves a gate");
  });
});
