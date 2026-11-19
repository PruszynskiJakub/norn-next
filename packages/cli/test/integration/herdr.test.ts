/**
 * Agents in the herdr runner through the CLI alone, every norn call a subprocess of the binary from
 * source and herdr the fake on PATH (fixtures/fake-herdr), whose panes run the agent for real: one
 * workspace per story, one tab per run in the unit's worktree, each kept once its run ended, a
 * permission prompt and a pane dialog answered from
 * `norn story answer` as keys pressed once, doctor with a herdr that answers nothing, and init inside
 * herdr. The last block runs the same story against a real herdr, only under NORN_TEST_HERDR=1 and in
 * a named herdr session of its own; it covers workspaces and tabs only, as the permission and trust
 * prompts take a real Claude Code to draw them.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { nodeExec } from "@norn/host-node";
import { fakeGh } from "./fake-gh.ts";
import { editPane, fakeHerdr, type HerdrState, herdrCalls, herdrCallsOf, herdrState, typedInto } from "./fake-herdr.ts";
import { machineOf, type NornOut, noteOf, norn, plans, setUp, sh, TEST_PLUGIN, unitOf, type World, world } from "./world.ts";

const KEY = "lt-1";
const SLOW = 180_000;
/** The line a terminal reads at once on macOS: a `pane run` longer than this is cut off. */
const LINE_MAX = 1024;

/** One agent step, then the story is done. */
const SOLO = ["name: solo", "start: build", "steps:", "  build:", "    agent: Build the thing.", "    outcomes: { done: $done }", ""].join("\n");
/** A step worked on beside a person, then one nobody sits beside. */
const DUO = [
  "name: duo",
  "start: design",
  "steps:",
  "  design:",
  "    agent: Design the thing with the person.",
  "    attended: true",
  "    outcomes: { done: build }",
  "  build:",
  "    agent: Build the thing.",
  "    outcomes: { done: $done }",
  "",
].join("\n");

/** Claude Code's permission prompt as its pane shows it: a numbered menu of three. */
const PERMISSION_SCREEN = ["Bash command", "", "  rm -rf build", "", "Do you want to proceed?", "❯ 1. Yes", "  2. Yes, and don't ask again for rm commands", "  3. No, and tell Claude what to do differently (esc)", ""].join("\n");
/** Claude Code's folder trust prompt since 2.1: a menu with no numbers, its cursor on yes. */
const TRUST_SCREEN = ["Do you trust the files in this folder?", "", "❯ Yes, proceed", "  No, exit", "", "Enter to confirm · Esc to cancel", ""].join("\n");

interface UnitSeen {
  id: string;
  step: string | null;
  ended?: string;
  parked?: string;
  run: { id: string } | null;
  waiting: { for: string; text: string; next?: string } | null;
}

interface Outcome {
  decision: { rule: string };
  ok: boolean;
  error?: string;
}

/** Every rule the ticks fired (a failed action marked `!`), and what herdr held after each tick. */
class Ticks {
  readonly rules: string[] = [];
  readonly errors: string[] = [];
  readonly after: HerdrState[] = [];
  constructor(
    private readonly w: World,
    private readonly look: (w: World) => HerdrState | null = herdrState,
  ) {}

  async once(): Promise<NornOut> {
    const t = await norn(this.w, ["tick", "--json"]);
    const outcomes = (t.body.outcomes ?? []) as Outcome[];
    this.rules.push(...outcomes.map((o) => `${o.decision.rule}${o.ok ? "" : "!"}`));
    // a commit that lost the race to the agent's own receipt is decided again by the next tick
    this.errors.push(...outcomes.flatMap((o) => (o.ok || o.error === undefined || o.error.includes("the record moved since facts were read") ? [] : [o.error])));
    const seen = this.look(this.w);
    if (seen) this.after.push(seen);
    return t;
  }

