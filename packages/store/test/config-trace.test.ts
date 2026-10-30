import { describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { type ResolvedConfig, type TickTrace, type TraceEvent, ulid } from "@norn/schema";
import {
  appendTrace,
  blockedHookCount,
  decisionUnit,
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
  setTraceReadObserver,
  traceDir,
  writeBriefing,
  writeTraceFile,
} from "../src/index.ts";
import { AT, tmp, WORKFLOW_YAML } from "./helpers.ts";

describe("config (K2)", () => {
  test("user + repo layers merged; home from param or NORN_HOME_DIR; missing = defaults", () => {
    const repo = tmp();
    const home = tmp();
    expect(loadConfig({ repoRoot: repo, home })).toMatchObject({ ok: true, config: { max_agents: 2 } });
    writeFileSync(join(home, "config.yaml"), "max_agents: 4\ndefault_mode: auto\n");
    mkdirSync(join(repo, ".agents/norn"), { recursive: true });
    writeFileSync(join(repo, ".agents/norn/config.yaml"), "max_agents: 8\nremote: { label: mine }\n");
    const c = loadConfig({ repoRoot: repo, env: { NORN_HOME_DIR: home } });
    expect(c.ok && c.config).toMatchObject({ max_agents: 4, default_mode: "auto", remote: { label: "mine", provider: "gh" } });
    expect(c.home).toBe(home);
  });
  test("invalid layer → errors with repo-relative path", () => {
    const repo = tmp();
    mkdirSync(join(repo, ".agents/norn"), { recursive: true });
    writeFileSync(join(repo, ".agents/norn/config.yaml"), "max_agents: zero\n");
    const c = loadConfig({ repoRoot: repo, home: tmp() });
    expect(c.ok).toBe(false);
    expect(!c.ok && c.errors[0]?.file).toBe(".agents/norn/config.yaml");
  });
});

describe("workflows (W1)", () => {
  test("loads yaml and json, reports invalid and name mismatch", () => {
    const repo = tmp();
    const dir = join(repo, ".agents/norn/workflows");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "slice.yaml"), WORKFLOW_YAML);
    writeFileSync(join(dir, "bug.json"), JSON.stringify({ name: "bug", start: "fix", steps: { fix: { type: "gate", outcomes: { approve: "$done" } } } }));
    writeFileSync(join(dir, "story.yaml"), "name: other\nstart: a\nsteps: {}\n");
    writeFileSync(join(dir, "README.md"), "ignored");
    const l = loadWorkflows(repo);
    expect(Object.keys(l.workflows).sort()).toEqual(["bug", "slice"]);
    expect(l.errors.map((e) => e.file)).toEqual([".agents/norn/workflows/story.yaml"]);
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
    appendFileSync(join(traceDir(repo), "2026-10-24.jsonl"), "garbage\n");
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
    const day = join(traceDir(repo), "2026-10-23.jsonl");
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
      const both = [join(traceDir(repo), "2026-10-23.jsonl"), join(traceDir(repo), "2026-10-24.jsonl")];
      expect(opened(() => readTrace(repo, { types: ["tick"] }))).toEqual(both);
      expect(opened(() => inboxHistory(repo))).toEqual(both);
      expect(opened(() => readHookFacts(repo, AT))).toEqual(both);
      expect(opened(() => blockedHookCount(repo, { story: "gh-12", worktree: "/w" }, runId))).toEqual(both);
      expect(blockedHookCount(repo, { story: "gh-12", worktree: "/w" }, runId)).toBe(1);
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
    const inputs = readTickInputs(repo, t);
    expect(inputs?.facts as unknown).toEqual({ now: Date.parse(AT), tick_id: "T" });
    expect(inputs?.config).toBe(config);
    expect(inputs?.workflows.slice).toMatchObject({ name: "slice", source: WORKFLOW_YAML, issues, workflow: { name: "slice", start: "implement" } });
    expect(inputs?.workflows.gone).toEqual({ name: "gone", workflow: null, source: "", issues: [] });
    // a tick an older norn recorded without the replay block
    expect(readTickInputs(repo, tick("gh-12", AT) as TickTrace)).toBeNull();
  });
  test("A2/A4: a unit's hook events — its own (marker or worktree) since a time, oldest first; blocked ones counted per run", () => {
    const repo = tmp();
    const run9 = "01M5MA3PG0DB4G1MJNV0HKQYSA"; // a ulid of AT
    const hook = (at: string, cwd: string, extra: Record<string, unknown> = {}, blocked = false): TraceEvent =>
      ({ type: "hook", id: ulid(), ...(blocked ? { blocked: true, reason: "r" } : {}), fact: { event: "turn_end", at, agent: "claude", native: "Stop", cwd, ...extra } }) as TraceEvent;
    appendTrace(repo, hook("2026-10-23T12:00:05.000Z", "/w/gh-9", { story: "gh-9", run_id: run9 }, true));
    appendTrace(repo, hook("2026-10-23T12:00:01.000Z", "/w/gh-9/sub", { story: "gh-9" }));
    appendTrace(repo, hook("2026-10-23T12:00:02.000Z", "/w/gh-10", { story: "gh-10" }, true));
    appendTrace(repo, hook("2026-10-24T00:00:01.000Z", "/w/gh-9", { story: "gh-9", run_id: run9 }, true));
    appendTrace(repo, hook("2026-10-24T00:00:02.000Z", "/w/gh-9--01", { story: "gh-9", slice: "gh-9/01" }));
    appendTrace(repo, hook("2026-10-24T00:00:03.000Z", "/elsewhere", { story: "gh-10", run_id: ulid() }));
    const gh9 = { story: "gh-9", worktree: "/w/gh-9" };
    const gh9s = { story: "gh-9", slice: "gh-9/01", worktree: "/w/gh-9--01" };
    const gh10 = { story: "gh-10", worktree: null };
    const ats = (units: Parameters<typeof readUnitHooks>[1], since: string) => readUnitHooks(repo, units, since).map((evs) => evs.map((e) => e.fact.at.slice(11, 19)));
    // the story unit's worktree is a prefix of its slice's, so it sees the slice's hooks too (runHooks picks them so)
    expect(ats([gh9, gh9s, gh10], AT)).toEqual([["12:00:01", "12:00:05", "00:00:01", "00:00:02"], ["00:00:02"], ["12:00:02", "00:00:03"]]);
    expect(ats([gh10], "2026-10-24T00:00:00.000Z")).toEqual([["00:00:03"]]);
    expect(readUnitHooks(repo, [gh9], AT)[0]?.filter((e) => e.blocked).map((e) => e.reason)).toEqual(["r", "r"]);
    expect(blockedHookCount(repo, gh9, run9)).toBe(2);
    expect(blockedHookCount(repo, gh10, run9)).toBe(0);
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
