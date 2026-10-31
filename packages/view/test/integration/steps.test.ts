/**
 * Step timeline (O4, X1): `norn trace` rows per (step, attempt) with entry/exit, duration,
 * outcome, who and the reason, built from real receipts and trace lines of the dogfood
 * sandbox (gh-1 story + slice 03, copied into fixtures/gh-1; trace facts stripped).
 */
import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bindNornHome, machineDir } from "@norn/store";
import { formatStepTimeline, loadTraceView, type StepRow, type TraceView } from "../../src/index.ts";

const FIX = join(import.meta.dir, "fixtures/gh-1");
const SPEC = ".agents/specs/gh-1-projects-and-items";
const NOW = Date.parse("2026-10-23T20:00:00.000Z");
const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

function seed(opts: { trace?: boolean } = {}): string {
  const repo = mkdtempSync(join(tmpdir(), "norn-steps-"));
  dirs.push(repo);
  cpSync(join(FIX, "spec"), join(repo, SPEC), { recursive: true });
  bindNornHome(repo, join(repo, ".home"));
  if (opts.trace !== false) {
    mkdirSync(machineDir(repo), { recursive: true });
    cpSync(join(FIX, "trace.jsonl"), join(machineDir(repo), "2026-10-23.jsonl"));
  }
  return repo;
}

function load(repo: string, key: string, o: { all?: boolean; events?: boolean; storyOnly?: boolean } = {}): TraceView {
  const v = loadTraceView({ repoRoot: repo, home: join(repo, ".home"), env: {}, key, now: NOW, ...o });
  if (!v) throw new Error(`no view for ${key}`);
  return v;
}

const label = (r: StepRow) => `${r.unit} ${r.step}#${r.attempt}`;
const byLabel = (v: TraceView, l: string) => {
  const r = v.steps.find((x) => label(x) === l);
  if (!r) throw new Error(`no row ${l}: ${v.steps.map(label).join(", ")}`);
  return r;
};

describe("slice timeline (gh-1/03)", () => {
  test("one row per (step, attempt) with entry, exit, duration, outcome, type", () => {
    const v = load(seed(), "gh-1/03");
    expect(v.steps.map(label)).toEqual([
      "gh-1/03 implement#1",
      "gh-1/03 test#1",
      "gh-1/03 review#1",
      "gh-1/03 qa#1",
      "gh-1/03 human-qa#1",
      "gh-1/03 integrate#1",
    ]);
    const impl = byLabel(v, "gh-1/03 implement#1");
    expect(impl).toMatchObject({ entered_at: "2026-10-23T16:32:15.328Z", left_at: "2026-10-23T16:34:36.023Z", outcome: "done", to: "test", type: "agent", open: false });
    expect(impl.duration_ms).toBe(Date.parse("2026-10-23T16:34:36.023Z") - Date.parse("2026-10-23T16:32:15.328Z"));
    const check = byLabel(v, "gh-1/03 test#1");
    expect(check).toMatchObject({ type: "check", outcome: "pass", to: "review", entered_at: "2026-10-23T16:34:36.023Z", left_at: "2026-10-23T16:34:41.337Z" });
    expect(byLabel(v, "gh-1/03 integrate#1")).toMatchObject({ type: "git", outcome: "done", to: "$done" });
    expect(v.done_at).toBe("2026-10-23T16:39:15.331Z");
  });

  test("who: agent run, norn tick, person user@machine", () => {
    const v = load(seed(), "gh-1/03");
    expect(byLabel(v, "gh-1/03 implement#1").who).toEqual([{ by: "agent", name: "claude", run_id: "01M5MSPS3H3SZXQHBCH031MQ6B", tick_id: null }]);
    expect(byLabel(v, "gh-1/03 test#1").who).toEqual([{ by: "norn", name: "tick", run_id: "01M5MSTKKDWC3XPS5VGNS4XYHS", tick_id: "01M5MSTKKDC4M1QR3B95XVVB8G" }]);
    expect(byLabel(v, "gh-1/03 human-qa#1").who).toEqual([{ by: "human", name: "jakubpruszynski@MacBook-Pro-Jakub-2", run_id: null, tick_id: null }]);
  });

  test("reason is the full text in JSON, with absolute evidence and receipt paths", () => {
    const repo = seed();
    const v = load(repo, "gh-1/03");
    const qa = byLabel(v, "gh-1/03 qa#1");
    expect(qa.outcome).toBe("partial");
    expect(qa.reason).toContain("AC6 (browser confirm/cancel) = person");
    expect(qa.reason?.length).toBeGreaterThan(300);
    const runs = join(repo, SPEC, "runs/03-web-projects");
    expect(qa.paths.evidence).toEqual([join(runs, "evidence/01M5MSXDF3ZHFXQKG87Z847PKB")]);
    expect(qa.paths.receipts).toEqual([join(runs, "receipts/0006-started.json"), join(runs, "receipts/0007-done.json")]);
    for (const r of v.steps) for (const p of [...r.paths.receipts, ...r.paths.evidence, ...r.paths.logs, ...r.paths.briefings]) expect(p.startsWith("/")).toBe(true);
    expect(qa.paths.briefings.length).toBe(1);
  });

  test("gate time is human wait", () => {
    const v = load(seed(), "gh-1/03");
    const gate = byLabel(v, "gh-1/03 human-qa#1");
    expect(gate).toMatchObject({ type: "gate", outcome: "approve" });
    expect(gate.wait_ms).toBe(gate.duration_ms as number);
    expect(v.totals.human_wait_ms).toBe(gate.wait_ms);
  });

  test("no-op and claim-renew ticks hidden; --events shows the rest, --all shows everything", () => {
    const repo = seed();
    const plain = load(repo, "gh-1");
    expect(plain.steps.every((r) => r.events === undefined)).toBe(true);
    expect(plain.hidden_events).toBeGreaterThan(0);
    const ev = load(repo, "gh-1", { events: true });
    const kinds = ev.steps.flatMap((r) => r.events ?? []).map((e) => e.kind);
    expect(kinds).not.toContain("noop");
    expect(kinds).toContain("apply_receipts");
    expect(kinds).toContain("approve");
    const all = load(repo, "gh-1", { all: true });
    expect(all.steps.flatMap((r) => r.events ?? []).some((e) => e.kind === "noop")).toBe(true);
    expect(all.hidden_events).toBe(0);
  });
});

