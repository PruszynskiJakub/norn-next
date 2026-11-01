import { describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { copyFileSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { Facts, LoadedWorkflow } from "@norn/core";
import { type HookFact, type HookTrace, type ResolvedConfig, type TickTrace, type TraceEvent, ulid } from "@norn/schema";
import {
  appendHookTrace,
  appendTick,
  appendTrace,
  blockedHookCount,
  decisionUnit,
  hookFilePath,
  inboxHistory,
  lastTickFor,
  loadConfig,
  loadWorkflow,
  loadWorkflows,
  readHookFacts,
  readTickInputs,
  readTrace,
  readUnitHooks,
  readTraceFile,
  machineDir,
  repoConfigPath,
  sha256,
  setTraceReadObserver,
  unitHooksChangedAt,
  workflowsDir,
  writeBriefing,
  writeTraceFile,
} from "../../src/index.ts";
import { AT, tmp, WORKFLOW_YAML } from "../helpers.ts";

describe("config (K2)", () => {
  test("user + repo layers merged; home from param or NORN_HOME_DIR; missing = defaults", () => {
    const repo = tmp();
    const home = tmp();
    expect(loadConfig({ repoRoot: repo, home })).toMatchObject({ ok: true, config: { max_agents: 2 } });
    writeFileSync(join(home, "config.yaml"), "max_agents: 4\ndefault_mode: auto\n");
    mkdirSync(dirname(repoConfigPath(repo)), { recursive: true });
    writeFileSync(repoConfigPath(repo), "max_agents: 8\nremote: { label: mine }\n");
    const c = loadConfig({ repoRoot: repo, env: { NORN_HOME_DIR: home } });
    expect(c.ok && c.config).toMatchObject({ max_agents: 4, default_mode: "auto", remote: { label: "mine", provider: "gh" } });
    expect(c.home).toBe(home);
  });
  test("invalid layer → errors with repo-relative path", () => {
    const repo = tmp();
    mkdirSync(dirname(repoConfigPath(repo)), { recursive: true });
    writeFileSync(repoConfigPath(repo), "max_agents: zero\n");
    const c = loadConfig({ repoRoot: repo, home: tmp() });
    expect(c.ok).toBe(false);
    expect(!c.ok && c.errors[0]?.file).toBe(relative(repo, repoConfigPath(repo)));
  });
});

describe("workflows (W1)", () => {
  test("loads yaml and json, reports invalid and name mismatch", () => {
    const repo = tmp();
    const dir = workflowsDir(repo);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "slice.yaml"), WORKFLOW_YAML);
    writeFileSync(join(dir, "bug.json"), JSON.stringify({ name: "bug", start: "fix", steps: { fix: { type: "gate", outcomes: { approve: "$done" } } } }));
    writeFileSync(join(dir, "story.yaml"), "name: other\nstart: a\nsteps: {}\n");
    writeFileSync(join(dir, "README.md"), "ignored");
    const l = loadWorkflows(repo);
    expect(Object.keys(l.workflows).sort()).toEqual(["bug", "slice"]);
    expect(l.errors.map((e) => e.file)).toEqual([relative(repo, join(dir, "story.yaml"))]);
    expect(loadWorkflow(repo, "slice")).toMatchObject({ ok: true, value: { name: "slice", workflow: { start: "implement" } } });
    expect(loadWorkflow(repo, "nope")).toEqual({ ok: false, reason: "missing" });
  });
});

function tick(unit: string, at: string): TraceEvent {
  return {
    type: "tick",
    tick_id: ulid(),
    at,
    heartbeat_id: null,
    duration_ms: 3,
    facts: { now: Date.parse(at) },
    decisions: [{ unit, rule: "noop.idle", action: { kind: "noop" }, result: { ok: true } }],
  };
}

