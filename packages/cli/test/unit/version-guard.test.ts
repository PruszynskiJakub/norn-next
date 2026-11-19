import { describe, expect, test } from "bun:test";
import type { ExecScript } from "@norn/conformance";
import type { StoreFloor } from "@norn/plugin-api";
import { CliContext, configPaths, ExitCode, runCli } from "../../src/index.ts";
import { HOME, LOCAL_CONFIG, machine, ROOT, type TestMachine } from "./support.ts";

const json = (stdout: string): Record<string, unknown> => Bun.JSONL.parse(stdout)[0] as Record<string, unknown>;
/** git agrees to everything, so a story's branch and worktree are made without a repository */
const gitAgrees: ExecScript = (argv) => (argv[0] === "git" ? { stdout: "" } : undefined);
const CONFIG = LOCAL_CONFIG.replace("{ label: norn }", "{ label: norn, assignee: null }");

/** The test machine runs as norn 9.9.9 unless `version` says otherwise. */
function repo(version?: string): TestMachine {
  const m = machine({ seed: { [configPaths(HOME, ROOT).local]: CONFIG }, script: gitAgrees });
  if (version !== undefined) m.io.version = version;
  return m;
}

async function floorOf(m: TestMachine): Promise<StoreFloor> {
  const floor = (await new CliContext(m.io).runtimeEnv()).slots.store.floor;
  if (!floor) throw new Error("the bundled store keeps no floor");
  return floor;
}

async function floorAt(m: TestMachine, version: string): Promise<void> {
  const raised = await (await floorOf(m)).raise(version);
  if (!raised.ok) throw new Error(raised.failure.message);
}

async function readFloor(m: TestMachine): Promise<string | null> {
  const r = await (await floorOf(m)).read();
  if (!r.ok) throw new Error(r.failure.message);
  return r.value;
}

async function addItem(m: TestMachine, title: string): Promise<void> {
  const env = await new CliContext(m.io).runtimeEnv();
  const made = await env.slots.tracker.perform({ kind: "create", title, body: "", labels: ["norn"] }, { receipt_id: "01JAAAAAAAAAAAAAAAAAAAAAAA" });
  if (!made.ok) throw new Error(made.failure.message);
}

describe("the norn version floor", () => {
  test("an acting command raises the store's floor to this norn", async () => {
    const m = repo();
    expect(await readFloor(m)).toBeNull();
    expect((await runCli(["tick", "--json"], m.io)).exit).toBe(ExitCode.ok);
    expect(await readFloor(m)).toBe("9.9.9");
  });

  test("a norn older than the floor refuses an acting command, exit 3 version_too_old, and acts on nothing", async () => {
    const m = repo();
    await floorAt(m, "10.0.0");
    await addItem(m, "First");
    const r = await runCli(["tick", "--json"], m.io);
    const body = json(r.stdout);
    expect({ exit: r.exit, code: body.code, details: body.details }).toEqual({ exit: ExitCode.refused, code: "version_too_old", details: { running: "9.9.9", floor: "10.0.0" } });
    expect(body.do_instead).toContain("upgrade norn to 10.0.0 or newer");
    const env = await new CliContext(m.io).runtimeEnv();
    expect(await env.slots.store.listUnits()).toEqual({ ok: true, value: [] });
    for (const argv of [["story", "approve", "lt-1"], ["run", "stop", "lt-1"], ["story", "create", "Second"]]) {
      const refused = await runCli([...argv, "--json"], m.io);
      expect({ argv, exit: refused.exit, code: json(refused.stdout).code }).toEqual({ argv, exit: ExitCode.refused, code: "version_too_old" });
    }
    expect(await readFloor(m)).toBe("10.0.0");
  });

  test("a norn at the floor acts; a newer one raises the floor to its own release", async () => {
    const m = repo();
    await floorAt(m, "9.9.9");
    expect((await runCli(["tick", "--json"], m.io)).exit).toBe(ExitCode.ok);
    expect(await readFloor(m)).toBe("9.9.9");
    m.io.version = "10.1.0-dev.2";
    expect((await runCli(["tick", "--json"], m.io)).exit).toBe(ExitCode.ok);
    expect(await readFloor(m)).toBe("10.1.0");
  });

  test("read-only commands still work below the floor and leave it where it is", async () => {
    const m = repo();
    await floorAt(m, "10.0.0");
    for (const argv of [["status"], ["story", "list"], ["config", "show"]]) {
      const r = await runCli([...argv, "--json"], m.io);
      expect({ argv, exit: r.exit }).toEqual({ argv, exit: ExitCode.ok });
    }
    expect(await readFloor(m)).toBe("10.0.0");
  });

  test("a build that names no version is never refused and records no floor", async () => {
    const m = repo("dev");
    expect((await runCli(["tick", "--json"], m.io)).exit).toBe(ExitCode.ok);
    expect(await readFloor(m)).toBeNull();
  });

  test("watch below the floor logs once and pauses instead of ticking, until stopped", async () => {
    const m = repo();
    await floorAt(m, "10.0.0");
    await addItem(m, "First");
    const stop = new AbortController();
    const lines: string[] = [];
    let sleeps = 0;
    m.io.signal = stop.signal;
    m.io.log = (line) => lines.push(line);
    m.io.sleep = async () => {
      if (++sleeps >= 4) stop.abort();
    };
    const r = await runCli(["watch", "--interval", "30s", "--json"], m.io);
    expect(r.exit).toBe(ExitCode.ok);
    expect(json(r.stdout)).toMatchObject({ ticks: 0 });
    expect(sleeps).toBe(4);
    expect(lines.map((l) => JSON.parse(l))).toEqual([{ paused: "version_too_old", error: expect.stringContaining("10.0.0"), do_instead: expect.stringContaining("upgrade norn to 10.0.0 or newer") }]);
    const env = await new CliContext(m.io).runtimeEnv();
    expect(await env.slots.store.listUnits()).toEqual({ ok: true, value: [] });
  });
});