  async until(done: (u: UnitSeen | null) => boolean, maxMs = 60_000): Promise<UnitSeen | null> {
    for (const until = performance.now() + maxMs; performance.now() < until; ) {
      await this.once();
      const u = (await unitOf(this.w, KEY)) as UnitSeen | null;
      if (done(u)) return u;
      await Bun.sleep(200);
    }
    throw new Error(`no convergence; rules: ${this.rules.join(", ")}; errors: ${this.errors.join(" | ")}; unit: ${JSON.stringify(await unitOf(this.w, KEY))}`);
  }
}

/** The tab labels of each herdr state the ticks left, a change at a time, from the first tab opened. */
function tabTimeline(states: HerdrState[]): string[][] {
  const out: string[][] = [];
  for (const s of states) {
    const labels = s.tabs.map((t) => t.label);
    if (out.length === 0 && labels.length === 0) continue;
    if (JSON.stringify(out.at(-1)) !== JSON.stringify(labels)) out.push(labels);
  }
  return out;
}

/** A PATH of 2 KB, as a person's with many tools on it: a launch typed whole would pass the line limit. */
function padPath(w: World): void {
  const base = w.env.PATH ?? process.env.PATH ?? "";
  w.env.PATH = `${base}:${Array.from({ length: 64 }, (_, i) => `/opt/norn-test/padding/tool-${String(i).padStart(2, "0")}/bin`).join(":")}`;
}

/** A herdr world: the fake on PATH, the test plugin's harness in the herdr runner. */
async function herdrWorld(plan: Parameters<typeof world>[0], opts: Parameters<typeof setUp>[1] = {}): Promise<{ w: World; machine: string }> {
  const w = await world(plan);
  fakeHerdr(w);
  const { added } = await setUp(w, { runner: "herdr", ...opts });
  return { w, machine: machineOf(added) };
}

describe("one herdr workspace per story, one tab per run", () => {
  let w: World;
  let worktree: string;
  let ticks: Ticks;
  let parked: UnitSeen | null;
  let callsWhileParked: string[][] = [];
  let started: NornOut;
  let ended: UnitSeen | null;
  let calls: string[][] = [];
  let atEnd: HerdrState;

  beforeAll(async () => {
    w = await world("work");
    fakeHerdr(w);
    padPath(w);
    const { added } = await setUp(w, { runner: "herdr", workflow: "duo", workflows: { duo: DUO } });
    worktree = join(machineOf(added), "worktrees", KEY);
    plans(w, { design: "attended", build: "work" });
    ticks = new Ticks(w);
    await norn(w, ["story", "create", "Build it in herdr", "--json"]);
    parked = await ticks.until((u) => u?.parked !== undefined);
    callsWhileParked = herdrCalls(w).filter((c) => c[0] !== "--version");
    started = await norn(w, ["run", "start", KEY, "--json"]);
    ended = await ticks.until((u) => u?.ended !== undefined);
    calls = herdrCalls(w);
    atEnd = herdrState(w);
  }, SLOW);

  test("an attended step parks with no pane opened until a person starts it", () => {
    expect(parked).toMatchObject({ step: "design", parked: "agent.ready.attended" });
    expect(callsWhileParked).toEqual([]);
    expect(started.code).toBe(0);
  });

  test("the story ends done, each run's agent working in its pane", () => {
    expect(ended?.ended).toBe("done");
    expect(noteOf(w, "done")).toMatchObject({ code: 0 });
    expect(ticks.errors).toEqual([]);
  });

  test("the story's runs share one workspace labelled with its key, each in a tab named by unit and step", () => {
    expect(herdrCallsOf(calls, "workspace create")).toHaveLength(1);
    expect(herdrCallsOf(calls, "workspace create")[0]).toEqual(expect.arrayContaining(["--label", KEY]));
    const tabCreates = herdrCallsOf(calls, "tab create");
    expect(tabCreates).toHaveLength(1);
    const ws = atEnd.workspaces;
    expect(ws.map((x) => x.label)).toEqual([KEY]);
    expect(tabCreates[0]).toEqual(expect.arrayContaining(["--workspace", ws[0]?.workspace_id, "--label", `${KEY} build`]));
    for (const s of ticks.after) expect(s.workspaces.filter((x) => x.label === KEY).length).toBeLessThanOrEqual(1);
  });

  test("tabs go design, then design and build, and both stay once the build run ended: herdr closes a workspace with its last pane", () => {
    expect(tabTimeline(ticks.after)).toEqual([[`${KEY} design`], [`${KEY} design`, `${KEY} build`]]);
    expect(herdrCallsOf(calls, "pane close")).toEqual([]);
  });

  test("every pane opens in the story's worktree under the machine dir", () => {
    const real = realpathSync(worktree);
    const cwds = [...herdrCallsOf(calls, "workspace create"), ...herdrCallsOf(calls, "tab create")].map((c) => c[c.indexOf("--cwd") + 1]);
    expect(cwds).toEqual([real, real]);
    expect(atEnd.panes.map((p) => p.cwd)).toEqual([real, real]);
  });

  test("the line typed into a pane stays under a terminal line though PATH is 2 KB", () => {
    expect((w.env.PATH ?? "").length).toBeGreaterThan(2048);
    const runs = herdrCallsOf(calls, "pane run");
    expect(runs).toHaveLength(2);
    for (const r of runs) {
      expect(Buffer.byteLength(r[3] as string)).toBeLessThan(LINE_MAX);
      expect(r[3]).toMatch(/^sh \S+\.sh$/);
    }
    // the agent still ran with the whole PATH: its norn is this build
    expect(noteOf(w, "norn")).toMatch(/norn$/);
  });
});

