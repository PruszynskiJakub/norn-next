/**
 * Tick facts stored as chunks (O4, O5; gh-107 B13, B17, B18, B21, B22, B35): a quiet tick writes a tick
 * line and no chunk, `norn run view --why` replays a chunked tick from facts equal to the ones observe produced,
 * a full-facts tick an older norn wrote (before or after chunked ones) replays as before, a missing
 * chunk is a corrupt trace entry, and the golden harvest reads chunked ticks as it read full ones.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type TickTrace, ulid, validate } from "@norn/schema";
import { appendHookTrace, appendTrace, readTickInputs, readTrace, sha256, machineDir, repoConfigPath, workflowsDir, writeTraceFile } from "@norn/store";
import { harvestGolden } from "./golden-harvest.ts";
import { createHarness, type Harness, issue } from "./harness.ts";
import { observeNow } from "./observe-snapshot.ts";

// whole flows over real git, several ticks each: 5 s is too tight on a loaded machine (full suite)
setDefaultTimeout(30_000);

const SOLO = `name: solo
start: implement
steps:
  implement:
    type: agent
    skill: norn-implement
    outcomes: { done: $done }
`;

const CONFIG = `agents:
  claude: { adapter: claude }
runner: { adapter: headless }
remote: { provider: gh, label: norn }
default_workflow: solo
default_mode: auto
`;

const SPEC = ".agents/specs/gh-9-fix-the-bug";
type Why = { tick_id: string; rule: string; replay: { matches: boolean; all_match: boolean } };

let h: Harness;
const wt = () => `${h.root}-worktrees/gh-9-fix-the-bug`;
const runs = () => join(wt(), SPEC, "runs/_story");
const ticks = () => readTrace(h.root, { types: ["tick"] }).events as TickTrace[];
const dir = () => machineDir(h.root);
const bytes = () => readdirSync(dir()).filter((n) => n.endsWith(".jsonl")).reduce((sum, n) => sum + statSync(join(dir(), n)).size, 0);
const chunksFile = () => join(dir(), `${h.clock.iso().slice(0, 10)}.chunks.jsonl`);

/** A tick line as the previous norn wrote it: full facts, workflow sources under `trace/workflows/` (B18). */
function fullTick(root: string, t: TickTrace, tickId: string): TickTrace {
  const read = readTickInputs(h.root, t);
  if (!read.ok) throw new Error(JSON.stringify(read));
  const workflows: Record<string, { hash: string | null; issues: unknown[] }> = {};
  for (const [name, w] of Object.entries(read.inputs.workflows)) {
    const hash = w.source ? sha256(w.source) : null;
    if (hash) writeTraceFile(root, `workflows/${hash}.yaml`, w.source);
    workflows[name] = { hash, issues: w.issues };
  }
  return { ...t, tick_id: tickId, facts: JSON.parse(JSON.stringify({ ...read.inputs.facts, replay: { workflows, config: read.inputs.config } })) };
}

beforeAll(async () => {
  h = await createHarness();
  expect((await h.norn("init")).exit).toBe(0);
  h.write(repoConfigPath(h.root), CONFIG);
  h.write(join(workflowsDir(h.root), "solo.yaml"), SOLO);
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn"]);
  h.git(["push", "-q", "origin", "main"]);
  h.remote.issues = [issue(9, "Fix the bug")];
  for (let i = 0; i < 6 && h.state(runs())?.status !== "running"; i++) {
    h.clock.advance(10_000);
    await h.tick();
  }
  const runId = h.state(runs())?.run?.run_id as string;
  expect(runId).toBeTruthy();
  // a live run with 70 hook facts: two hook blocks (B14)
  for (let i = 0; i < 70; i++) {
    h.clock.advance(1_000);
    appendHookTrace(h.root, { story: "gh-9" }, { type: "hook", id: ulid(h.clock.now()), fact: { event: "tool_use", at: h.clock.iso(), agent: "claude", native: "PostToolUse", cwd: wt(), story: "gh-9", run_id: runId } });
  }
  h.clock.advance(10_000);
  await h.tick();
});
afterAll(() => h.cleanup());

