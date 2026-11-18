import { describe, expect, test } from "bun:test";
import { memoryFiles, memoryHost } from "@norn/conformance";
import { ulidTime } from "@norn/schema";
import { launchRecordPath } from "../../src/events/paths.ts";
import { checkExitPath, checkLogPath, pruneTraces, sessionLogPath, TRACE_PRUNE_PER_TICK, tracePath } from "../../src/index.ts";
import { has, harness, record, tickUntil, trackerItem } from "./support.ts";

const DAY = 24 * 3_600_000;
// the harness's tick ids all carry its seed's time, so traces are aged against that
const SEED_TIME = ulidTime("01JD5G00000000000000000000");

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** A tick id at `ms`, unlike `ulid` free of the monotonic clamp, so a test can mint ids in the past after newer ones. */
function idAt(ms: number): string {
  let time = "";
  for (let i = 0, t = ms; i < 10; i++, t = Math.floor(t / 32)) time = CROCKFORD[t % 32] + time;
  return `${time}${"0".repeat(16)}`;
}

const traceNames = async (files: { list(dir: string): Promise<string[]> }) => files.list("/machine/repo/trace-v2");

describe("trace retention", () => {
  test("a tick removes the traces older than the default week, keeps younger ones and names that are no tick id", async () => {
    const h = harness();
    const old = [idAt(SEED_TIME - 9 * DAY), idAt(SEED_TIME - 8 * DAY)];
    const young = idAt(SEED_TIME - 6 * DAY);
    for (const id of [...old, young]) await h.files.write(tracePath(h.ctx, id), "{}\n");
    await h.files.write("/machine/repo/trace-v2/notes.json", "mine\n");
    const [r] = await tickUntil(h, () => true);
    expect(r?.problems).toEqual([]);
    expect(await traceNames(h.files)).toEqual([`${young}.json`, `${r?.tick_id}.json`, "notes.json"].sort());
  });

  test("a backlog drains a bounded number per tick, oldest first", async () => {
    const h = harness();
    const backlog = Array.from({ length: TRACE_PRUNE_PER_TICK + 3 }, (_, i) => idAt(SEED_TIME - 30 * DAY + i));
    for (const id of backlog) await h.files.write(tracePath(h.ctx, id), "{}\n");
    await tickUntil(h, () => true);
    expect(await traceNames(h.files)).toEqual([...backlog.slice(TRACE_PRUNE_PER_TICK).map((id) => `${id}.json`), `${h.tickIds[0]}.json`]);
    await tickUntil(h, () => true);
    expect(await traceNames(h.files)).toEqual(h.tickIds.map((id) => `${id}.json`));
  });

  test("keep removes nothing; a trace that cannot be removed is a problem, never a throw", async () => {
    const files = memoryFiles();
    const ctx = memoryHost({ files, repo: { root: "/repo", dataDir: "/machine/repo" } });
    const now = idAt(SEED_TIME);
    const old = idAt(SEED_TIME - 10 * DAY);
    await files.write(tracePath(ctx, old), "{}\n");
    expect(await pruneTraces(ctx, now, null)).toEqual([]);
    expect(await traceNames(files)).toEqual([`${old}.json`]);
    files.failWrites(true);
    const problems = await pruneTraces(ctx, now, DAY);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toStartWith("trace retention: 1 file could not be removed; first: /machine/repo/trace-v2/");
    files.failWrites(false);
    expect(await pruneTraces(ctx, now, DAY)).toEqual([]);
    expect(await traceNames(files)).toEqual([]);
  });
});

describe("a finished story's logs", () => {
  test("finishing a done story removes its units' hook events, session logs and check logs, and nobody else's", async () => {
    const h = harness();
    h.items.push(trackerItem(1));
    await tickUntil(h, has("check.finished"));
    const runs = (await record(h, "lt-1")).receipts.flatMap((r) => (r.data.kind === "run.started" ? [r.data.run_id] : []));
    expect(runs).toHaveLength(1);
    const run = runs[0] as string;
    const ours = [
      `/machine/repo/events-v2/lt-1/${run}/events/000000000001.json`,
      `/machine/repo/events-v2/lt-1/${run}/sent/p1.json`,
      launchRecordPath(h.ctx, "lt-1", run),
      sessionLogPath(h.ctx, run),
      checkLogPath(h.ctx, "lt-1", run, 1),
      checkExitPath(h.ctx, "lt-1", run, 1),
    ];
    const others = [`/machine/repo/events-v2/lt-2/R2/events/000000000001.json`, sessionLogPath(h.ctx, "R2"), checkLogPath(h.ctx, "lt-1", "OTHER", 1)];
    for (const p of [...ours, ...others]) await h.files.write(p, "x\n");
    const reports = await tickUntil(h, has("story.finish"));
    const finish = reports.at(-1)?.outcomes.find((o) => o.decision.rule === "story.finish");
    expect(finish).toMatchObject({ ok: true, detail: { removed: ["lt-1"], logs_removed: ours.length } });
    expect(reports.at(-1)?.problems).toEqual([]);
    const left = Object.keys(h.files.snapshot());
    expect(ours.filter((p) => left.includes(p))).toEqual([]);
    expect(others.filter((p) => left.includes(p))).toEqual(others);
  });

  test("a log that cannot be removed is a problem in the report; the finish still succeeds and the claim is released", async () => {
    const h = harness();
    h.items.push(trackerItem(1));
    await tickUntil(h, has("check.finished"));
    const run = (await record(h, "lt-1")).receipts.flatMap((r) => (r.data.kind === "run.started" ? [r.data.run_id] : []))[0] as string;
    await h.files.write(sessionLogPath(h.ctx, run), "x\n");
    const remove = h.files.remove;
    h.files.remove = async (p) => {
      if (p.includes("/runtime/sessions/")) throw new Error("EACCES");
      return remove(p);
    };
    const reports = await tickUntil(h, has("story.finish"));
    const last = reports.at(-1);
    expect(last?.outcomes.filter((o) => ["story.finish", "claim.release"].includes(o.decision.rule)).map((o) => o.ok)).toEqual([true, true]);
    expect(last?.problems).toEqual([`lt-1: logs: 1 file could not be removed; first: ${sessionLogPath(h.ctx, run)}: EACCES`]);
  });
});