describe("a permission prompt in a herdr pane, answered from story answer", () => {
  let w: World;
  let worktree: string;
  let pane: string;
  let ticks: Ticks;
  let first: UnitSeen | null;
  let headAtFirst: string;
  let mergeHeadAtFirst: boolean;
  let wrong: NornOut;
  let typedAfterWrong: string;
  let wrongTicks: string[] = [];
  let answered: NornOut;
  let typedAfterAnswer: string;
  let typedAfterNextTick: string;
  let second: UnitSeen | null;
  let headAtSecond: string;
  let mergeHeadAtSecond: boolean;
  let ended: UnitSeen | null;

  const mergeHead = async () => existsSync(await sh(worktree, "git", "rev-parse", "--path-format=absolute", "--git-path", "MERGE_HEAD"));
  /** herdr reads Claude Code's prompt off the screen, so the pane shows the agent blocked on it */
  const showPrompt = () =>
    editPane(w, pane, (p) => {
      p.status = "blocked";
      p.screen = PERMISSION_SCREEN;
    });

  beforeAll(async () => {
    let machine: string;
    ({ w, machine } = await herdrWorld("permission", { workflow: "solo", workflows: { solo: SOLO } }));
    worktree = join(machine, "worktrees", KEY);
    ticks = new Ticks(w);
    await norn(w, ["story", "create", "Clean the build", "--json"]);
    first = await ticks.until((u) => u?.waiting?.for === "permission");
    pane = herdrState(w).panes[0]?.pane_id as string;
    showPrompt();
    headAtFirst = await sh(worktree, "git", "rev-parse", "HEAD");
    mergeHeadAtFirst = await mergeHead();

    wrong = await norn(w, ["story", "answer", KEY, "9", "--json"]);
    const from = ticks.rules.length;
    await ticks.once();
    wrongTicks = ticks.rules.slice(from);
    typedAfterWrong = typedInto(w, pane);

    answered = await norn(w, ["story", "answer", KEY, "1", "--json"]);
    await ticks.once();
    typedAfterAnswer = typedInto(w, pane);
    await ticks.once();
    typedAfterNextTick = typedInto(w, pane);

    second = await ticks.until((u) => u?.waiting?.for === "permission" && u.waiting.text.includes("rm -rf dist"));
    headAtSecond = await sh(worktree, "git", "rev-parse", "HEAD");
    mergeHeadAtSecond = await mergeHead();
    showPrompt();
    await norn(w, ["story", "answer", KEY, "1", "--json"]);
    ended = await ticks.until((u) => u?.ended !== undefined);
  }, SLOW);

  test("the prompt parks the unit waiting on permission, naming the call and the answer command", () => {
    expect(first).toMatchObject({ step: "build", waiting: { for: "permission" } });
    expect(first?.waiting?.text).toContain("Bash(rm -rf build)");
    expect(first?.waiting?.next).toContain(`norn story answer ${KEY}`);
  });

  test("an agent parked mid-merge keeps its merge: HEAD unmoved and MERGE_HEAD in place at each park", () => {
    const merging = noteOf(w, "merging") as { head: string };
    expect(headAtFirst).toBe(merging.head);
    expect(mergeHeadAtFirst).toBe(true);
    expect(headAtSecond).toBe(merging.head);
    expect(mergeHeadAtSecond).toBe(true);
  });

  test("an option the prompt does not show is refused with exit 3, and nothing is typed", () => {
    expect(wrong.code).toBe(3);
    expect(wrong.body).toMatchObject({ code: "not_an_option" });
    expect(typedAfterWrong).toBe("");
    expect(wrongTicks.filter((r) => r.endsWith("!"))).toEqual([]);
  });

  test("the answer is pressed as keys by the next tick, once", () => {
    expect(answered.code).toBe(0);
    expect(typedAfterAnswer).toBe("1<enter>");
    expect(typedAfterNextTick).toBe("1<enter>");
    expect(noteOf(w, "keys.t-rm")).toBe("1<enter>");
  });

  test("the agent's next prompt parks the unit again, and its answer lets the story end done", () => {
    expect(second?.waiting?.text).toContain("Bash(rm -rf dist)");
    expect(noteOf(w, "keys.t-rm2")).toBe("1<enter>1<enter>");
    expect(ended?.ended).toBe("done");
    expect(ticks.errors).toEqual([]);
  });
});