describe("chunked tick facts (O4, O5)", () => {
  test("B13: a quiet tick a minute later adds a tick line and no chunk, under 5 KB with its chunks", async () => {
    h.clock.advance(60_000);
    await h.tick();
    const chunks = readFileSync(chunksFile(), "utf8");
    const before = bytes();
    h.clock.advance(60_000);
    await h.tick();
    expect(readFileSync(chunksFile(), "utf8")).toBe(chunks);
    expect(bytes() - before).toBeLessThan(5_000);
    expect(ticks().at(-1)?.facts.$chunked).toBe(1);
  });

  test("B17 (B14): why --tick on a chunked tick with hook blocks rebuilds the observed facts byte for byte and replays its decisions", async () => {
    h.clock.advance(60_000);
    await h.tick();
    const t = ticks().at(-1) as TickTrace;
    // nothing changed since the tick: observe at its instant sees what it saw
    const observed = (await observeNow(h)).facts;
    const read = readTickInputs(h.root, t);
    if (!read.ok) throw new Error(JSON.stringify(read));
    expect(JSON.stringify(read.inputs.facts)).toBe(JSON.stringify({ ...observed, tick_id: t.tick_id }));
    const run = read.inputs.facts.stories[0]?.units[0]?.run;
    expect(run?.hooks.length).toBe(70);
    // the run's hooks are two blocks in the tick's story chunk
    const storyRef = (t.facts.stories as Array<{ $chunk: string }>)[0]?.$chunk;
    const story = readFileSync(chunksFile(), "utf8").split("\n").find((l) => l.startsWith(`{"h":"${storyRef}"`)) as string;
    expect((JSON.parse(story).v.units[0].run.hooks.$blocks as string[]).length).toBe(2);
    const r = await h.norn("run", "view", "gh-9", "--why", "--tick", t.tick_id);
    expect(r.exit).toBe(0);
    expect(r.value).toMatchObject({ tick_id: t.tick_id, replay: { matches: true, all_match: true } });
  });

  test("B35: a chunked tick line validates as a tick (facts an object) and status --history reads its changes", async () => {
    h.report(runs(), "ask", { question: "Which currency?" });
    h.clock.advance(10_000);
    await h.tick();
    const all = ticks();
    expect(all.length).toBeGreaterThan(3);
    for (const t of all) {
      expect(validate("trace", t).ok).toBe(true);
      expect(t.facts.$chunked).toBe(1);
    }
    expect(all.some((t) => t.inbox?.length)).toBe(true);
    const r = await h.norn("status", "--history", "--json");
    expect(r.exit).toBe(0);
    expect((r.value as { items: Array<{ title: string; appeared_at: string | null }> }).items).toContainEqual(expect.objectContaining({ title: "Which currency?", appeared_at: expect.any(String) }));
  });

  test("B18, B35: full-facts ticks an older norn wrote after chunked ones replay, and so do the chunked ones", async () => {
    const chunked = ticks().at(-1) as TickTrace;
    const old = fullTick(h.root, chunked, ulid(h.clock.now() + 1));
    appendTrace(h.root, old);
    expect(ticks().at(-1)?.facts.$chunked).toBeUndefined();
    for (const id of [chunked.tick_id, old.tick_id]) {
      const r = await h.norn("run", "view", "gh-9", "--why", "--tick", id);
      expect(r.exit).toBe(0);
      expect((r.value as Why).replay).toMatchObject({ matches: true, all_match: true });
    }
  });

  test("B22: the golden harvest yields the same case names and decisions from chunked ticks as from full ones", () => {
    const out = (name: string) => {
      mkdirSync(join(h.dir, name), { recursive: true });
      return join(h.dir, name);
    };
    const fromChunks = out("golden-chunked");
    harvestGolden(h.dir, h.root, fromChunks, "chunked");
    // the same trace as the previous norn would have written it: every tick with full facts
    const fullRoot = join(h.dir, "full-root");
    for (const ev of readTrace(h.root).events) {
      if (ev.type === "tick" && ev.facts.$chunked === 1) appendTrace(fullRoot, fullTick(fullRoot, ev, ev.tick_id));
      else if (ev.type === "tick.start") appendTrace(fullRoot, ev);
    }
    const fromFull = out("golden-full");
    harvestGolden(h.dir, fullRoot, fromFull, "chunked");
    const cases = (d: string) => Object.fromEntries(readdirSync(d).sort().map((n) => [n, readFileSync(join(d, n), "utf8")]));
    expect(Object.keys(cases(fromChunks)).length).toBeGreaterThan(3);
    expect(cases(fromFull)).toEqual(cases(fromChunks));
  });

  test("B21: a chunked tick whose chunk is gone is a corrupt trace entry: why exits 4, trace_corrupt, and replays nothing", async () => {
    const t = ticks().findLast((x) => x.facts.$chunked === 1) as TickTrace;
    const storyRef = (t.facts.stories as Array<{ $chunk: string }>)[0]?.$chunk as string;
    const path = join(dir(), `${t.at.slice(0, 10)}.chunks.jsonl`);
    const text = readFileSync(path, "utf8");
    writeFileSync(path, text.split("\n").filter((l) => !l.startsWith(`{"h":"${storyRef}"`)).join("\n"));
    try {
      const r = await h.norn("run", "view", "gh-9", "--why", "--tick", t.tick_id, "--json");
      expect(r.exit).toBe(4);
      expect(r.value).toMatchObject({ code: "trace_corrupt" });
      expect(JSON.stringify(r.value)).toContain(storyRef);
      expect(r.value).not.toHaveProperty("replay");
    } finally {
      writeFileSync(path, text);
    }
  });
});