describe("trace (O4)", () => {
  test("daily JSONL files; filter by unit (story includes slices); last tick for why", () => {
    const repo = tmp();
    expect(appendTrace(repo, tick("gh-12", AT))).toBe("2026-10-23.jsonl");
    appendTrace(repo, tick("gh-12/01", "2026-10-24T00:00:01.000Z"));
    appendTrace(repo, tick("gh-13", "2026-10-24T00:00:02.000Z"));
    appendTrace(repo, {
      type: "hook",
      id: ulid(),
      fact: { event: "turn_end", at: "2026-10-24T00:00:03.000Z", agent: "claude", native: "Stop", cwd: "/w", story: "gh-12", slice: "gh-12/01" },
    });
    appendFileSync(join(machineDir(repo), "2026-10-24.jsonl"), "garbage\n");
    const all = readTrace(repo);
    expect(all.events.length).toBe(4);
    expect(all.errors.map((e) => e.file)).toEqual(["2026-10-24.jsonl:4"]);
    expect(readTrace(repo, { unit: "gh-12" }).events.length).toBe(3);
    expect(readTrace(repo, { unit: "gh-12/01" }).events.map((e) => e.type)).toEqual(["tick", "hook"]);
    expect(readTrace(repo, { since: "2026-10-24T00:00:00.000Z", types: ["tick"] }).events.length).toBe(2);
    expect(lastTickFor(repo, "gh-12")?.decisions[0]?.unit).toBe("gh-12/01");
    expect(lastTickFor(repo, "gh-99")).toBeNull();
    expect(() => appendTrace(repo, { type: "tick" } as never)).toThrow();
  });
  test("R5.4: only tick.start lines are fsynced before act", () => {
    const repo = tmp();
    const sync = spyOn(fs, "fsyncSync");
    try {
      appendTrace(repo, tick("gh-12", AT));
      appendTrace(repo, { type: "tick.end", tick_id: ulid(), at: AT, duration_ms: 3, failed: 0 });
      expect(sync).not.toHaveBeenCalled();
      appendTrace(repo, { type: "tick.start", tick_id: ulid(), at: AT, heartbeat_id: null, decisions: [{ unit: "gh-12", rule: "noop.idle", action: { kind: "noop" } }] });
      expect(sync).toHaveBeenCalled();
    } finally {
      sync.mockRestore();
    }
    expect(readTrace(repo).events.map((e) => e.type)).toEqual(["tick", "tick.end", "tick.start"]);
  });
  test("B4 (D2): every line is written with `type` as its first key", () => {
    const repo = tmp();
    const end = { tick_id: ulid(), at: AT, duration_ms: 3, failed: 0, type: "tick.end" } as unknown as TraceEvent;
    appendTrace(repo, end);
    appendTrace(repo, { fact: { event: "turn_end", at: AT, agent: "claude", native: "Stop", cwd: "/w", story: "gh-12" }, id: ulid(), type: "hook" } as unknown as TraceEvent);
    const lines = readTraceFile(repo, "2026-10-23.jsonl")?.trim().split("\n") ?? [];
    expect(lines.map((l) => Object.keys(JSON.parse(l))[0])).toEqual(["type", "type"]);
    expect(lines[0]).toStartWith('{"type":"tick.end",');
    expect(readTrace(repo).events.map((e) => e.type)).toEqual(["tick.end", "hook"]);
  });
  test("B4 (D2): a reader given types skips lines of other types unparsed; a reader of every type reports them", () => {
    const repo = tmp();
    appendTrace(repo, tick("gh-12", AT));
    const day = join(machineDir(repo), "2026-10-23.jsonl");
    appendFileSync(day, '{"type":"tick.start",broken\n');
    // an older norn's line with `type` not first is parsed, not skipped
    const old = tick("gh-12", "2026-10-23T00:00:05.000Z") as Record<string, unknown>;
    const { type, ...rest } = old;
    appendFileSync(day, `${JSON.stringify({ ...rest, type })}\n`);
    appendFileSync(day, `${JSON.stringify({ ...rest, tick_id: ulid(), type: "tick.end", duration_ms: 1, failed: 0, facts: undefined, decisions: undefined, heartbeat_id: undefined })}\n`);
    const ticks = readTrace(repo, { types: ["tick"] });
    expect(ticks.errors).toEqual([]);
    expect(ticks.events.map((e) => e.type)).toEqual(["tick", "tick"]);
    const all = readTrace(repo);
    expect(all.errors.map((e) => e.file)).toEqual(["2026-10-23.jsonl:2"]);
    expect(all.events.map((e) => e.type)).toEqual(["tick", "tick", "tick.end"]);
    // a typed reader still reports a bad line of a type it asked for
    appendFileSync(day, '{"type":"tick","tick_id":"x"}\n');
    expect(readTrace(repo, { types: ["tick"] }).errors.map((e) => e.file)).toEqual(["2026-10-23.jsonl:5"]);
  });
  test("B4: the trace-read observer sees every day file each reader opens", () => {
    const repo = tmp();
    const runId = "01M5MA3PG0DB4G1MJNV0HKQYSA"; // a ulid of AT
    appendTrace(repo, tick("gh-12", AT));
    appendTrace(repo, { type: "hook", id: ulid(), blocked: true, fact: { event: "turn_end", at: "2026-10-24T00:00:03.000Z", agent: "claude", native: "Stop", cwd: "/w", story: "gh-12", run_id: runId } });
    const seen: string[] = [];
    const prev = setTraceReadObserver(({ file }) => seen.push(file));
    try {
      const opened = (read: () => unknown) => {
        seen.length = 0;
        read();
        return [...seen];
      };
      const both = [join(machineDir(repo), "2026-10-23.jsonl"), join(machineDir(repo), "2026-10-24.jsonl")];
      expect(opened(() => readTrace(repo, { types: ["tick"] }))).toEqual(both);
      expect(opened(() => inboxHistory(repo))).toEqual(both);
      expect(opened(() => readHookFacts(repo, AT))).toEqual(both);
      // B9: the blocked count reads the unit's hook file, never a day file (this hook is only in the day file)
      expect(opened(() => blockedHookCount(repo, { story: "gh-12" }, runId))).toEqual([]);
      expect(opened(() => readHookFacts(repo, "2026-10-24T00:00:00.000Z"))).toEqual(both.slice(1));
    } finally {
      expect(setTraceReadObserver(prev)).not.toBeNull();
    }
    expect(setTraceReadObserver(null)).toBeNull();
  });
  test("replay inputs of a tick (O5): facts without the replay block, workflows read back from trace/workflows, config", () => {
    const repo = tmp();
    const hash = "a".repeat(64);
    writeTraceFile(repo, `workflows/${hash}.yaml`, WORKFLOW_YAML);
    const config = { max_agents: 2 } as unknown as ResolvedConfig;
    const issues = [{ path: "steps", message: "odd" }];
    const t = { ...tick("gh-12", AT), facts: { now: Date.parse(AT), tick_id: "T", replay: { workflows: { slice: { hash, issues }, gone: { hash: null, issues: [] } }, config } } } as TickTrace;
    const read = readTickInputs(repo, t);
    const inputs = read.ok ? read.inputs : null;
    expect(inputs?.facts as unknown).toEqual({ now: Date.parse(AT), tick_id: "T" });
    expect(inputs?.config).toBe(config);
    expect(inputs?.workflows.slice).toMatchObject({ name: "slice", source: WORKFLOW_YAML, issues, workflow: { name: "slice", start: "implement" } });
    expect(inputs?.workflows.gone).toEqual({ name: "gone", workflow: null, source: "", issues: [] });
    // a tick an older norn recorded without the replay block
    expect(readTickInputs(repo, tick("gh-12", AT) as TickTrace)).toEqual({ ok: false, reason: "no_replay" });
  });
  test("A2/A4 (B5, D3): a unit's hook events — from its own hook file, since a time, oldest first, each id once; blocked ones counted per run", () => {
    const repo = tmp();
    const run9 = "01M5MA3PG0DB4G1MJNV0HKQYSA"; // a ulid of AT
    const hook = (at: string, cwd: string, extra: Record<string, unknown> = {}, blocked = false): HookTrace =>
      ({ type: "hook", id: ulid(), ...(blocked ? { blocked: true, reason: "r" } : {}), fact: { event: "turn_end", at, agent: "claude", native: "Stop", cwd, ...extra } }) as HookTrace;
    const gh9 = { story: "gh-9" };
    const gh9s = { story: "gh-9", slice: "gh-9/01" };
    const gh10 = { story: "gh-10" };
    const late = hook("2026-10-23T12:00:05.000Z", "/w/gh-9", { story: "gh-9", run_id: run9 }, true);
    expect(appendHookTrace(repo, gh9, late)).toBe("2026-10-23.jsonl");
    appendHookTrace(repo, gh9, hook("2026-10-23T12:00:01.000Z", "/w/gh-9/sub", { story: "gh-9" }));
    appendHookTrace(repo, gh10, hook("2026-10-23T12:00:02.000Z", "/w/gh-10", { story: "gh-10" }, true));
    appendHookTrace(repo, gh9, hook("2026-10-24T00:00:01.000Z", "/w/gh-9", { story: "gh-9", run_id: run9 }, true));
    appendHookTrace(repo, gh9s, hook("2026-10-24T00:00:02.000Z", "/w/gh-9--01", { story: "gh-9", slice: "gh-9/01" }));
    // B7: the unit is the one written to, whatever the fact names
    appendHookTrace(repo, gh10, hook("2026-10-24T00:00:03.000Z", "/elsewhere", { story: "gh-10", run_id: ulid() }));
    // D4: the hook file's time is its latest fact's; an older fact appended later never moves it back
    expect(unitHooksChangedAt(repo, gh9)).toBe(Date.parse("2026-10-24T00:00:01.000Z"));
    expect(unitHooksChangedAt(repo, gh10)).toBe(Date.parse("2026-10-24T00:00:03.000Z"));
    // a duplicate line (a backfill overlapping an append) is read once
    appendFileSync(hookFilePath(repo, gh9), `${JSON.stringify(late)}\n`);
    expect(hookFilePath(repo, gh9)).toBe(join(machineDir(repo), "hooks/gh-9/_story.jsonl"));
    expect(hookFilePath(repo, gh9s)).toBe(join(machineDir(repo), "hooks/gh-9/01.jsonl"));
    // every line also lands in its day file (B5)
    expect(readTrace(repo, { types: ["hook"] }).events).toHaveLength(6);

    const seen: string[] = [];
    const prev = setTraceReadObserver(({ file, kind }) => seen.push(`${kind} ${file.slice(machineDir(repo).length + 1)}`));
    const ats = (units: Parameters<typeof readUnitHooks>[1], since: string) => readUnitHooks(repo, units, since).map((evs) => evs.map((e) => e.fact.at.slice(11, 19)));
    try {
      // the story unit no longer sees its slice's hooks: each unit has its own file
      expect(ats([gh9, gh9s, gh10, { story: "gh-11" }], AT)).toEqual([["12:00:01", "12:00:05", "00:00:01"], ["00:00:02"], ["12:00:02", "00:00:03"], []]);
      expect(ats([gh10], "2026-10-24T00:00:00.000Z")).toEqual([["00:00:03"]]);
      expect(readUnitHooks(repo, [gh9], AT)[0]?.filter((e) => e.blocked).map((e) => e.reason)).toEqual(["r", "r"]);
      expect(blockedHookCount(repo, gh9, run9)).toBe(2);
      expect(blockedHookCount(repo, gh10, run9)).toBe(0);
    } finally {
      setTraceReadObserver(prev);
    }
    // B8–B10: only the units' own hook files are opened (gh-11 has none), no day file
    expect([...new Set(seen)].sort()).toEqual(["hook hooks/gh-10/_story.jsonl", "hook hooks/gh-9/01.jsonl", "hook hooks/gh-9/_story.jsonl"]);
    expect(unitHooksChangedAt(repo, { story: "gh-11" })).toBeNull();
  });
  test("briefings stored by trace-relative path (B4)", () => {
    const repo = tmp();
    const rel = writeBriefing(repo, "R1", "T1", "# brief");
    expect(rel).toBe("briefings/R1/T1.md");
    expect(readTraceFile(repo, rel)).toBe("# brief");
    expect(() => readTraceFile(repo, "../../x")).toThrow();
  });
});

