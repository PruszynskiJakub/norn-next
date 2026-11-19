/**
 * Local recovery and robustness through the CLI alone, every norn call a subprocess of the binary
 * from source: a corrupt record named and never acted on while other stories run, views that write
 * nothing, the tick lock held, killed and taken over, concurrent decisions and stop hooks counted
 * exactly, the guard against writes into run state, run state kept out of git, a worktree wiped or
 * removed by hand, a large JSON value through a pipe, and trace retention.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { MAX_STOP_BLOCKS } from "@norn/runtime";
import { layout } from "@norn/store-local";
import { agentNotes, awaitNote, MAIN, machineOf, type NornOut, noteOf, norn, plans, setUp, sh, unitOf, type World, world, worktreeOf } from "./world.ts";

const KEY = "lt-1";
const SLOW = 240_000;
/** A path that names norn's run state; none may reach a worktree's status or a story branch. */
const RUN_STATE = /runs\/|runs-v2|receipts|trace|events-v2|\.norn\//;

/**
 * A view reads local files only, about half a second on a quiet machine with bun's start; the tier
 * runs files in parallel, so the bound leaves room for that load while a fetch or a hang still shows.
 */
const VIEW_MS = 3_000;

/** One agent step that ends the story. */
const SOLO = ["name: solo", "start: build", "steps:", "  build:", "    agent: Build the thing.", "    outcomes: { done: $done }", ""].join("\n");

interface UnitSeen {
  id: string;
  step: string | null;
  attempt: number | null;
  ended?: string;
  parked?: string;
  corrupt?: string;
  run: { id: string } | null;
  waiting: { for: string; text: string; next?: string } | null;
}

interface Outcome {
  decision: { rule: string; unit: string | null };
  ok: boolean;
  error?: string;
}

const lostRace = (o: Outcome): boolean => o.error?.includes("the record moved since facts were read") === true;

/** Every tick's outcomes, kept; `after` runs after each tick, so a test can look at the repo between ticks. */
class Ticks {
  readonly outcomes: Outcome[] = [];
  constructor(
    private readonly w: World,
    private readonly after: () => Promise<void> = async () => {},
  ) {}

  async once(): Promise<NornOut> {
    const t = await norn(this.w, ["tick", "--json"]);
    const outcomes = (t.body.outcomes ?? []) as Outcome[];
    this.outcomes.push(...outcomes);
    if (t.code !== 0 && !outcomes.every((o) => o.ok || lostRace(o))) throw new Error(`tick exited ${t.code}: ${t.stdout}${t.stderr}`);
    await this.after();
    return t;
  }

  rules(): string[] {
    return this.outcomes.map((o) => `${o.decision.unit ?? "-"}:${o.decision.rule}${o.ok ? "" : "!"}`);
  }

  async until(done: (u: UnitSeen | null) => boolean, key = KEY, maxMs = 90_000): Promise<UnitSeen | null> {
    for (const until = performance.now() + maxMs; performance.now() < until; ) {
      await this.once();
      const u = (await unitOf(this.w, key)) as UnitSeen | null;
      if (done(u)) return u;
      await Bun.sleep(200);
    }
    throw new Error(`no convergence; rules: ${this.rules().join(", ")}; unit: ${JSON.stringify(await unitOf(this.w, key))}`);
  }
}

/** Every path under `dirs` and each file's bytes, a symlink never followed: equal hashes mean nothing was written. */
function treeHash(dirs: string[], keep: (path: string) => boolean = () => true): string {
  const h = createHash("sha256");
  const walk = (root: string, dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      if (!keep(p)) continue;
      const st = lstatSync(p);
      h.update(`${relative(root, p)}\0`);
      if (st.isSymbolicLink()) h.update("link\0");
      else if (st.isDirectory()) walk(root, p);
      else h.update(readFileSync(p));
    }
  };
  for (const d of dirs) if (existsSync(d)) walk(d, d);
  return h.digest("hex");
}

/** The agent runs launched so far, by their notes files. */
const runFiles = (w: World): string[] => readdirSync(w.notes).filter((f) => f.endsWith(".jsonl")).sort();

async function waitForNote(w: World, what: string): Promise<void> {
  if ((await awaitNote(w, what, 30_000)) === undefined) throw new Error(`the agent never noted ${what}`);
}

const receiptNames = (machine: string, unit = KEY): string[] => {
  const dir = layout(machine).receipts(unit);
  return existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith(".json") && !n.startsWith(".")) : [];
};