describe("story timeline (gh-1 with slices)", () => {
  test("story steps interleaved with slice steps in time order", () => {
    const v = load(seed(), "gh-1");
    const labels = v.steps.map(label);
    expect(labels.filter((l) => l.startsWith("gh-1 "))).toEqual([
      "gh-1 refine#1",
      "gh-1 plan#1",
      "gh-1 slice#1",
      "gh-1 approve-plan#1",
      "gh-1 slices#1",
      "gh-1 test#1",
      "gh-1 qa#1",
      "gh-1 implement#1",
      "gh-1 test#2",
      "gh-1 qa#2",
      "gh-1 human-qa#1",
      "gh-1 open-pr#1",
      "gh-1 ready#1",
    ]);
    const i = labels.indexOf("gh-1 slices#1");
    expect(labels.slice(i + 1, i + 7).every((l) => l.startsWith("gh-1/03 "))).toBe(true);
    expect(labels[i + 7]).toBe("gh-1 test#1");
    expect(v.units.map((u) => u.unit)).toEqual(["gh-1", "gh-1/03"]);
  });

  test("rework edge carries the counter and route", () => {
    const v = load(seed(), "gh-1");
    expect(byLabel(v, "gh-1 qa#1")).toMatchObject({ outcome: "fail", to: "implement", counter: { name: "qa_loop", value: 1, max: 2 } });
    expect(byLabel(v, "gh-1 approve-plan#1")).toMatchObject({ type: "gate", duration_ms: 16_680, wait_ms: 16_680 });
  });

  test("totals: wall-clock intake → $done → merge, time per step type, human wait", () => {
    const v = load(seed(), "gh-1");
    expect(v).toMatchObject({ intake_at: "2026-10-23T16:10:41.142Z", done_at: "2026-10-23T16:59:32.187Z", merged_at: "2026-10-23T17:06:32.797Z" });
    expect(v.totals.wall_clock_ms).toBe(Date.parse("2026-10-23T16:59:32.187Z") - Date.parse("2026-10-23T16:10:41.142Z"));
    expect(v.totals.merge_wait_ms).toBe(Date.parse("2026-10-23T17:06:32.797Z") - Date.parse("2026-10-23T16:59:32.187Z"));
    expect(Object.keys(v.totals.by_type).sort()).toEqual(["agent", "check", "gate", "git", "slices"]);
    const story = v.steps.filter((r) => r.unit === "gh-1");
    const gates = v.steps.filter((r) => r.type === "gate").reduce((s, r) => s + (r.duration_ms ?? 0), 0);
    expect(v.totals.human_wait_ms).toBe(gates);
    expect(v.totals.by_type.gate).toBe(story.filter((r) => r.type === "gate").reduce((s, r) => s + (r.duration_ms ?? 0), 0));
    expect(v.units.find((u) => u.unit === "gh-1/03")?.totals.by_type.agent).toBeGreaterThan(0);
  });

  test("--story-only leaves slices out", () => {
    const v = load(seed(), "gh-1", { storyOnly: true });
    expect(v.steps.every((r) => r.unit === "gh-1")).toBe(true);
  });

  test("without a trace (pruned), rows still come from receipts alone", () => {
    const v = load(seed({ trace: false }), "gh-1", { storyOnly: true });
    expect(v.steps.map((r) => `${r.step}#${r.attempt}`)).toEqual([
      "refine#1",
      "plan#1",
      "slice#1",
      "approve-plan#1",
      "slices#1",
      "test#1",
      "qa#1",
      "implement#1",
      "test#2",
      "qa#2",
      "human-qa#1",
      "open-pr#1",
      "ready#1",
    ]);
    for (const r of v.steps) {
      expect(r.entered_at).not.toBeNull();
      expect(r.duration_ms).not.toBeNull();
      expect(r.who.length).toBeGreaterThan(0);
    }
    expect(byLabel(v, "gh-1 plan#1").entered_at).toBe("2026-10-23T16:13:28.453Z");
    expect(v.merged_at).toBeNull();
  });

  test("text: header with totals, indented slices, truncated reasons unless --full", () => {
    const repo = seed();
    const text = formatStepTimeline(load(repo, "gh-1"));
    expect(text).toContain("gh-1 · Projects and items · done");
    expect(text).toContain("wall-clock 48m51s");
    expect(text).toMatch(/\n {2}gh-1\/03 +implement#1/);
    expect(text).toMatch(/\ngh-1 +refine#1 +16:11:14 +16:13:41 +2m27s +done +claude run 01M5MRHZK7F089C3QW0FFY796H/);
    expect(text).not.toContain("noop");
    expect(text).toContain("…");
    expect(text).not.toContain("AC6 (browser confirm/cancel) = person: no browser here.");
    const full = formatStepTimeline(load(repo, "gh-1"), { full: true });
    expect(full).toContain("AC6 (browser confirm/cancel) = person: no browser here.");
    expect(full).toContain(join(repo, SPEC, "runs/03-web-projects/evidence/01M5MSXDF3ZHFXQKG87Z847PKB"));
  });
});