describe("decisionUnit (F5)", () => {
  test("intake decisions recorded as unit '*' by an older norn belong to the story in the action", () => {
    expect(decisionUnit({ unit: "*", action: { kind: "intake_story", key: "gh-1" } })).toBe("gh-1");
    expect(decisionUnit({ unit: "*", action: { kind: "noop" } })).toBe("*");
    expect(decisionUnit({ unit: "gh-2/01", action: { kind: "noop" } })).toBe("gh-2/01");
  });
});

// ---------------------------------------------------------------- chunked tick facts (gh-107 D6–D8)

const GOLDEN = join(import.meta.dir, "../../../core/test/golden");
type Inputs = { facts: Facts; workflows: Record<string, LoadedWorkflow>; config: ResolvedConfig };
const golden = (): Array<{ name: string } & Inputs> =>
  readdirSync(GOLDEN)
    .filter((n) => n.endsWith(".json"))
    .sort()
    .map((name) => ({ name, ...(JSON.parse(readFileSync(join(GOLDEN, name), "utf8")) as Inputs) }));

/** A golden case whose facts hold a run, so tests can give that run hooks. */
function withRun(): Inputs {
  const c = golden().find((g) => g.facts.stories.some((s) => s.units.some((u) => u.run))) as Inputs;
  return JSON.parse(JSON.stringify({ facts: c.facts, workflows: c.workflows, config: c.config })) as Inputs;
}

