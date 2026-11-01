/**
 * `norn status --watch` (B11, SPEC-cockpit CP5–CP13): raw keys over the cockpit model, every action a CLI
 * verb (X1), stays open until q; `--json` prints the model, `--pane` splits a Herdr pane for it (B12),
 * labels agent panes inside Herdr (HC12); outside a repository it shows the last one (CP13).
 * `norn run attach [<unit>] [--next]` focuses a unit's agent pane (B46, B47, HC10). `cockpit` is gone (B5).
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { herdr } from "@norn/adapters";
import { ulid } from "@norn/schema";
import { appendHookTrace, readCockpitFile, storyUnitDir } from "@norn/store";
import type { CockpitModel } from "@norn/view";
import { placeAgent } from "../../src/runtime/cockpit.ts";
import { clampScroll, handleKey, initialState, parseKeys, previewLines, renderCockpit, type TuiState, withoutNotes } from "../../src/runtime/cockpit-tui.ts";
import { fakeHerdr } from "../../../../test/support/fake-herdr.ts";
import { createHarness, FakeInteraction, type Harness, issue } from "../../../../test/support/harness.ts";
import { runChecked } from "../../../../test/support/harness.ts";

setDefaultTimeout(30_000);

async function* keys(...ks: string[]) {
  for (const k of ks) yield k;
}

let c: Harness;
const wt = (n: 5 | 6) => `${c.root}-worktrees/${n === 5 ? "gh-5-pay-invoices" : "gh-6-export-report"}`;
const runs = (n: 5 | 6) => storyUnitDir(join(wt(n), `.agents/specs/${n === 5 ? "gh-5-pay-invoices" : "gh-6-export-report"}`));
beforeAll(async () => {
  c = await createHarness();
  expect((await c.norn("init")).exit).toBe(0);
  // stories start in a workflow whose first agent step is attended (refinement: sync → refine);
  // the ticks take them in, sync them with the base and start refine
  appendFileSync(join(c.root, ".agents", "norn.config.yaml"), "default_workflow: refinement\n");
  c.git(["add", "-A"]);
  c.git(["commit", "-q", "-m", "norn init"]);
  c.git(["push", "-q", "origin", "main"]);
  c.remote.issues = [issue(5, "Pay invoices"), issue(6, "Export report")];
  for (let i = 0; i < 5; i++) {
    c.clock.advance(60_000);
    await c.tick();
  }
  // gh-6 asks a question: an Answer item
  expect((await runChecked(["brief", "--json"], { ...c.deps, cwd: wt(6), env: { ...c.deps.env, NORN_AGENT_PID: String(process.pid) } })).exit).toBe(0);
  c.clock.advance(1000);
  c.report(runs(6), "ask", { question: "CSV only, or CSV and PDF?" });
  c.clock.advance(1000);
  await c.tick();
});
afterAll(() => c.cleanup());

const model = async (h: herdr.HerdrCockpit | null = null) => (await runChecked(["status", "--watch", "--json"], { ...c.deps, herdr: h })).value as CockpitModel;

describe("norn status --watch --json (CP5)", () => {
  test("prints the model once: what needs you, then every story; no places outside Herdr", async () => {
    const m = await model();
    expect(m.rows.map((r) => [r.kind, r.group, r.unit])).toEqual([
      ["item", "your_turn", "gh-5"],
      ["item", "answer", "gh-6"],
      ["story", null, "gh-5"],
      ["story", null, "gh-6"],
    ]);
    expect(m.rows[1]?.actions.map((a) => a.key)).toEqual(["enter", "a", "v", "i"]);
    expect(m.rows.flatMap((r) => r.actions).some((a) => a.effect.kind === "place")).toBe(false);
    expect((await model(fakeHerdr().cockpit)).rows[0]?.actions[0]?.effect).toEqual({ kind: "place", place: "orient", story: "gh-5" });
  });
});

describe("keys (CP7)", () => {
  test("parseKeys: arrows, pages, enter, esc, backspace, letters, ⌃c", () => {
    expect(parseKeys("j\x1b[A\x1b[B\x1b[5~\x1b[6~\r\x7f\x15\x04\x1b\x03")).toEqual([
      { kind: "char", char: "j" },
      { kind: "up" },
      { kind: "down" },
      { kind: "pgup" },
      { kind: "pgdn" },
      { kind: "enter" },
      { kind: "backspace" },
      { kind: "clear" },
      { kind: "scroll-down" },
      { kind: "esc" },
      { kind: "quit" },
    ]);
  });

  test("move, filter, a key the row lacks, the prompt of an action that takes text", async () => {
    const m = await model();
    const press = (s: TuiState, ...ks: string[]) => {
      let st = s;
      let effect: ReturnType<typeof handleKey>["effect"];
      for (const k of ks.flatMap(parseKeys)) ({ state: st, effect } = handleKey(st, k, m));
      return { st, effect };
    };
    expect(press(initialState(), "j").st.selected).toBe(m.rows[1]?.id as string);
    // the filter keeps rows where every word appears; enter keeps it, esc clears it
    const f = press(initialState(), "/", "export", "\r").st;
    expect(f.filter).toBe("export");
    expect(press(f, "j").st.selected).toBe("story:gh-6");
    expect(press(f, "\x1b").st.filter).toBe("");
    // y on an Answer item: refused, nothing runs
    const y = press(initialState(), "j", "y");
    expect(y.effect).toBeUndefined();
    expect(y.st.message?.text).toStartWith("no y here: gh-6 offers enter orient, a answer");
    // a opens the prompt; empty enter is refused; text then enter runs the answer
    const p = press(initialState(), "j", "a");
    expect(p.st.prompt).toEqual({ row: m.rows[1]?.id as string, action: "answer", text: "" });
    expect(press(p.st, "\r").st.message?.text).toBe("Your answer: type something first");
    const sent = press(p.st, "CSV only", "\r");
    expect(sent.effect).toMatchObject({ kind: "run", action: { id: "answer" }, input: "CSV only" });
    expect(press(p.st, "x", "\x1b").st.prompt).toBeNull();
    expect(press(initialState(), "q").effect).toEqual({ kind: "quit" });
  });

  test("the frame: rows by section, the preview, the selected row's keys", async () => {
    const frame = renderCockpit(await model(), initialState(), { width: 140, height: 24, color: false, now: c.clock.now(), clock: "12:00" });
    expect(frame).toContain("NEEDS YOU");
    expect(frame).toContain("STORIES");
    expect(frame).toMatch(/▸ ▶ your turn {2}gh-5/);
    expect(frame).toContain("│ gh-5 — Pay invoices");
    expect(frame).toContain("enter orient · v trace · i issue · / filter · ? keys · q quit");
    expect(frame.split("\n")).toHaveLength(23);
  });
});

describe("the preview (CP3)", () => {
  test("sections, one line per slice, every line within the column; a gate's notes only under NOTES", async () => {
    const m = await model();
    const row = m.rows[1] as CockpitModel["rows"][number];
    const lines = previewLines(row, c.clock.now(), 50);
    expect(lines[0]).toBe("gh-6 — Export report");
    expect(lines).toContain("LINKS");
    expect(lines.some((l) => l.startsWith("NOTES "))).toBe(true);
    expect(lines.every((l) => l.length <= 50)).toBe(true);
    expect(withoutNotes("step open-pr#1 reported done (receipt 0048) · open notes (approve acknowledges them): gh-1/01 …")).toBe("step open-pr#1 reported done (receipt 0048)");
    expect(withoutNotes("Report:\n/path\n\nOpen notes (approve acknowledges them):\n- a")).toBe("Report:\n/path");
    expect(withoutNotes("no notes here")).toBe("no notes here");
  });

  test("⌃d / ⌃u scroll the preview, kept within what it holds; moving resets it", async () => {
    const m = await model();
    const look = { width: 140, height: 12, color: false, now: c.clock.now(), clock: "12:00" };
    let s = initialState();
    for (let i = 0; i < 20; i++) s = clampScroll(m, handleKey(s, { kind: "scroll-down" }, m).state, look);
    expect(s.scroll).toBeGreaterThan(0);
    expect(clampScroll(m, handleKey(s, { kind: "scroll-down" }, m).state, look).scroll).toBe(s.scroll);
    expect(handleKey(s, { kind: "clear" }, m).state.scroll).toBe(Math.max(0, s.scroll - 10));
    expect(handleKey(s, { kind: "down" }, m).state.scroll).toBe(0);
    expect(renderCockpit(m, s, look)).toContain("⌃d/⌃u scroll");
  });

  test("the mouse wheel: over the preview it scrolls, over the list it moves the selection; other buttons do nothing", async () => {
    const m = await model();
    const look = { width: 140, height: 12, color: false, now: c.clock.now(), clock: "12:00" };
    expect(parseKeys("\x1b[<65;100;5M\x1b[<64;10;5M\x1b[<0;10;5M\x1b[<0;10;5mj")).toEqual([
      { kind: "wheel", dir: "down", x: 100 },
      { kind: "wheel", dir: "up", x: 10 },
      { kind: "char", char: "j" },
    ]);
    const down = handleKey(initialState(), { kind: "wheel", dir: "down", x: 100 }, m, look).state;
    expect(down.scroll).toBe(3);
    expect(handleKey(down, { kind: "wheel", dir: "up", x: 100 }, m, look).state.scroll).toBe(0);
    const moved = handleKey(initialState(), { kind: "wheel", dir: "down", x: 10 }, m, look).state;
    expect(moved.selected).toBe(m.rows[1]?.id as string);
    expect(moved.scroll).toBe(0);
  });
});

describe("norn status --watch (B11, CP6–CP8)", () => {
  test("a session: trace shown, answer typed and sent, a refused key, quit; stays open after each action", async () => {
    const frames: string[] = [];
    const r = await runChecked(["status", "--watch", "--interval", "1h"], { ...c.deps, herdr: null, env: { ...c.deps.env, COLUMNS: "160", LINES: "40" }, input: keys("j", "v", "\x1b", "y", "a", "CSV only\r", "q"), log: (l) => frames.push(l) });
    expect(r.exit).toBe(0);
    expect(r.value).toEqual({ frames: 7, last: { action: "answer", unit: "gh-6", ok: true } });
    expect(frames[2]).toContain("norn run list gh-6 — esc to close");
    expect(frames[4]).toContain("no y here: gh-6");
    expect(frames[5]).toContain("Your answer (answer gh-6):");
    expect(frames[6]).toContain("ok: norn story answer gh-6");
    await c.tick(); // the answer receipt is applied by the tick (S5)
    expect(c.state(runs(6))?.park).toBeNull();
  });

  test("SIGINT/SIGTERM end it (CP6): the abort signal stops the loop while it waits", async () => {
    const abort = new AbortController();
    async function* waiting() {
      await new Promise(() => {}); // the person types nothing
      yield "";
    }
    // abort once the first frame is out and the loop waits — a wall-clock timer raced the first
    // frame on a loaded machine (parallel tier) and stopped the loop before it drew anything
    const log = () => void setTimeout(() => abort.abort(), 0);
    // fallback: no frame logged (the view threw) still ends the loop well inside the test timeout,
    // so the frames assertion fails instead of a timeout with the 1h interval timer left behind
    const fallback = setTimeout(() => abort.abort(), 10_000);
    try {
      const r = await runChecked(["status", "--watch", "--interval", "1h"], { ...c.deps, herdr: null, signal: abort.signal, input: waiting(), log });
      expect(r.exit).toBe(0);
      expect(r.value).toEqual({ frames: 1, last: null });
    } finally {
      clearTimeout(fallback);
    }
  });

  test("enter orients through Herdr; o and i open links with the platform opener", async () => {
    const h = fakeHerdr();
    const shell: string[][] = [];
    const frames: string[] = [];
    await runChecked(["status", "--watch", "--interval", "1h"], { ...c.deps, herdr: h.cockpit, input: keys("\r", "i", "q"), shell: async (argv) => (shell.push(argv), { code: 0, stderr: "" }), log: (l) => frames.push(l) });
    expect(h.calls[0]).toMatch(new RegExp(`^open workspace ${wt(5)} gh-5 orient focus `));
    expect(frames[1]).toContain("opened gh-5 orient (w9)");
    expect(shell).toEqual([[process.platform === "darwin" ? "open" : "xdg-open", "https://github.com/o/r/issues/5"]]);
  });

  test("outside a repository it shows the last one a cockpit ran in (CP13)", async () => {
    expect(readCockpitFile(c.home).last_repo).toBe(c.root);
    const away = mkdtempSync(join(tmpdir(), "norn-away-"));
    try {
      const r = await runChecked(["status", "--watch", "--json"], { ...c.deps, cwd: away, herdr: null });
      expect(r.exit).toBe(0);
      expect((r.value as CockpitModel).header.repo).toBe(c.root);
      // a git repository norn was never set up in: the last one too
      c.git(["init", "-q", away]);
      expect(((await runChecked(["status", "--watch", "--json"], { ...c.deps, cwd: away, herdr: null })).value as CockpitModel).header.repo).toBe(c.root);
    } finally {
      rmSync(away, { recursive: true, force: true });
    }
  });

  test("norn pane and norn pick are gone (CP10)", async () => {
    for (const name of ["pane", "pick"]) expect((await c.norn(name)).value).toMatchObject({ code: "unknown_command" });
  });

  test("status --json stays the inbox (B10); --interval needs a duration", async () => {
    expect((await c.norn("status", "--json")).value).toMatchObject({ groups: expect.any(Object) });
    const bad = await c.norn("status", "--watch", "--interval", "soon");
    expect(bad.exit).toBe(2);
    expect(bad.value).toMatchObject({ error: "bad --interval 'soon' (use e.g. 5s, 1m)", do_instead: "norn status --watch --interval 5s" });
    for (const flag of [["--pane"], ["--interval", "5s"]]) expect((await c.norn("status", ...flag, "--json")).value).toMatchObject({ error: `${flag[0]} needs --watch`, do_instead: "norn status --watch" });
  });

  test("norn cockpit, with any flags, is an unknown command (B5)", async () => {
    for (const args of [["cockpit"], ["cockpit", "--json"], ["cockpit", "--next"], ["cockpit", "--open"]]) {
      const r = await c.norn(...args);
      expect(r.exit).toBe(2);
      expect(r.value).toMatchObject({ error: "Unknown command: cockpit", code: "unknown_command", do_instead: expect.stringContaining("norn help") });
    }
  });
});

describe("norn status --watch --pane (B12)", () => {
  test("inside Herdr: a pane split below the caller runs the cockpit", async () => {
    const h = fakeHerdr();
    const r = await runChecked(["status", "--watch", "--pane", "--json"], { ...c.deps, herdr: h.cockpit });
    expect(r.exit).toBe(0);
    expect(r.value).toEqual({ opened: true, runner: "herdr", pane_id: "w9:p2" });
    expect(h.calls).toEqual([`open below ${c.root} norn status --watch norn`]);
    await runChecked(["status", "--watch", "--pane", "--interval", "10s"], { ...c.deps, herdr: h.cockpit });
    expect(h.calls[1]).toBe(`open below ${c.root} norn status --watch --interval 10s norn`);
  });

  test("outside Herdr: refused with the reason, do_instead norn status --watch", async () => {
    const r = await runChecked(["status", "--watch", "--pane", "--json"], { ...c.deps, herdr: null });
    expect(r.exit).toBe(3);
    expect(r.value).toMatchObject({ error: expect.stringContaining("not inside Herdr"), do_instead: "norn status --watch", code: "not_in_herdr" });
  });

  test("--pane is listed in norn help status", async () => {
    expect((await c.norn("help", "status")).stdout).toContain("--pane");
  });
});

describe("run attach (B46, B47, HC10), labels (HC12) and the agent place (HC6, HC15)", () => {
  test("an attended agent waiting for its person: run attach focuses its pane; the cockpit labels it", async () => {
    const env = { ...c.deps.env, NORN_AGENT_PID: String(process.pid), NORN_AGENT_SESSION_ID: "sess-5" };
    const brief = await runChecked(["brief", "--json"], { ...c.deps, cwd: wt(5), env });
    expect(brief.exit).toBe(0);
    const runId = (brief.value as { run_id: string }).run_id;
    c.clock.advance(1000);
    await c.tick();
    appendHookTrace(c.root, { story: "gh-5" }, { type: "hook", id: ulid(c.clock.now()), fact: { event: "turn_end", at: c.clock.iso(), agent: "claude", native: "Stop", cwd: wt(5), story: "gh-5", run_id: runId, agent_session_id: "sess-5" } });
    const agents: herdr.HerdrAgent[] = [{ pane_id: "w9:p5", workspace_id: "w9", agent: "claude", status: "idle", cwd: wt(5), agent_session_id: "sess-5" }];

    c.clock.advance(30_000);
    // B47: no Your turn agent yet → nothing to attach
    const none = await runChecked(["run", "attach", "--next", "--json"], { ...c.deps, herdr: fakeHerdr(agents).cockpit });
    expect(none.exit).toBe(3);
    expect(none.value).toMatchObject({ code: "nothing_to_attach" });

    c.clock.advance(3 * 60_000);
    const h = fakeHerdr(agents);
    const next = await runChecked(["run", "attach", "--next", "--json"], { ...c.deps, herdr: h.cockpit });
    expect(next.exit).toBe(0);
    expect(next.value).toMatchObject({ focused: "w9:p5", item: expect.stringMatching(new RegExp(`^attended:gh-5:${runId}:`)) });
    expect(h.calls).toEqual(["focus w9:p5"]);

    // B46: by unit — its live pane is focused; a unit with no live pane is refused with its start command
    const byUnit = fakeHerdr(agents);
    const att = await runChecked(["run", "attach", "gh-5", "--json"], { ...c.deps, herdr: byUnit.cockpit });
    expect(att.exit).toBe(0);
    expect(att.value).toMatchObject({ unit: "gh-5", focused: "w9:p5" });
    expect(byUnit.calls).toEqual(["focus w9:p5"]);
    const gone = await runChecked(["run", "attach", "gh-5", "--json"], { ...c.deps, herdr: fakeHerdr([]).cockpit });
    expect(gone.exit).toBe(3);
    expect(gone.value).toMatchObject({ code: "nothing_to_attach", do_instead: expect.stringContaining(wt(5)) });
    const answer = await runChecked(["run", "attach", "gh-6", "--json"], { ...c.deps, herdr: fakeHerdr(agents).cockpit });
    expect(answer.value).toMatchObject({ code: "nothing_to_attach", error: expect.stringContaining("gh-6") });
    // outside Herdr there is no pane to focus
    expect((await runChecked(["run", "attach", "gh-5", "--json"], { ...c.deps, herdr: null })).value).toMatchObject({ code: "nothing_to_attach" });

    // without a target: only units with a live pane are offered (B57), a script is refused with them (B60)
    const ask = new FakeInteraction();
    const picked = await runChecked(["run", "attach"], { ...c.deps, herdr: fakeHerdr(agents).cockpit, interaction: ask });
    expect(picked.exit).toBe(0);
    expect(ask.picks.map((q) => q.choices.map((ch) => ch.value))).toEqual([["gh-5"]]);
    const script = await runChecked(["run", "attach", "--json"], { ...c.deps, herdr: fakeHerdr(agents).cockpit });
    expect(script.exit).toBe(2);
    expect(script.value).toMatchObject({ code: "target_required", do_instead: "norn run attach gh-5" });
    expect((await runChecked(["run", "attach", "--json"], { ...c.deps, herdr: fakeHerdr([]).cockpit })).value).toMatchObject({ code: "no_target" });

    const lab = fakeHerdr(agents);
    await runChecked(["status", "--watch", "--interval", "5s"], { ...c.deps, herdr: lab.cockpit, input: keys("g", "q") });
    expect(lab.calls).toEqual(["label w9:p5 gh-5 · refine norn: your turn 15000", "focus w9:p5"]);
  });

  test("placeAgent: the pane, else the one workspace in the worktree; never a guess", async () => {
    const reach = { worktree: "/wt/gh-5", agent_session_id: null, pane_id: null };
    const ws = (id: string, ...cwds: string[]): herdr.HerdrWorkspace => ({ workspace_id: id, label: id, pane_ids: cwds.map((_, i) => `${id}:p${i + 1}`), cwds });
    const one = fakeHerdr([], [ws("w1", "/repo"), ws("w2", "/wt/gh-5/src")]);
    expect(await placeAgent(one.cockpit, reach, "gh-5")).toBe("focused workspace w2 (gh-5)");
    const two = fakeHerdr([], [ws("w2", "/wt/gh-5"), ws("w3", "/wt/gh-5")]);
    expect(await placeAgent(two.cockpit, reach, "gh-5")).toBe("no single agent pane or workspace found for gh-5");
    expect(two.calls).toEqual([]);
  });
});