const receiptKinds = (machine: string, unit = KEY): string[] =>
  receiptNames(machine, unit).map((n) => (JSON.parse(readFileSync(join(layout(machine).receipts(unit), n), "utf8")) as { data: { kind: string } }).data.kind);

describe("a corrupt record is named and never acted on, the views write nothing, and run state stays out of git", () => {
  let w: World;
  let machine: string;
  let ticks: Ticks;
  const leaks: string[] = [];
  let legacyBefore: string;
  let atGate: UnitSeen | null;
  let hashes: { before: string; after: string };
  let viewMs: number[];
  let views: NornOut[];
  let corruptView: NornOut;
  let corruptStatus: UnitSeen | undefined;
  let otherEnded: UnitSeen | null;
  let whileCorrupt: Outcome[];
  let corruptReceiptView: NornOut;
  let corruptReceiptName: string;
  let traceStatus: NornOut;
  let approves: NornOut[];
  let afterApproves: string[];
  let seqs: number[];
  let merged: UnitSeen | null;
  let fromSub: NornOut;
  let machinesAfter: string[];
  let checkout: string;

  beforeAll(async () => {
    w = await world("work");
    // a run folder an older norn kept on the base: a dead record nothing reads, shows or moves
    writeFileSync(join(w.root, "README.md"), "the repo\n");
    await sh(w.root, "mkdir", "-p", "runs/lt-1/receipts");
    writeFileSync(join(w.root, "runs/lt-1/state.json"), '{"from":"an older norn"}\n');
    writeFileSync(join(w.root, "runs/lt-1/receipts/0001-x.json"), '{"kind":"old"}\n');
    await sh(w.root, "git", "add", "-A");
    await sh(w.root, "git", "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "an old runs folder");
    await sh(w.root, "git", "push", "-q", "origin", "main");
    legacyBefore = await sh(w.root, "git", "rev-parse", "HEAD:runs");

    const set = await setUp(w, { workflows: { solo: SOLO } });
    machine = machineOf(set.added);
    ticks = new Ticks(w, async () => {
      const wt = await worktreeOf(w);
      if (wt && existsSync(wt)) leaks.push(...(await sh(wt, "git", "status", "--porcelain", "--untracked-files=all", "--ignored=no")).split("\n").filter((l) => RUN_STATE.test(l)));
      const branch = await sh(w.root, "git", "branch", "--list", `norn/${KEY}`);
      if (branch !== "") leaks.push(...(await sh(w.root, "git", "log", "--name-only", "--format=", `main..norn/${KEY}`)).split("\n").filter((l) => RUN_STATE.test(l)));
    });
    await norn(w, ["story", "create", "Add the feature", "--json"]);
    atGate = await ticks.until((u) => u?.step === "ready" && u.waiting?.for === "gate");

    const watched = [w.root, w.home];
    const before = treeHash(watched);
    views = [];
    viewMs = [];
    for (const args of [["status", "--json"], ["story", "view", KEY, "--json"], ["status"], ["story", "view", KEY]]) {
      const t0 = performance.now();
      views.push(await norn(w, args));
      viewMs.push(performance.now() - t0);
    }
    hashes = { before, after: treeHash(watched) };

    const statePath = layout(machine).state(KEY);
    const stateText = readFileSync(statePath, "utf8");
    writeFileSync(statePath, "{ not json");
    corruptView = await norn(w, ["story", "view", KEY, "--json"]);
    corruptStatus = ((await norn(w, ["status", "--json"])).body.stories as { key: string; units: UnitSeen[] }[]).find((s) => s.key === KEY)?.units[0];
    await norn(w, ["story", "create", "Another feature", "--workflow", "solo", "--json"]);
    const from = ticks.outcomes.length;
    otherEnded = await ticks.until((u) => u?.ended !== undefined, "lt-2");
    whileCorrupt = ticks.outcomes.slice(from).filter((o) => o.decision.unit === KEY);
    writeFileSync(statePath, stateText);

    const names = receiptNames(machine).sort();
    corruptReceiptName = names.at(-1) as string;
    const receiptPath = join(layout(machine).receipts(KEY), corruptReceiptName);
    const receiptText = readFileSync(receiptPath, "utf8");
    writeFileSync(receiptPath, '{"kind":"nonsense"}\n');
    corruptReceiptView = await norn(w, ["story", "view", KEY, "--json"]);
    writeFileSync(receiptPath, receiptText);

    const traces = join(machine, "trace-v2");
    writeFileSync(join(traces, "01ARZ3NDEKTSV4RRFFQ69G5FAV.json"), '{"tick_id": "01ARZ3NDEKTSV4RRFF\n');
    traceStatus = await norn(w, ["status", "--json"]);

    // a person deep inside the unit's worktree: their commands act on the main repo and its one machine dir
    const sub = join((await worktreeOf(w)) as string, "deep", "er");
    mkdirSync(sub, { recursive: true });
    fromSub = await norn(w, ["story", "view", KEY, "--json"], {}, sub);
    approves = await Promise.all(Array.from({ length: 8 }, () => norn(w, ["story", "approve", KEY, "--json"], {}, sub)));
    afterApproves = receiptKinds(machine);
    seqs = receiptNames(machine)
      .map((n) => Number(n.split("-")[0]))
      .sort((a, b) => a - b);
    merged = await ticks.until((u) => u?.step === "merge");
    machinesAfter = readdirSync(join(w.home, "repos"));
    checkout = await sh(w.root, "git", "status", "--porcelain");
  }, SLOW);

  test("status and story view, markdown or JSON, write nothing to the repo, its git dir or the norn home, each in about a second", () => {
    expect(atGate).toMatchObject({ step: "ready", waiting: { for: "gate" } });
    expect(views.map((v) => v.code)).toEqual([0, 0, 0, 0]);
    expect(hashes.after).toBe(hashes.before);
    for (const ms of viewMs) expect(ms).toBeLessThan(VIEW_MS);
  });

  test("a corrupt state makes story view exit 4 and status show the unit as corrupt, and the tick never acts on it while another story runs to done", () => {
    expect(corruptView.code).toBe(4);
    expect(corruptView.body).toMatchObject({ error: expect.stringContaining("corrupt") });
    expect(corruptStatus?.waiting?.text).toStartWith("corrupt:");
    expect(otherEnded).toMatchObject({ ended: "done" });
    expect(whileCorrupt.length).toBeGreaterThan(0);
    expect(new Set(whileCorrupt.map((o) => o.decision.rule))).toEqual(new Set(["unit.corrupt.held"]));
  });

  test("a corrupt receipt makes story view exit 4, naming the receipt's file", () => {
    expect(corruptReceiptView.code).toBe(4);
    expect(corruptReceiptView.body.error).toContain(corruptReceiptName);
  });

  test("a torn trace file leaves status exit 0 with no problems", () => {
    expect(traceStatus.code).toBe(0);
    expect(traceStatus.body.problems).toEqual([]);
  });

  test("eight concurrent approves record one gate decision, and the receipts' seqs have no gaps", () => {
    expect(approves.map((a) => a.code)).toEqual(Array(8).fill(0));
    expect(approves.filter((a) => a.body.replayed === false)).toHaveLength(1);
    expect(new Set(approves.map((a) => a.body.receipt_id)).size).toBe(1);
    expect(afterApproves.filter((k) => k === "gate.decided")).toHaveLength(1);
    expect(seqs).toEqual(seqs.map((_, i) => (seqs[0] as number) + i));
    expect(merged).toMatchObject({ step: "merge" });
  });

  test("no tick leaves run state in the worktree's status or the story branch, and the pushed branch holds only the agent's files", async () => {
    expect(leaks).toEqual([]);
    const pushed = (await sh(w.root, "git", "diff", "--name-only", `origin/main...origin/norn/${KEY}`)).split("\n");
    expect(pushed).toEqual(["feature.txt"]);
  });

  test("commands from a worktree's subfolder act on the main repo, and its one machine dir holds the traces and the runs while the checkout stays clean", () => {
    expect(fromSub).toMatchObject({ code: 0, body: { key: KEY } });
    expect(machinesAfter).toEqual([machine.split("/").at(-1) as string]);
    expect(machinesAfter[0]).toMatch(/^repo-[0-9a-f]{8}$/);
    expect(readdirSync(machine)).toEqual(expect.arrayContaining(["trace-v2", "runs-v2", "worktrees"]));
    expect(readdirSync(join(machine, "trace-v2")).length).toBeGreaterThan(1);
    expect(checkout).toBe("");
  });

  test("an old runs folder on the base is never read, shown or moved", async () => {
    expect(await sh(w.root, "git", "rev-parse", "HEAD:runs")).toBe(legacyBefore);
    expect(await sh(w.root, "git", "rev-parse", `origin/norn/${KEY}:runs`)).toBe(legacyBefore);
    // the view could only show that text by reading the old folder; that lt-1 ran on under its own key
    // without it is the proof the rest of this block gives
    expect(JSON.stringify(views[0]?.body)).not.toContain("an older norn");
  });
});

/** An agent step, then a change opened, then the story ends with it open: a finished story update-branch acts on. */
const SHIP = ["name: ship", "start: make", "steps:", "  make:", "    agent: Make the thing.", "    outcomes: { done: open-pr }", "  open-pr:", "    open-pr:", "    outcomes: { done: $done }", ""].join("\n");
/** One agent step the `hang` plan holds forever. */
const PARK = ["name: park", "start: park", "steps:", "  park:", "    agent: Park here.", "    outcomes: { done: $done }", ""].join("\n");

/**
 * Point origin at a transport that waits while `<dir>/hold` exists, after touching `<dir>/entered`,
 * then serves the bare remote: a fetch or a push holds whoever runs it, for exactly as long as the
 * test keeps the flag up.
 */
async function holdingRemote(w: World): Promise<{ hold: string; entered: string }> {
  const hold = join(w.dir, "hold");
  const entered = join(w.dir, "entered");
  const script = join(w.dir, "holding-remote.sh");
  writeFileSync(script, ["#!/bin/sh", `touch '${entered}'`, `while [ -e '${hold}' ]; do sleep 0.05; done`, `exec "$1" '${w.remote}'`, ""].join("\n"));
  chmodSync(script, 0o755);
  await sh(w.root, "git", "config", "protocol.ext.allow", "always");
  await sh(w.root, "git", "remote", "set-url", "origin", `ext::${script} %S`);
  return { hold, entered };
}

async function waitFor(path: string, ms = 60_000): Promise<void> {
  for (const until = performance.now() + ms; performance.now() < until; await Bun.sleep(50)) if (existsSync(path)) return;
  throw new Error(`${path} never appeared`);
}

describe("the tick lock: held by a live watch, killed with -9, taken over once stale", () => {
  let w: World;
  let machine: string;
  let ticks: Ticks;
  let runsBefore: string[];
  let lockedTick: NornOut;
  let tidyOut: NornOut;
  let updateOut: NornOut;
  let hashes: { before: string; after: string };
  let afterKill: NornOut;
  let takeover: NornOut[];
  let runsAfter: string[];
  let parked: UnitSeen | null;

  beforeAll(async () => {
    w = await world("work");
    const set = await setUp(w, { workflow: "ship", workflows: { ship: SHIP, park: PARK }, config: [["kernel.lock_stale", "10s"]] });
    machine = machineOf(set.added);
    plans(w, { park: "hang" });
    ticks = new Ticks(w);
    await norn(w, ["story", "create", "Ship it", "--json"]);
    await ticks.until((u) => u?.ended !== undefined);
    await norn(w, ["story", "create", "Park it", "--workflow", "park", "--json"]);
    parked = await ticks.until((u) => u?.run !== null && u?.step === "park", "lt-2");
    await waitForNote(w, "pid");
    runsBefore = runFiles(w);

    const { hold, entered } = await holdingRemote(w);
    writeFileSync(hold, "");
    const watch = Bun.spawn(["bun", MAIN, "watch", "--interval", "1s", "--json"], { cwd: w.root, env: { ...process.env, ...w.env }, stdout: "ignore", stderr: "ignore" });
    try {
      await waitFor(entered);
      const watched = [w.root, w.home];
      const skipLock = (p: string) => !p.endsWith("tick.lock");
      const before = treeHash(watched, skipLock);
      lockedTick = await norn(w, ["tick", "--json"]);
      tidyOut = await norn(w, ["tidy", "--json"]);
      updateOut = await norn(w, ["story", "update-branch", KEY, "--json"]);
      hashes = { before, after: treeHash(watched, skipLock) };
    } finally {
      watch.kill("SIGKILL");
      await watch.exited;
    }
    afterKill = await norn(w, ["tick", "--json"]);
    rmSync(hold, { force: true });
    takeover = [];
    for (const until = performance.now() + 60_000; performance.now() < until; await Bun.sleep(250)) {
      const t = await norn(w, ["tick", "--json"]);
      takeover.push(t);
      if (t.code !== 5) break;
    }
    runsAfter = runFiles(w);
    const pid = noteOf(w, "pid");
    if (typeof pid === "number") process.kill(pid, "SIGKILL");
  }, SLOW);

  test("while the watch holds the lock, a tick exits 5 tick_locked, and tidy and update-branch exit 5 tick_running and change nothing", () => {
    expect(parked).toMatchObject({ step: "park" });
    expect(lockedTick).toMatchObject({ code: 5, body: { code: "tick_locked" } });
    expect(tidyOut).toMatchObject({ code: 5, body: { code: "tick_running" } });
    expect(updateOut).toMatchObject({ code: 5, body: { code: "tick_running" } });
    expect(hashes.after).toBe(hashes.before);
  });

  test("a watch killed with -9 leaves the lock busy until it is stale, then a tick takes it over without a second launch", () => {
    expect(afterKill).toMatchObject({ code: 5, body: { code: "tick_locked" } });
    expect(takeover.at(-1)?.code).toBe(0);
    expect(existsSync(join(machine, "tick.lock"))).toBe(false);
    expect(runsAfter).toEqual(runsBefore);
  });
});

interface HookReply {
  code: number;
  answer: { kind: string; reason?: string } | null;
}

/** The hook command install left in the worktree, run as the agent runs it: the hook's name last, the payload on stdin, in `cwd`. */
async function fire(w: World, wt: string, runId: string, name: string, payload: Record<string, unknown> = {}, cwd = wt): Promise<HookReply> {
  const command = readFileSync(join(wt, ".norn-test", "hook"), "utf8").trim();
  const p = Bun.spawn(["sh", "-c", `${command} ${name}`], { cwd, env: { ...process.env, ...w.env, NORN_UNIT: KEY, NORN_RUN_ID: runId }, stdin: new Blob([JSON.stringify(payload)]), stdout: "pipe", stderr: "pipe" });
  const [out, code] = await Promise.all([new Response(p.stdout).text(), p.exited]);
  return { code, answer: out.trim() ? (JSON.parse(out) as { kind: string; reason?: string }) : null };
}

/** Every event the run's hooks logged, in seq order. */
function loggedEvents(machine: string, runId: string): { type: string }[] {
  const dir = join(machine, "events-v2", KEY, runId, "events");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.endsWith(".json"))
    .sort()
    .flatMap((n) => (JSON.parse(readFileSync(join(dir, n), "utf8")) as { events: { type: string }[] }).events);
}