describe("a story's finish", () => {
  /** A story whose check ran, with its unit's session and check logs on disk. */
  async function checked() {
    const h = harness();
    h.items.push(trackerItem(1));
    await tickUntil(h, has("check.finished"));
    // a merged change, so the finish closes the item too
    h.changes["norn/lt-1"] = { id: 4, state: "merged", draft: false, head_branch: "norn/lt-1", base_branch: "main", head_sha: "a1", title: "Story 1" };
    const run = (await record(h, "lt-1")).receipts.flatMap((r) => (r.data.kind === "run.started" ? [r.data.run_id] : []))[0] as string;
    const logs = [sessionLogPath(h.ctx, run), checkLogPath(h.ctx, "lt-1", run, 1), checkExitPath(h.ctx, "lt-1", run, 1)];
    for (const p of logs) await h.files.write(p, "x\n");
    return { h, logs };
  }

  test("closes the item first, removes the worktrees next and the unit logs last", async () => {
    const { h, logs } = await checked();
    const order: string[] = [];
    const tracker = h.env.slots.tracker;
    const perform = tracker.perform.bind(tracker);
    tracker.perform = async (effect, opts) => {
      order.push(`tracker ${effect.kind}`);
      return perform(effect, opts);
    };
    const worktree = h.env.slots.vcs.worktree;
    const removeWorktree = worktree.remove.bind(worktree);
    worktree.remove = async (unit) => {
      order.push(`vcs remove ${unit}`);
      return removeWorktree(unit);
    };
    const remove = h.files.remove;
    h.files.remove = async (p) => {
      if (logs.includes(p)) order.push(`log ${p}`);
      return remove(p);
    };
    const reports = await tickUntil(h, has("story.finish"));
    expect(reports.at(-1)?.outcomes.find((o) => o.decision.rule === "story.finish")).toMatchObject({ ok: true, detail: { closed: true, removed: ["lt-1"] } });
    expect(order).toEqual(["tracker close", "vcs remove lt-1", ...logs.map((p) => `log ${p}`)]);
    expect(h.vcsCalls.filter((c) => c.op === "remove").map((c) => c.args)).toEqual([["lt-1"]]);
    expect(h.items[0]?.open).toBe(false);
  });

  test("a worktree the vcs cannot remove fails the finish, removes no log, and the next tick finishes under the claim", async () => {
    const { h, logs } = await checked();
    const worktree = h.env.slots.vcs.worktree;
    const removeWorktree = worktree.remove.bind(worktree);
    worktree.remove = async () => ({ ok: false, failure: { code: "unavailable", message: "worktree is busy", retryable: true } });
    const failed = (await tickUntil(h, has("story.finish"))).at(-1);
    expect(failed?.outcomes.filter((o) => ["story.finish", "claim.release"].includes(o.decision.rule)).map((o) => `${o.decision.rule} ${o.ok}`)).toEqual(["story.finish false", "claim.release false"]);
    const held = await h.env.slots.store.claims.read("lt-1");
    expect(held.ok && held.value?.holder).toBe("machine-a");
    const left = Object.keys(h.files.snapshot());
    expect(logs.filter((p) => left.includes(p))).toEqual(logs);
    worktree.remove = removeWorktree;
    const next = await h.runtime.tick();
    expect(next.outcomes.filter((o) => ["story.finish", "claim.release"].includes(o.decision.rule)).map((o) => `${o.decision.rule} ${o.ok}`)).toEqual(["story.finish true", "claim.release true"]);
    const after = Object.keys(h.files.snapshot());
    expect(logs.filter((p) => after.includes(p))).toEqual([]);
    const released = await h.env.slots.store.claims.read("lt-1");
    expect(released.ok && released.value).toBeNull();
  });

  test("a unit whose record cannot be read keeps its session and check logs, with a problem saying so; the finish succeeds", async () => {
    const { h, logs } = await checked();
    // the record turns unreadable once the finish is under way, after decide read it
    const journal = h.env.journal;
    const readUnit = journal.readUnit.bind(journal);
    let unreadable = false;
    journal.readUnit = async (unit) => (unreadable && unit === "lt-1" ? { ok: false, failure: { code: "invalid", message: "receipt 3 fails validation", retryable: false } } : readUnit(unit));
    const worktree = h.env.slots.vcs.worktree;
    const removeWorktree = worktree.remove.bind(worktree);
    worktree.remove = async (unit) => {
      unreadable = true;
      return removeWorktree(unit);
    };
    const last = (await tickUntil(h, has("story.finish"))).at(-1);
    unreadable = false;
    expect(last?.outcomes.find((o) => o.decision.rule === "story.finish")?.ok).toBe(true);
    expect(last?.problems).toEqual(["lt-1: logs: its record could not be read, so its session and check logs stay: receipt 3 fails validation"]);
    const left = Object.keys(h.files.snapshot());
    expect(logs.filter((p) => left.includes(p))).toEqual(logs);
  });
});
