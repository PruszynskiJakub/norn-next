import { describe, expect, test } from "bun:test";
import type { ExecScript } from "@norn/conformance";
import { CliContext, configPaths, ExitCode, machineDir, machineId, runCli } from "../../src/index.ts";
import { COMMON, HOME, LOCAL_CONFIG, machine, ROOT, type TestMachine } from "./support.ts";

const PATHS = configPaths(HOME, ROOT);
const MACHINE = machineDir(HOME, machineId(COMMON));
const json = (stdout: string): Record<string, unknown> => Bun.JSONL.parse(stdout)[0] as Record<string, unknown>;
/** a local tracker with nobody to assign to: every labelled open item is intake */
const CONFIG = LOCAL_CONFIG.replace("{ label: norn }", "{ label: norn, assignee: null }");
/** git agrees to everything, so a story's branch and worktree are made without a repository */
const gitAgrees: ExecScript = (argv) => (argv[0] === "git" ? { stdout: "" } : undefined);

function repo(opts: Parameters<typeof machine>[0] = {}): TestMachine {
  return machine({ seed: { [PATHS.local]: CONFIG }, script: gitAgrees, ...opts });
}

async function addItem(m: TestMachine, title: string): Promise<void> {
  const env = await new CliContext(m.io).runtimeEnv();
  const made = await env.slots.tracker.perform({ kind: "create", title, body: "", labels: ["norn"] }, { receipt_id: "01JAAAAAAAAAAAAAAAAAAAAAAA" });
  if (!made.ok) throw new Error(made.failure.message);
}

describe("norn tick", () => {
  test("one tick: with nothing to do, the runtime's report and exit 0", async () => {
    const r = await runCli(["tick", "--json"], repo().io);
    expect(r.exit).toBe(ExitCode.ok);
    expect(json(r.stdout)).toMatchObject({ decisions: [], outcomes: [], problems: [] });
    expect((await runCli(["tick"], repo().io)).stdout).toContain("Nothing to do.");
  });

  test("an intake item becomes a story: one line per action", async () => {
    const m = repo();
    await addItem(m, "First");
    const r = await runCli(["tick"], m.io);
    expect(r.exit).toBe(ExitCode.ok);
    expect(r.stdout).toContain("- lt-1  intake.story → intake_story");
  });

  test("a failed action exits 1 with the whole report", async () => {
    const m = machine({ seed: { [PATHS.local]: CONFIG } });
    await addItem(m, "First");
    const r = await runCli(["tick", "--json"], m.io);
    expect(r.exit).toBe(ExitCode.error);
    expect((json(r.stdout) as { outcomes: Array<{ ok: boolean }> }).outcomes).toMatchObject([{ ok: false }]);
  });

  test("another tick holding the lock is busy, exit 5", async () => {
    const m = repo({ seed: { [PATHS.local]: CONFIG, [`${MACHINE}/tick.lock`]: `${JSON.stringify({ tick_id: "other", at: "2026-01-01T00:00:00.000Z" })}\n` } });
    const r = await runCli(["tick", "--json"], m.io);
    expect({ exit: r.exit, code: json(r.stdout).code }).toEqual({ exit: ExitCode.busy, code: "tick_locked" });
  });

  test("no config: the config error, exit 6", async () => {
    const r = await runCli(["tick", "--json"], machine().io);
    expect({ exit: r.exit, code: json(r.stdout).code }).toEqual({ exit: ExitCode.config, code: "config_missing" });
  });
});

describe("norn watch", () => {
  test("a signal stops the loop: the pause ends at once and one summary is printed", async () => {
    const stop = new AbortController();
    const lines: string[] = [];
    const m = repo({
      signal: stop.signal,
      log: (l) => {
        lines.push(l);
        stop.abort();
      },
    });
    const started = performance.now();
    const r = await runCli(["watch", "--interval", "1h", "--json"], m.io);
    expect(performance.now() - started).toBeLessThan(5_000);
    expect(r.exit).toBe(ExitCode.ok);
    expect(json(r.stdout)).toEqual({ ticks: 1, failed_actions: 0, skipped_locked: 0, interval: "1h" });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] as string)).toMatchObject({ actions: 0, failed: 0 });
  });

  test("a signal given before the first tick: no tick starts", async () => {
    const stop = new AbortController();
    const m = repo({ signal: stop.signal, log: () => {} });
    stop.abort();
    const r = await runCli(["watch", "--json"], m.io);
    expect(json(r.stdout)).toMatchObject({ ticks: 0 });
  });

  test("--max-ticks ends it; a bad interval or count is a usage error", async () => {
    const r = await runCli(["watch", "--interval", "1ms", "--max-ticks", "3", "--json"], repo({ log: () => {} }).io);
    expect(json(r.stdout)).toMatchObject({ ticks: 3, interval: "1ms" });
    expect((await runCli(["watch", "--interval", "soon"], repo().io)).exit).toBe(ExitCode.usage);
    expect((await runCli(["watch", "--max-ticks", "0"], repo().io)).exit).toBe(ExitCode.usage);
  });
});

describe("norn status, story list and story view", () => {
  test("nothing yet: no stories; an item not yet taken shows as intake", async () => {
    const m = repo();
    expect(json((await runCli(["status", "--json"], m.io)).stdout)).toEqual({ stories: [], intake: [], problems: [], notes: [] });
    await addItem(m, "First");
    const v = json((await runCli(["status", "--json"], m.io)).stdout);
    expect(v.intake).toEqual([{ key: "lt-1", title: "First", url: null }]);
    expect((await runCli(["status"], m.io)).stdout).toContain("## Intake\n\n- lt-1 First");
    const view = await runCli(["story", "view", "lt-1", "--json"], m.io);
    expect({ exit: view.exit, code: json(view.stdout).code }).toEqual({ exit: ExitCode.refused, code: "story_not_started" });
  });

  test("a story a tick took: its claim and units, read without acting", async () => {
    const m = repo();
    await addItem(m, "First");
    await runCli(["tick"], m.io);
    await runCli(["tick"], m.io);
    const writes = m.exec.calls.length;
    const status = json((await runCli(["status", "--json"], m.io)).stdout) as { stories: Array<Record<string, unknown>>; intake: unknown[] };
    expect(status.intake).toEqual([]);
    expect(status.stories).toMatchObject([{ key: "lt-1", title: "First", claim: { holder: "me@box" }, units: [{ id: "lt-1" }] }]);
    const list = json((await runCli(["story", "list", "--json"], m.io)).stdout) as { stories: unknown[] };
    expect(list.stories).toMatchObject([{ key: "lt-1", title: "First", claim: "me@box", units: 1 }]);
    const view = json((await runCli(["story", "view", "lt-1", "--json"], m.io)).stdout);
    expect(view).toMatchObject({ key: "lt-1", title: "First", units: [{ id: "lt-1" }] });
    expect((await runCli(["story", "view", "lt-1"], m.io)).stdout).toStartWith("# lt-1 First, claimed by me@box\n");
    // reads only: no worktree, branch or push was asked of git while viewing
    expect(m.exec.calls.slice(writes).filter((c) => c.argv[1] === "worktree" || c.argv[1] === "push" || c.argv[1] === "branch")).toEqual([]);
  });

  test("a story no store holds is refused, naming story list", async () => {
    const r = await runCli(["story", "view", "lt-9", "--json"], repo().io);
    expect(json(r.stdout)).toMatchObject({ code: "story_not_found", do_instead: "norn story list" });
  });
});