describe("hooks: the guard keeps writes out of run state, and the stop cap holds under concurrency", () => {
  let w: World;
  let machine: string;
  let wt: string;
  let runId: string;
  let denials: HookReply[];
  let stops: HookReply[];
  let climbed: HookReply;
  let viaLink: HookReply[];
  let ownWrite: HookReply;
  let perHook: { hook: string; code: number; added: string[] }[];

  beforeAll(async () => {
    w = await world("hang");
    const set = await setUp(w, { workflow: "solo", workflows: { solo: SOLO } });
    machine = machineOf(set.added);
    const ticks = new Ticks(w);
    await norn(w, ["story", "create", "Hang on", "--json"]);
    await ticks.until((u) => u?.run !== null && u?.step === "build");
    await waitForNote(w, "pid");
    runId = (runFiles(w)[0] as string).replace(/\.jsonl$/, "");
    wt = (await worktreeOf(w)) as string;

    // guard denials first: they must leave the run's stop refusals unspent
    denials = [];
    for (let i = 0; i < 5; i++) denials.push(await fire(w, wt, runId, "tool", { id: `t-out-${i}`, kind: "write", tool: "Write", detail: join(w.dir, `elsewhere-${i}.txt`) }));
    stops = await Promise.all(Array.from({ length: 2 * MAX_STOP_BLOCKS }, () => fire(w, wt, runId, "stop")));

    mkdirSync(join(wt, "sub"), { recursive: true });
    // a relative write path is read against the worktree, as the guard resolves it
    const intoStore = relative(wt, join(machine, "runs-v2", "stories", KEY, "claim.json"));
    climbed = await fire(w, wt, runId, "tool", { id: "t-rel", kind: "write", tool: "Write", detail: intoStore });
    symlinkSync(join(machine, "runs-v2"), join(wt, "state-link"));
    viaLink = [
      await fire(w, wt, runId, "tool", { id: "t-link-rel", kind: "write", tool: "Write", detail: `state-link/stories/${KEY}/claim.json` }),
      await fire(w, wt, runId, "tool", { id: "t-link-abs", kind: "write", tool: "Write", detail: join(wt, "state-link", "stories", KEY, "units", "story", "state.json") }),
    ];
    ownWrite = await fire(w, wt, runId, "tool", { id: "t-own", kind: "write", tool: "Write", detail: join(wt, "sub", "own.txt") });

    perHook = [];
    for (const [hook, payload] of [
      ["start", {}],
      ["prompt", { prompt: "carry on" }],
      ["tool", { id: "t-1", kind: "shell", tool: "Bash", detail: "ls" }],
      ["permission", { id: "t-1", prompt: "Allow ls?" }],
      ["tool-done", { id: "t-1" }],
      ["stop", {}],
      ["end", {}],
    ] as const) {
      const before = loggedEvents(machine, runId).length;
      const r = await fire(w, wt, runId, hook, payload);
      perHook.push({ hook, code: r.code, added: loggedEvents(machine, runId).slice(before).map((e) => e.type) });
    }
    const pid = noteOf(w, "pid");
    if (typeof pid === "number") process.kill(pid, "SIGKILL");
  }, SLOW);

  test("guard denials do not use up the stop cap: of twice the cap's concurrent stops, exactly the cap are blocked", () => {
    expect(denials.map((d) => d.answer?.kind)).toEqual(Array(5).fill("deny"));
    expect(stops.filter((s) => s.answer?.kind === "block")).toHaveLength(MAX_STOP_BLOCKS);
    expect(stops.map((s) => s.code)).toEqual(Array(2 * MAX_STOP_BLOCKS).fill(0));
  });

  test("a relative path that climbs out of the worktree into run state is denied as run state, and a write in a subfolder is allowed", () => {
    expect(climbed.answer).toMatchObject({ kind: "deny", reason: expect.stringContaining("run state") });
    expect(ownWrite.answer).toBeNull();
  });

  test("a write through a symlink in the worktree that points into run state is denied as run state", () => {
    for (const r of viaLink) expect(r.answer).toMatchObject({ kind: "deny", reason: expect.stringContaining("run state") });
  });

  test("every hook the harness installed, fed its payload, records exactly one event", () => {
    expect(perHook).toEqual([
      { hook: "start", code: 0, added: ["session.started"] },
      { hook: "prompt", code: 0, added: ["turn.started"] },
      { hook: "tool", code: 0, added: ["tool.requested"] },
      { hook: "permission", code: 0, added: ["tool.permission"] },
      { hook: "tool-done", code: 0, added: ["tool.finished"] },
      { hook: "stop", code: 0, added: ["turn.ended"] },
      { hook: "end", code: 0, added: ["session.ended"] },
    ]);
  });
});

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** A ULID whose time part is `ms`: the name a tick's trace takes. */
function ulidAt(ms: number): string {
  let time = "";
  for (let t = ms, i = 0; i < 10; i++, t = Math.floor(t / 32)) time = (CROCKFORD[t % 32] as string) + time;
  return `${time}${"0".repeat(16)}`;
}

