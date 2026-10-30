/**
 * O5: every tick trace records the norn that wrote it (`norn_version`), and `norn why` on a tick
 * another version recorded still replays and diffs it, labelled `recorded by norn <X>`, with the
 * same exit code as for a tick this version recorded.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type TickTrace, validate } from "@norn/schema";
import { version } from "../package.json";
import { createHarness, type Harness, issue } from "./harness.ts";

setDefaultTimeout(30_000);

const WORKFLOW = `name: ship
start: work
steps:
  work:
    type: agent
    skill: norn-implement
    outcomes: { done: $done }
`;

const CONFIG = `agents:
  claude: { adapter: claude }
remote: { provider: gh, label: norn }
default_workflow: ship
default_mode: manual
notifiers: []
`;

let h: Harness;
const traceDir = () => join(h.root, ".agents/norn/trace");

function ticks(): TickTrace[] {
  return readdirSync(traceDir())
    .filter((f) => f.endsWith(".jsonl"))
    .sort()
    .flatMap((f) => readFileSync(join(traceDir(), f), "utf8").split("\n").filter(Boolean))
    .map((l) => JSON.parse(l) as { type: string })
    .filter((e): e is TickTrace => e.type === "tick");
}

/** Rewrite one tick record in the trace (as an older norn, or an edited trace, would have left it). */
function editTick(tickId: string, edit: (t: TickTrace) => void): void {
  for (const f of readdirSync(traceDir()).filter((n) => n.endsWith(".jsonl"))) {
    const path = join(traceDir(), f);
    const lines = readFileSync(path, "utf8").split("\n");
    const out = lines.map((l) => {
      if (!l) return l;
      const ev = JSON.parse(l) as TickTrace;
      if (ev.type !== "tick" || ev.tick_id !== tickId) return l;
      edit(ev);
      return JSON.stringify(ev);
    });
    writeFileSync(path, out.join("\n"));
  }
}

type Why = { tick_id: string; rule: string; replay: { matches: boolean; rule: string | null; action?: unknown; label?: string } };

beforeAll(async () => {
  h = await createHarness();
  expect((await h.norn("init")).exit).toBe(0);
  h.write(join(h.root, ".agents/norn/config.yaml"), CONFIG);
  h.write(join(h.root, ".agents/norn/workflows/ship.yaml"), WORKFLOW);
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn"]);
  h.git(["push", "-q", "origin", "main"]);
  h.remote.issues = [issue(3, "Add totals")];
  h.clock.advance(10_000);
  await h.tick();
});
afterAll(() => h.cleanup());

describe("norn_version on tick traces (O5)", () => {
  test("every tick record carries this norn's package version and stays schema-valid", () => {
    const all = ticks();
    expect(all.length).toBeGreaterThan(0);
    for (const t of all) {
      expect(t.norn_version).toBe(version);
      expect(validate("trace", t).ok).toBe(true);
    }
    // older traces without the field are still valid
    const { norn_version: _, ...older } = all[0] as TickTrace;
    expect(validate("trace", older).ok).toBe(true);
  });

  test("why on a tick this version recorded has no label", async () => {
    const r = await h.norn("run", "view", "gh-3", "--why");
    expect(r.exit).toBe(0);
    const v = r.value as Why;
    expect(v.replay.matches).toBe(true);
    expect(v.replay.label).toBeUndefined();
  });

  test("why on a tick another version recorded still replays, labelled, exit unchanged", async () => {
    const before = (await h.norn("run", "view", "gh-3", "--why")).value as Why;
    editTick(before.tick_id, (t) => {
      t.norn_version = "0.0.1";
    });
    const r = await h.norn("run", "view", "gh-3", "--why");
    expect(r.exit).toBe(0);
    expect(r.value).toMatchObject({ tick_id: before.tick_id, rule: before.rule, replay: { matches: true, rule: before.rule, label: `recorded by norn 0.0.1, replayed by norn ${version}` } });

    // a tick with no version (recorded before norn_version existed) is not labelled
    editTick(before.tick_id, (t) => {
      delete t.norn_version;
    });
    const older = await h.norn("run", "view", "gh-3", "--why");
    expect(older.exit).toBe(0);
    expect((older.value as Why).replay.label).toBeUndefined();
  });

  test("a mismatch on a tick another version recorded still shows the diff, labelled, and exits 1", async () => {
    const before = (await h.norn("run", "view", "gh-3", "--why")).value as Why;
    editTick(before.tick_id, (t) => {
      t.norn_version = "0.0.1";
      const d = t.decisions.find((x) => x.rule === before.rule) as TickTrace["decisions"][number];
      (d.action as { reason?: string }).reason = "decided differently by an older rule";
    });
    const r = await h.norn("run", "view", "gh-3", "--why");
    expect(r.exit).toBe(1);
    const v = r.value as Why;
    expect(v.replay.matches).toBe(false);
    expect(v.replay.action).toBeDefined();
    expect(v.replay.label).toBe(`recorded by norn 0.0.1, replayed by norn ${version}`);
  });
});
