/**
 * gh-78 (O4): a real tick records where it spent its time. One sync tick over the harness (real git,
 * FakeRemote with one running story): its tick record carries the sync report, observe's phases and
 * the remote calls the sync made (counted against what FakeRemote saw), each action's time; its
 * `tick.end` line and `norn tick` name the slowest phase; the heartbeat carries the tick's duration
 * into `norn story list`.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { type TickEndTrace, type TickTrace, validate } from "@norn/schema";
import { readTrace, workflowsDir } from "@norn/store";
import type { ProjectView } from "@norn/view";
import type { TickReport } from "../../src/index.ts";
import { createHarness, type Harness, issue } from "../../../../test/support/harness.ts";
import { runStateOf } from "../../../../test/support/run-state.ts";

setDefaultTimeout(30_000);

const WORKFLOW = `name: one
start: implement
steps:
  implement:
    type: agent
    skill: norn-implement
    outcomes: { done: $done }
`;

describe("gh-78: a tick records where it spent its time", () => {
  let h: Harness;
  const branch = "gh-7-time-me";
  const runs = () => runStateOf(join(`${h.root}-worktrees/${branch}`, `.agents/specs/${branch}`));
  let report: TickReport;
  let record: TickTrace;
  let end: TickEndTrace;
  let calls: string[];

  beforeAll(async () => {
    h = await createHarness();
    expect((await h.norn("init")).exit).toBe(0);
    h.config("provider: gh\nworkflow: one\nmode: auto\n");
    h.write(join(workflowsDir(h.root), "one.yaml"), WORKFLOW);
    h.git(["add", "-A"]);
    h.git(["commit", "-q", "-m", "norn"]);
    h.git(["push", "-q", "origin", "main"]);
    h.remote.issues = [issue(7, "Time me")];
    for (let i = 0; i < 6 && h.state(runs())?.status !== "running"; i++) {
      h.clock.advance(10_000);
      await h.tick();
    }
    expect(h.state(runs())?.status).toBe("running");
    // the tick under test: a forced sync with the story running, past the claim's renew time (3m20s) so its claim is renewed
    h.clock.advance(4 * 60_000);
    h.remote.calls = [];
    report = await h.tick("--sync");
    calls = [...h.remote.calls];
    const ticks = readTrace(h.root, { types: ["tick"] }).events as TickTrace[];
    record = ticks.at(-1)!;
    end = (readTrace(h.root, { types: ["tick.end"] }).events as TickEndTrace[]).at(-1)!;
  });
  afterAll(() => h?.cleanup());

  test("the tick record carries the sync report and validates", () => {
    expect(record.tick_id).toBe(end.tick_id);
    expect(record.sync).toEqual({ ran: true, ok: true });
    expect(validate("trace", record).ok).toBe(true);
  });

  test("observe's phases are timed and the sync's remote calls counted as made", () => {
    const t = record.timing!;
    expect(Object.keys(t.observe)).toEqual(expect.arrayContaining(["worktrees", "local", "sync.issues", "sync.stories", "stories"]));
    for (const v of [t.observe_ms, t.decide_ms, t.act_ms, t.after_ms, ...Object.values(t.observe)]) expect(Number.isInteger(v) && v >= 0).toBe(true);
    // each phase lies inside observe
    expect(Object.values(t.observe).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(t.observe_ms + Object.keys(t.observe).length);
    const made = (prefix: string) => calls.filter((c) => c.startsWith(prefix)).length;
    expect(t.calls?.list_issues).toBe(made("list "));
    expect(t.calls?.list_issues).toBe(1);
    expect(t.calls?.find_pr ?? 0).toBe(made("pr? "));
    // gh-186: every PR of the sync in one batched call per kind of story, never one per story
    expect(t.calls?.find_prs ?? 0).toBe(made("prs? "));
    expect(made("pr? ")).toBe(0);
    expect(t.calls?.get_issue ?? 0).toBe(made("issue "));
    expect(t.calls?.pr_ci ?? 0).toBe(made("ci? "));
  });

  test("each action's time is in its result, the claim renewal's included", () => {
    expect(record.decisions.some((d) => d.rule === "claim.renew")).toBe(true);
    for (const d of record.decisions) expect(Number.isInteger(d.result.ms) && d.result.ms! >= 0).toBe(true);
  });

  test("tick.end and `norn tick` name the slowest phase, the one the record names", () => {
    expect(end.slowest).toEqual(record.timing!.slowest);
    expect(report.slowest).toEqual(record.timing!.slowest);
    expect(end.slowest!.phase).toMatch(/^(observe(\.\S+)?|decide|after|act \S+ \S+.*)$/);
  });

  test("the heartbeat carries the last tick's duration into `norn story list`", async () => {
    const view = (await h.norn("story", "list", "--json")).value as ProjectView;
    expect(view.heartbeat.last_tick_ms).toBe(record.duration_ms);
  });
});
