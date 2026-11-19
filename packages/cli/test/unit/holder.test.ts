import { describe, expect, test } from "bun:test";
import type { ExecScript } from "@norn/conformance";
import { ExitCode, homePaths, runCli } from "../../src/index.ts";
import { HOME, type TestMachine } from "./support.ts";
import { AGENT_STEP, configured, envOf, runEnv, seedUnit, UNIT } from "./units.ts";

const json = (stdout: string): unknown => Bun.JSONL.parse(stdout)[0];
const HOLDER_FILE = homePaths(HOME).holder;

/** The same files and git as `m`, in a process whose hostname now answers `name`, as macOS's does when the network changes. */
const renamed = (m: TestMachine, name: string): TestMachine => ({ ...m, io: { ...m.io, hostname: name } });

const localHostName =
  (name: string): ExecScript =>
  (argv) =>
    argv[0] === "scutil" && argv[1] === "--get" && argv[2] === "LocalHostName" ? { stdout: `${name}\n` } : undefined;

async function claimAs(m: TestMachine, holder: string): Promise<void> {
  const env = await envOf(m);
  const held = await env.slots.store.claims.read(UNIT);
  const taken = await env.slots.store.claims.takeOver?.(UNIT, holder, 60 * 60_000, held.ok && held.value ? held.value.version : null);
  if (!taken?.ok) throw new Error(`cannot claim ${UNIT} as ${holder}`);
}

describe("a machine claims under one holder for as long as its norn home lives", () => {
  test("the holder is derived once and kept when the hostname changes, so the agent's done on the machine that took the claim goes through", async () => {
    const m = configured({ env: runEnv() });
    await seedUnit(m, { step: AGENT_STEP });
    const env = await envOf(m);
    expect(env.config.holder).toBe("me@box");
    await claimAs(m, env.config.holder);
    const moved = renamed(m, "MacBook-Pro-2.local");
    expect((await envOf(moved)).config.holder).toBe("me@box");
    const done = await runCli(["done", "done", "--json"], moved.io);
    expect({ exit: done.exit, out: json(done.stdout) }).toMatchObject({ exit: ExitCode.ok });
  });

  test("the first holder is user@ the machine's LocalHostName; the name its hostname gave until then stays this machine's", async () => {
    const m = configured({ env: runEnv(), script: localHostName("Box") });
    const before = renamed(m, "box.home");
    await seedUnit(before, { step: AGENT_STEP });
    expect((await envOf(before)).config.holder).toBe("me@Box");
    expect(JSON.parse((await m.files.read(HOLDER_FILE)) ?? "null")).toEqual({ machine: "Box", former: ["box.home", "Box.local"] });
    // a claim the released binary took under the hostname it had then
    await claimAs(before, "me@box.home");
    const done = await runCli(["done", "done", "--json"], renamed(m, "box.lan").io);
    expect(done.exit).toBe(ExitCode.ok);
  });

  test("a hostname seen later is kept as a name this home used; another machine's claim is still refused", async () => {
    const m = configured({ env: runEnv() });
    await seedUnit(m, { step: AGENT_STEP });
    await envOf(renamed(m, "box.lan"));
    expect(JSON.parse((await m.files.read(HOLDER_FILE)) ?? "null")).toEqual({ machine: "box", former: ["box.lan"] });
    await claimAs(m, "me@desk");
    const refused = await runCli(["done", "done", "--json"], m.io);
    expect({ exit: refused.exit, out: json(refused.stdout) }).toMatchObject({ exit: ExitCode.refused, out: { code: "claim_moved" } });
  });

  test("a holder file that does not validate is refused, never replaced by a new name", async () => {
    const m = configured({ env: runEnv(), stdin: "" });
    await m.files.write(HOLDER_FILE, '{"machine": ""}\n');
    const r = await runCli(["done", "done", "--json"], m.io);
    expect({ exit: r.exit, out: json(r.stdout) }).toMatchObject({ exit: ExitCode.corrupt, out: { code: "corrupt", error: expect.stringContaining(HOLDER_FILE) } });
    expect(await m.files.read(HOLDER_FILE)).toBe('{"machine": ""}\n');
  });
});