describe("a parked worktree wiped or removed by hand, and traces aged out", () => {
  let w: World;
  let machine: string;
  let ticks: Ticks;
  let parkedBefore: UnitSeen | null;
  let afterClean: UnitSeen | null;
  let cleanEnded: UnitSeen | null;
  let cleanRules: string[];
  let removedPath: string;
  let removedRun: string | undefined;
  let removedRules: string[];
  let removedEnded: UnitSeen | null;
  let recreatedBranch: string;
  let oldTrace: string;
  let newTrace: string;

  /** The rules ticks fired for `unit` from outcome `from` on. */
  const rulesOf = (unit: string, from: number): string[] => ticks.outcomes.slice(from).filter((o) => o.decision.unit === unit).map((o) => o.decision.rule);

  beforeAll(async () => {
    w = await world("ask");
    const set = await setUp(w, { workflow: "solo", workflows: { solo: SOLO }, config: [["trace.retain", "1h"]] });
    machine = machineOf(set.added);
    ticks = new Ticks(w);
    await norn(w, ["story", "create", "Wiped", "--json"]);
    await norn(w, ["story", "create", "Removed", "--json"]);
    parkedBefore = await ticks.until((u) => u?.parked === "agent.asked");
    const removedParked = await ticks.until((u) => u?.parked === "agent.asked", "lt-2");
    removedRun = removedParked?.run?.id;

    const wt = (await worktreeOf(w)) as string;
    await sh(wt, "git", "clean", "-fdxq");
    afterClean = (await unitOf(w, KEY)) as UnitSeen | null;
    await norn(w, ["story", "answer", KEY, "Blue."]);
    let from = ticks.outcomes.length;
    cleanEnded = await ticks.until((u) => u?.ended !== undefined);
    cleanRules = rulesOf(KEY, from);

    removedPath = (await worktreeOf(w, "lt-2")) as string;
    rmSync(removedPath, { recursive: true, force: true });
    await norn(w, ["story", "answer", "lt-2", "Red."]);
    from = ticks.outcomes.length;
    await ticks.until((u) => u?.parked === undefined, "lt-2");
    recreatedBranch = existsSync(removedPath) ? await sh(removedPath, "git", "symbolic-ref", "HEAD") : "(no worktree)";
    removedEnded = await ticks.until((u) => u?.ended !== undefined, "lt-2");
    removedRules = rulesOf("lt-2", from);

    const traces = join(machine, "trace-v2");
    oldTrace = `${ulidAt(Date.now() - 3 * 3_600_000)}.json`;
    newTrace = `${ulidAt(Date.now() - 60_000)}.json`;
    writeFileSync(join(traces, oldTrace), "{}\n");
    writeFileSync(join(traces, newTrace), "{}\n");
    await ticks.once();
  }, SLOW);

  test("git clean -fdx on a parked worktree keeps the step, the attempt and the question, and the answer reaches the same run, which carries the story to done", () => {
    expect(parkedBefore).toMatchObject({ step: "build", parked: "agent.asked", waiting: { for: "answer" } });
    expect(afterClean).toMatchObject({ step: parkedBefore?.step, attempt: parkedBefore?.attempt, waiting: parkedBefore?.waiting });
    expect(cleanEnded).toMatchObject({ ended: "done" });
    expect(cleanRules).not.toContain("agent.died.retry");
    const answered = agentNotes(w).filter((n) => n.note === "answered");
    expect(answered.map((n) => n.run)).toContain(parkedBefore?.run?.id as string);
  });

  test("a worktree removed by hand is made again on the story's branch before the run resumes with the answer", () => {
    expect(recreatedBranch).toBe("refs/heads/norn/lt-2");
    expect(removedEnded).toMatchObject({ ended: "done" });
    expect(removedRules).not.toContain("agent.died.retry");
    expect(agentNotes(w).filter((n) => n.note === "answered").map((n) => n.run)).toContain(removedRun as string);
    // one launch per story: the answers resumed the runs that asked
    expect(runFiles(w)).toHaveLength(2);
  });

  test("a trace older than trace.retain goes at the next tick, and a younger one stays", () => {
    const left = readdirSync(join(machine, "trace-v2"));
    expect(left).not.toContain(oldTrace);
    expect(left).toContain(newTrace);
  });
});