describe("a dialog in a herdr pane before the agent's first event", () => {
  let w: World;
  let pane: string;
  let ticks: Ticks;
  let parked: UnitSeen | null;
  let rulesToPark: string[] = [];
  let wrong: NornOut;
  let typedAfterWrong: string;
  let answered: NornOut;
  let typedAfterAnswer: string;
  let typedAfterNextTick: string;
  let ended: UnitSeen | null;

  beforeAll(async () => {
    const pre = await world("trust");
    // Claude Code takes what is typed into its pane, so the harness says it does too
    pre.env.TEST_PANE_INPUT = "1";
    fakeHerdr(pre);
    await setUp(pre, { runner: "herdr", workflow: "solo", workflows: { solo: SOLO } });
    w = pre;
    ticks = new Ticks(w);
    await norn(w, ["story", "create", "Trust the folder", "--json"]);
    await ticks.until((u) => u?.run !== null && u?.run !== undefined);
    pane = herdrState(w).panes[0]?.pane_id as string;
    editPane(w, pane, (p) => {
      p.status = "blocked";
      p.screen = TRUST_SCREEN;
    });
    const from = ticks.rules.length;
    parked = await ticks.until((u) => u?.waiting !== null && u?.waiting !== undefined, 20_000);
    rulesToPark = ticks.rules.slice(from);

    wrong = await norn(w, ["story", "answer", KEY, "9", "--json"]);
    await ticks.once();
    typedAfterWrong = typedInto(w, pane);
    answered = await norn(w, ["story", "answer", KEY, "yes", "--json"]);
    await ticks.once();
    typedAfterAnswer = typedInto(w, pane);
    await ticks.once();
    typedAfterNextTick = typedInto(w, pane);
    ended = await ticks.until((u) => u?.ended !== undefined);
  }, SLOW);

  test("the dialog parks the unit at the next tick, quoting it, with no silent window waited out", () => {
    expect(rulesToPark).toEqual(["agent.no_events.park"]);
    expect(parked).toMatchObject({ waiting: { for: "permission" } });
    expect(parked?.waiting?.text).toContain("Do you trust the files in this folder?");
    expect(parked?.waiting?.next).toContain(`norn story answer ${KEY} yes`);
  });

  test("an option the dialog does not show is refused with exit 3, and nothing is typed", () => {
    expect(wrong.code).toBe(3);
    expect(wrong.body).toMatchObject({ code: "not_an_option" });
    expect(typedAfterWrong).toBe("");
  });

  test("yes is pressed on the option that says yes, once, and the agent goes on to done", () => {
    expect(answered.code).toBe(0);
    // the cursor already stands on yes: enter alone confirms it
    expect(typedAfterAnswer).toBe("<enter>");
    expect(typedAfterNextTick).toBe("<enter>");
    expect(noteOf(w, "trusted")).toBe("<enter>");
    expect(ended?.ended).toBe("done");
  });
});