function hooks(n: number): HookFact[] {
  return Array.from({ length: n }, (_, i) => ({ event: "tool_use", at: new Date(Date.parse(AT) + i * 1000).toISOString(), agent: "claude", native: "PostToolUse", cwd: "/w", story: "gh-1" }) as HookFact);
}

function setHooks(inputs: Inputs, list: HookFact[]): Inputs {
  const run = inputs.facts.stories.flatMap((s) => s.units).find((u) => u.run)?.run;
  if (run) run.hooks = list;
  return inputs;
}

const tickFields = (at: string, tickId = ulid(Date.parse(at))) => ({
  tick_id: tickId,
  at,
  heartbeat_id: null,
  duration_ms: 3,
  decisions: [{ unit: "gh-1", rule: "noop.idle", action: { kind: "noop" }, result: { ok: true } }],
});

const ticksOf = (repo: string) => readTrace(repo, { types: ["tick"] }).events as TickTrace[];
const day = (at: string) => at.slice(0, 10);
const chunksPath = (repo: string, at: string) => join(machineDir(repo), `${day(at)}.chunks.jsonl`);
const chunkLines = (repo: string, at: string) =>
  (readTraceFile(repo, `${day(at)}.chunks.jsonl`) ?? "")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { h: string; v: unknown });