describe("a JSON value over 64 KiB arrives whole through a pipe", () => {
  let w: World;
  let big: string;
  let piped: { create: { code: number; stdout: string }; refused: { code: number; stdout: string } };

  beforeAll(async () => {
    w = await world("work");
    await setUp(w);
    big = "x".repeat(70_000);
    const run = async (args: string): Promise<{ code: number; stdout: string }> => {
      const p = Bun.spawn(["sh", "-c", `bun '${MAIN}' ${args} --json | cat`], { cwd: w.root, env: { ...process.env, ...w.env, BIG: big }, stdout: "pipe", stderr: "ignore" });
      const [stdout, code] = await Promise.all([new Response(p.stdout).text(), p.exited]);
      return { code, stdout };
    };
    piped = { create: await run('story create "$BIG"'), refused: await run('story view "lt-$BIG"') };
  }, SLOW);

  test("a success and a refusal, each over 64 KiB, parse whole after | cat", () => {
    for (const out of [piped.create, piped.refused]) expect(out.stdout.length).toBeGreaterThan(65_536);
    expect(JSON.parse(piped.create.stdout)).toMatchObject({ key: KEY, title: big });
    expect(JSON.parse(piped.refused.stdout)).toMatchObject({ error: expect.stringContaining(big), do_instead: expect.any(String) });
  });
});