interface DoctorSeen {
  ok: boolean;
  checks: { name: string; ok: boolean; skipped?: true; code?: string; do_instead?: string | null }[];
}

/**
 * A herdr that answers nothing is a failed check in either mode, never a warning: in manual mode the
 * tick opens no pane, but `norn run start` still launches the agent in herdr, so the first start a
 * person makes would fail where doctor said all was well.
 */
describe("doctor with a herdr that answers nothing", () => {
  const seen: Record<string, { code: number; body: DoctorSeen }> = {};

  beforeAll(async () => {
    const { w } = await herdrWorld("work");
    const dead = join(w.dir, "dead-herdr-bin");
    mkdirSync(dead, { recursive: true });
    writeFileSync(join(dead, "herdr"), "#!/bin/sh\necho 'herdr: cannot reach the herdr server' >&2\nexit 1\n");
    chmodSync(join(dead, "herdr"), 0o755);
    w.env.PATH = `${dead}:${w.env.PATH ?? ""}`;
    for (const mode of ["auto", "manual"]) {
      const set = await norn(w, ["config", "set", "kernel.mode", mode, "--json"]);
      if (set.code !== 0) throw new Error(`config set kernel.mode: ${set.stdout}${set.stderr}`);
      const d = await norn(w, ["doctor", "--json"]);
      seen[mode] = { code: d.code, body: d.body as unknown as DoctorSeen };
    }
  }, SLOW);

  for (const mode of ["auto", "manual"]) {
    test(`in ${mode} mode doctor fails on herdr alone, exits 1 and names how to fix it`, () => {
      const r = seen[mode];
      expect(r?.code).toBe(1);
      expect(r?.body.ok).toBe(false);
      expect(r?.body.checks.filter((c) => !c.ok && c.skipped !== true).map((c) => [c.name, c.code])).toEqual([["tool herdr", "tool_missing"]]);
      expect(r?.body.checks.find((c) => c.name === "tool herdr")?.do_instead).toContain("runner headless");
    });
  }
});

describe("init inside herdr", () => {
  let w: World;
  let init: NornOut;
  let shown: NornOut;

  beforeAll(async () => {
    w = await world("work");
    // gh first: it puts its bin on the process PATH, which would drop the fake herdr's
    fakeGh(w);
    fakeHerdr(w);
    w.env.HERDR_ENV = "1";
    await sh(w.root, "git", "remote", "set-url", "origin", "https://github.com/acme/app.git");
    await norn(w, ["plugin", "add", TEST_PLUGIN, "--json"]);
    init = await norn(w, ["init", "--executor", "test", "--yes", "--json"]);
    shown = await norn(w, ["config", "show", "--json"]);
  }, SLOW);

  test("on a GitHub origin it picks the herdr runner in manual mode and GitHub's tracker and forge", () => {
    expect(init.code).toBe(0);
    expect(init.body).toMatchObject({ chose: { runner: "herdr", mode: "manual", tracker: "github", forge: "github" } });
    expect(JSON.stringify(shown.body)).toContain('"herdr"');
    const config = shown.body as { config?: { executors?: Record<string, { runner: unknown }> } };
    const runner = config.config?.executors?.test?.runner;
    expect(typeof runner === "string" ? runner : (runner as { use: string }).use).toBe("herdr");
  });
});

/** The real herdr session the block runs in: never the person's default one. */
const REAL = process.env.NORN_TEST_HERDR === "1";
const SESSION = process.env.NORN_TEST_HERDR_SESSION ?? "norn-test";