/** facts, workflows and config as `norn why` rebuilds them, as JSON text (byte-for-byte comparisons, B17) */
const readBack = (repo: string, t: TickTrace) => {
  const r = readTickInputs(repo, t);
  if (!r.ok) throw new Error(JSON.stringify(r));
  return { facts: JSON.stringify(r.inputs.facts), workflows: JSON.stringify(r.inputs.workflows), config: JSON.stringify(r.inputs.config) };
};
const asText = (i: Inputs) => ({ facts: JSON.stringify(i.facts), workflows: JSON.stringify(i.workflows), config: JSON.stringify(i.config) });

describe("chunked tick facts (O4, O5)", () => {
  test("B17: every golden case's inputs round-trip through a chunked tick byte for byte", () => {
    const repo = tmp();
    const cases = golden();
    expect(cases.length).toBeGreaterThan(50);
    for (const [i, c] of cases.entries()) appendTick(repo, tickFields(new Date(Date.parse(AT) + i * 60_000).toISOString()), c);
    const ticks = ticksOf(repo);
    expect(ticks.map((t) => t.facts.$chunked)).toEqual(cases.map(() => 1));
    for (const [i, t] of ticks.entries()) expect(readBack(repo, t)).toEqual(asText(cases[i] as Inputs));
  });

  test("B13 (D6, D7): a tick line holds a skeleton; a second tick on the same facts adds no chunk", () => {
    const repo = tmp();
    const c = withRun();
    appendTick(repo, tickFields(AT), c);
    const chunks = readTraceFile(repo, "2026-10-23.chunks.jsonl") as string;
    const [t1] = ticksOf(repo);
    expect(Object.keys(t1?.facts ?? {})[0]).toBe("$chunked");
    expect((t1?.facts.stories as unknown[]).every((s) => Object.keys(s as object).join() === "$chunk")).toBe(true);
    appendTick(repo, tickFields("2026-10-23T12:01:00.000Z"), c);
    expect(readTraceFile(repo, "2026-10-23.chunks.jsonl")).toBe(chunks);
    expect(ticksOf(repo).map((t) => readBack(repo, t))).toEqual([asText(c), asText(c)]);
  });

  test("B14: 416 hook facts make 6 full blocks of 64 written once; later ticks add only the changed partial block", () => {
    const repo = tmp();
    const c = withRun();
    const all = hooks(420);
    const blocks = () => chunkLines(repo, AT).filter((l) => Array.isArray(l.v) && (l.v as Array<{ event?: string }>)[0]?.event === "tool_use");
    appendTick(repo, tickFields(AT), setHooks(c, all.slice(0, 416)));
    expect(blocks().map((b) => (b.v as unknown[]).length)).toEqual([64, 64, 64, 64, 64, 64, 32]);
    appendTick(repo, tickFields("2026-10-23T12:01:00.000Z"), setHooks(c, all.slice(0, 416)));
    expect(blocks().length).toBe(7);
    appendTick(repo, tickFields("2026-10-23T12:02:00.000Z"), setHooks(c, all.slice(0, 420)));
    expect(blocks().map((b) => (b.v as unknown[]).length)).toEqual([64, 64, 64, 64, 64, 64, 32, 36]);
    // every block is written once
    expect(new Set(blocks().map((b) => b.h)).size).toBe(8);
    const lens = ticksOf(repo).map((t) => (JSON.parse(readBack(repo, t).facts) as Facts).stories.flatMap((s) => s.units).find((u) => u.run)?.run?.hooks.length);
    expect(lens).toEqual([416, 416, 420]);
    expect(readBack(repo, ticksOf(repo)[2] as TickTrace).facts).toBe(JSON.stringify(setHooks(c, all).facts));
  });

  test("B15: chunks appended without their tick line (and a torn last chunk line) leave earlier ticks reading as before", () => {
    const repo = tmp();
    const c = withRun();
    appendTick(repo, tickFields(AT), c);
    const before = readBack(repo, ticksOf(repo)[0] as TickTrace);
    // a tick killed after its chunks: extra chunk lines, then a write torn mid-line
    appendFileSync(chunksPath(repo, AT), `{"h":"${"b".repeat(64)}","v":{"x":1}}\n{"h":"${"c".repeat(64)}","v":{"x"`);
    expect(ticksOf(repo).length).toBe(1);
    expect(readBack(repo, ticksOf(repo)[0] as TickTrace)).toEqual(before);
    // the next tick's chunks start on a line of their own
    const changed = setHooks(withRun(), hooks(3));
    appendTick(repo, tickFields("2026-10-23T12:01:00.000Z"), changed);
    expect(ticksOf(repo).map((t) => readBack(repo, t))).toEqual([before, asText(changed)]);
  });

  test("B16: when the chunks file changed behind the process, the next tick writes its chunks again and every tick reads the same", () => {
    const repo = tmp();
    const c = withRun();
    appendTick(repo, tickFields(AT), c);
    // lost: the file this process remembers is gone
    rmSync(chunksPath(repo, AT));
    appendTick(repo, tickFields("2026-10-23T12:01:00.000Z"), c);
    expect(ticksOf(repo).map((t) => readBack(repo, t))).toEqual([asText(c), asText(c)]);
    // stale: another writer appended to it (here, duplicates of chunks already there)
    const lines = readTraceFile(repo, "2026-10-23.chunks.jsonl") as string;
    appendFileSync(chunksPath(repo, AT), lines);
    const changed = setHooks(withRun(), hooks(70));
    appendTick(repo, tickFields("2026-10-23T12:02:00.000Z"), changed);
    appendTick(repo, tickFields("2026-10-23T12:03:00.000Z"), c);
    expect(ticksOf(repo).map((t) => readBack(repo, t))).toEqual([asText(c), asText(c), asText(changed), asText(c)]);
  });

  test("B19: one day's day file and chunks file alone replay every tick of that day; no chunk comes from another day", () => {
    const repo = tmp();
    const c = withRun();
    const next = "2026-10-24T00:00:05.000Z";
    appendTick(repo, tickFields(AT), c);
    appendTick(repo, tickFields(next), c);
    appendTick(repo, tickFields("2026-10-24T00:01:05.000Z"), setHooks(withRun(), hooks(65)));
    const copy = tmp();
    mkdirSync(machineDir(copy), { recursive: true });
    for (const f of ["2026-10-24.jsonl", "2026-10-24.chunks.jsonl"]) copyFileSync(join(machineDir(repo), f), join(machineDir(copy), f));
    const ticks = ticksOf(copy);
    expect(ticks.length).toBe(2);
    expect(ticks.map((t) => readBack(copy, t))).toEqual([asText(c), asText(setHooks(withRun(), hooks(65)))]);
  });

  test("B21: a tick whose chunk line is gone is a corrupt trace entry naming the missing hash, with no facts", () => {
    const repo = tmp();
    const c = withRun();
    appendTick(repo, tickFields(AT), c);
    const [t] = ticksOf(repo);
    const story = (t?.facts.stories as Array<{ $chunk: string }>)[0]?.$chunk as string;
    const kept = chunkLines(repo, AT).filter((l) => l.h !== story);
    writeFileSync(chunksPath(repo, AT), kept.map((l) => `${JSON.stringify(l)}\n`).join(""));
    const r = readTickInputs(repo, t as TickTrace);
    expect(r).toMatchObject({ ok: false, reason: "corrupt", error: { file: "2026-10-23.chunks.jsonl" } });
    expect(JSON.stringify(r)).toContain(story);
    expect("inputs" in r).toBe(false);
    // a day with no chunks file at all
    rmSync(chunksPath(repo, AT));
    expect(readTickInputs(repo, t as TickTrace)).toMatchObject({ ok: false, reason: "corrupt" });
  });

  test("B18: a full-facts tick written as the previous version wrote it reads as before, beside chunked ones", () => {
    const repo = tmp();
    const c = withRun();
    appendTick(repo, tickFields(AT), c);
    const hash = sha256(WORKFLOW_YAML);
    writeTraceFile(repo, `workflows/${hash}.yaml`, WORKFLOW_YAML);
    const full = { ...tickFields("2026-10-23T12:01:00.000Z"), type: "tick", facts: { ...c.facts, replay: { workflows: { slice: { hash, issues: [] } }, config: c.config } } } as TickTrace;
    appendTrace(repo, full);
    const [chunked, old] = ticksOf(repo);
    expect(readBack(repo, chunked as TickTrace)).toEqual(asText(c));
    const r = readTickInputs(repo, old as TickTrace);
    expect(r.ok && JSON.stringify(r.inputs.facts)).toBe(JSON.stringify(c.facts));
    expect(r.ok && r.inputs.workflows.slice).toMatchObject({ source: WORKFLOW_YAML, workflow: { start: "implement" } });
  });
});
