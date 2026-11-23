/**
 * The worktree setup through the CLI alone, every norn call a subprocess of the binary from source:
 * `setup.command` runs once in a new worktree, again only when a file its `setup.inputs` names
 * changed, and a setup that fails parks the unit for a person until `norn run rerun` runs it again.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SETUP_FAILED_PARK } from "@norn/runtime";
import { norn, setUp, tickUntil, type UnitShown, unitOf, type World, world, worktreeOf } from "./world.ts";

const KEY = "lt-1";
const SLOW = 240_000;

/** An agent step that commits feature.txt, a check that reads it, then a check that changes nothing. */
const BUILT = [
  "name: built",
  "start: build",
  "steps:",
  "  build:",
  "    by: builder",
  "    do: Build the thing.",
  "    outcomes: { done: test }",
  "  test:",
  "    by: shell",
  "    do: test -f feature.txt",
  "    limits: { timeout: 1m }",
  "    outcomes: { pass: again, fail: build }",
  "  again:",
  "    by: shell",
  "    do: test -f feature.txt",
  "    limits: { timeout: 1m }",
  "    outcomes: { pass: $done, fail: build }",
  "",
].join("\n");

/** One agent step that ends the story. */
const SOLO = ["name: solo", "start: build", "steps:", "  build:", "    by: builder", "    do: Build the thing.", "    outcomes: { done: $done }", ""].join("\n");

/** What each setup run saw, one line per run, written outside the worktree so it stays clean. */
const runsOf = (log: string): string[] => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter((l) => l !== "") : []);

describe("the worktree setup runs once in a new worktree, and again only when its inputs change", () => {
  let w: World;
  let log: string;
  let ended: UnitShown | null;
  const rules: string[] = [];

  beforeAll(async () => {
    w = await world("work");
    log = join(w.dir, "setup.log");
    const command = `{ cat feature.txt 2>/dev/null || echo none; } >> '${log}'`;
    await setUp(w, { workflow: "built", workflows: { built: BUILT }, config: [["setup.command", command], ["setup.inputs", "[feature.txt]"]] });
    await norn(w, ["story", "create", "Build it", "--json"]);
    await tickUntil(w, rules, (u) => u?.ended !== undefined, 180_000, KEY);
    ended = await unitOf(w, KEY);
  }, SLOW);

  test("it ran before the agent, found no feature.txt, then once more for the check after the agent committed it, and not for the check after that", () => {
    expect(ended).toMatchObject({ ended: "done" });
    const runs = runsOf(log);
    expect(runs).toHaveLength(2);
    expect(runs[0]).toBe("none");
    expect(runs[1]).toMatch(/^the feature, by run /);
  });

  test("no action failed and the unit never parked on its setup", () => {
    expect(rules.filter((r) => r.endsWith("!"))).toEqual([]);
    expect(ended?.parked).toBeUndefined();
  });
});

describe("a worktree setup that fails parks the unit for a person, and a rerun runs it again", () => {
  let w: World;
  let log: string;
  let ok: string;
  let parked: UnitShown | null;
  let agentBeforeRerun: boolean;
  let runsAtPark: number;
  let rerun: { code: number; body: Record<string, unknown> };
  let ended: UnitShown | null;
  const rules: string[] = [];

  beforeAll(async () => {
    w = await world("work");
    log = join(w.dir, "setup.log");
    ok = join(w.flags, "setup-ok");
    const command = `echo run >> '${log}'; test -f '${ok}' || { echo 'the lockfile is out of date' >&2; exit 1; }`;
    await setUp(w, { workflow: "solo", workflows: { solo: SOLO }, config: [["setup.command", command]] });
    await norn(w, ["story", "create", "Build it", "--json"]);
    await tickUntil(w, rules, (u) => u?.parked !== undefined || u?.ended !== undefined, 120_000, KEY);
    parked = await unitOf(w, KEY);
    const wt = await worktreeOf(w, KEY);
    agentBeforeRerun = wt !== null && existsSync(join(wt, "feature.txt"));
    runsAtPark = runsOf(log).length;
    writeFileSync(ok, "");
    rerun = await norn(w, ["run", "rerun", KEY, "--json"]);
    await tickUntil(w, rules, (u) => u?.ended !== undefined, 120_000, KEY);
    ended = await unitOf(w, KEY);
  }, SLOW);

  test("status shows the park with the command's exit and its last line, waiting on a person, naming the rerun", () => {
    expect(parked).toMatchObject({ step: "build", parked: SETUP_FAILED_PARK, run: null, waiting: { for: "person", next: `norn run rerun ${KEY}` } });
    expect(parked?.waiting?.text).toContain("exited 1");
    expect(parked?.waiting?.text).toContain("the lockfile is out of date");
    expect(agentBeforeRerun).toBe(false);
    // parked once, never retried on its own
    expect(runsAtPark).toBe(1);
  });

  test("norn run rerun lifts the park, the setup runs again with nothing changed, and the agent then works the step to done", () => {
    expect(rerun.code).toBe(0);
    expect(runsOf(log)).toHaveLength(2);
    expect(ended).toMatchObject({ ended: "done" });
  });
});