async function herdrReal(...args: string[]): Promise<{ code: number; stdout: string }> {
  const r = await nodeExec(["herdr", "--session", SESSION, ...args], { timeoutMs: 15_000 });
  return { code: r.code, stdout: r.stdout };
}

/** What the real herdr session holds, in the fake's shape, for the same assertions. */
async function realState(): Promise<HerdrState> {
  const ws = JSON.parse((await herdrReal("workspace", "list")).stdout).result.workspaces as { workspace_id: string; label: string }[];
  const tabs = JSON.parse((await herdrReal("tab", "list")).stdout).result.tabs as { tab_id: string; workspace_id: string; label: string }[];
  const panes = JSON.parse((await herdrReal("pane", "list")).stdout).result.panes as { pane_id: string; tab_id: string; workspace_id: string; cwd: string }[];
  return {
    next: 0,
    workspaces: ws.map(({ workspace_id, label }) => ({ workspace_id, label })),
    tabs: tabs.map(({ tab_id, workspace_id, label }) => ({ tab_id, workspace_id, label })),
    panes: panes.map(({ pane_id, tab_id, workspace_id, cwd }) => ({ pane_id, tab_id, workspace_id, cwd, env: {} })),
  };
}

describe.skipIf(!REAL)("against a real herdr (NORN_TEST_HERDR=1)", () => {
  let w: World;
  let machine: string;
  let startedServer = false;
  let ended: UnitSeen | null;
  let final: HerdrState;

  beforeAll(async () => {
    if ((await herdrReal("workspace", "list")).code !== 0) {
      // a session of the test's own, so the person's workspaces are never touched
      Bun.spawn(["herdr", "--session", SESSION, "server"], { stdio: ["ignore", "ignore", "ignore"] }).unref();
      startedServer = true;
      for (const until = Date.now() + 10_000; Date.now() < until && (await herdrReal("workspace", "list")).code !== 0; ) await Bun.sleep(200);
    }
    if ((await realState()).workspaces.some((x) => x.label === KEY)) throw new Error(`herdr session ${SESSION} already has a workspace ${KEY}: close it first`);
    w = await world("work");
    const { added } = await setUp(w, { runner: "herdr", workflow: "duo", workflows: { duo: DUO }, config: [["executors.test.runner", `{use: herdr, session: ${SESSION}}`]] });
    machine = machineOf(added);
    plans(w, { design: "attended", build: "work" });
    const ticks = new Ticks(w, () => null);
    await norn(w, ["story", "create", "Build it in a real herdr", "--json"]);
    await ticks.until((u) => u?.parked !== undefined);
    await norn(w, ["run", "start", KEY, "--json"]);
    ended = await ticks.until((u) => u?.ended !== undefined, 120_000);
    final = await realState();
  }, SLOW);

  afterAll(async () => {
    if (!REAL) return;
    // only what this test opened: the workspaces its runs recorded
    const dir = machine ? join(machine, "runners", "herdr") : "";
    const opened = new Set<string>();
    if (dir && existsSync(dir))
      for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
        const rec = JSON.parse(readFileSync(join(dir, f), "utf8")) as { workspace?: string };
        if (rec.workspace) opened.add(rec.workspace);
      }
    for (const id of opened) await herdrReal("workspace", "close", id);
    if (startedServer) await nodeExec(["herdr", "session", "stop", SESSION], { timeoutMs: 15_000 });
  });

  test("the story ends done with one workspace labelled with its key, holding the design and build tabs", () => {
    expect(ended?.ended).toBe("done");
    const mine = final.workspaces.filter((x) => x.label === KEY);
    expect(mine).toHaveLength(1);
    const tabs = final.tabs.filter((t) => t.workspace_id === mine[0]?.workspace_id).map((t) => t.label);
    expect(tabs).toEqual([`${KEY} design`, `${KEY} build`]);
    const panes = final.panes.filter((p) => p.workspace_id === mine[0]?.workspace_id);
    const real = realpathSync(join(machine, "worktrees", KEY));
    expect(panes.map((p) => p.cwd)).toEqual([real, real]);
    expect(noteOf(w, "done")).toMatchObject({ code: 0 });
  });
});
