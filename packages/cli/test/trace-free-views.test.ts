/**
 * The cockpit, `status`, `status --segment` and `inbox` read no trace day file (B1, B2, D1): the
 * project view carries no timeline, so what they show is the same over a trace of several days and
 * over an empty one. The trace-read observer (store) sees every day file a reader opens.
 *
 * The days here are older than the hook-fact window (no live run, last hook beyond `limits.stalled`):
 * the hook-fact read of local facts still scans day files within that window until hooks move to
 * per-unit files (B8).
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { copyFileSync, mkdirSync, readdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { setTraceReadObserver, traceDir } from "@norn/store";
import { runCli } from "../src/index.ts";
import { createHarness, type Harness, issue } from "./harness.ts";

setDefaultTimeout(30_000);

const CONFIG = `agents:
  claude: { adapter: claude }
remote: { provider: gh, label: norn }
default_mode: manual
notifiers: []
`;

const DAY = 86_400_000;
let h: Harness;
const days = () => readdirSync(traceDir(h.root)).filter((n) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n));

async function* quitAfter(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
  yield "q";
}

/** the day files `run` opens */
async function opened(run: () => Promise<unknown>): Promise<string[]> {
  const seen: string[] = [];
  const prev = setTraceReadObserver(({ file }) => seen.push(file));
  try {
    await run();
  } finally {
    setTraceReadObserver(prev);
  }
  return [...new Set(seen)];
}

beforeAll(async () => {
  h = await createHarness();
  expect((await h.norn("init")).exit).toBe(0);
  h.write(join(h.root, ".agents/norn/config.yaml"), CONFIG);
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn"]);
  h.git(["push", "-q", "origin", "main"]);
  h.remote.issues = [issue(7, "Count items"), issue(8, "Export report")];
  for (let i = 0; i < 4; i++) {
    h.clock.advance(60_000);
    await h.tick();
  }
  // several days of trace: today's ticks copied onto the days before, then the clock moves past them all
  const [today] = days();
  if (!today) throw new Error("no day file");
  const t0 = Date.parse(today.slice(0, 10));
  for (const n of [1, 2, 3]) copyFileSync(join(traceDir(h.root), today), join(traceDir(h.root), `${new Date(t0 - n * DAY).toISOString().slice(0, 10)}.jsonl`));
  h.clock.advance(2 * DAY);
  expect(days().length).toBe(4);
});
afterAll(() => h.cleanup());

const views = {
  status: () => h.norn("status", "--json"),
  segment: () => runCli(["status", "--segment", "--json"], { ...h.deps, herdr: null }),
  inbox: () => h.norn("inbox", "--json"),
  "status gh-7": () => h.norn("status", "gh-7", "--json"),
};

describe("views that read no trace (B1, B2)", () => {
  test("norn cockpit --json and a refreshing cockpit open no day file (B1)", async () => {
    expect(await opened(() => runCli(["cockpit", "--json"], { ...h.deps, herdr: null }))).toEqual([]);
    let frames = 0;
    expect(
      await opened(async () => {
        const r = await runCli(["cockpit", "--interval", "20ms"], { ...h.deps, herdr: null, input: quitAfter(150), log: () => frames++ });
        expect(r.exit).toBe(0);
      }),
    ).toEqual([]);
    expect(frames).toBeGreaterThan(2); // it refreshed
  });

  test("status, status --segment and inbox open no day file and print the same as over an empty trace (B2)", async () => {
    const full: Record<string, unknown> = {};
    for (const [name, run] of Object.entries(views)) {
      let out: unknown;
      expect(await opened(async () => void (out = (await run()).value))).toEqual([]);
      full[name] = out;
    }
    expect((full.status as { stories: Array<{ key: string }> }).stories.map((s) => s.key)).toEqual(["gh-7", "gh-8"]);

    const away = join(h.dir, "trace-away");
    mkdirSync(away);
    for (const n of days()) renameSync(join(traceDir(h.root), n), join(away, n));
    try {
      for (const [name, run] of Object.entries(views)) expect([name, (await run()).value]).toEqual([name, full[name]]);
    } finally {
      for (const n of readdirSync(away)) renameSync(join(away, n), join(traceDir(h.root), n));
    }
  });
});
