/**
 * `status --segment` for herdr's tab bar through the CLI, over the in-memory machine and a scripted herdr.
 */
import { describe, expect, test } from "bun:test";
import type { ExecScript } from "@norn/conformance";
import { configPaths, ExitCode, runCli } from "../../src/index.ts";
import { fakeGh, GITHUB_CONFIG, HOME, machine, ROOT, type TestMachine } from "./support.ts";
import { AGENT_STEP, configured, GATE_STEP, seedUnit, UNIT } from "./units.ts";

const json = (stdout: string): Record<string, unknown> => Bun.JSONL.parse(stdout)[0] as Record<string, unknown>;
/** herdr answering for the story's workspace */
const herdr: ExecScript = (argv) => {
  if (argv[0] !== "herdr") return undefined;
  const verb = `${argv[1]} ${argv[2]}`;
  if (verb === "workspace list") return { stdout: JSON.stringify({ result: { workspaces: [{ workspace_id: "w1", label: UNIT }] } }) };
  if (verb === "workspace report-metadata") return { stdout: "" };
  return undefined;
};

const inPanes = (env: Record<string, string> = {}): TestMachine => configured({ runner: "herdr", script: herdr, env });

const herdrCalls = (m: TestMachine) => m.exec.calls.filter((c) => c.argv[0] === "herdr").map((c) => c.argv.slice(1));

describe("norn status --segment", () => {
  test("outside a git repository, and in one norn was never set up in, it prints an empty line and exits 0", async () => {
    for (const m of [machine({ common: null }), machine()]) {
      const r = await runCli(["status", "--segment"], m.io);
      expect({ exit: r.exit, stdout: r.stdout }).toEqual({ exit: ExitCode.ok, stdout: "\n" });
    }
  });

  test("one line for the repo: what waits for you counted by kind, then what runs; calm when nothing waits", async () => {
    const m = configured();
    expect((await runCli(["status", "--segment"], m.io)).stdout).toBe("norn·repo ✓ nothing waits\n");
    await seedUnit(m, { step: GATE_STEP, run: null });
    await seedUnit(m, { unit: "lt-2", step: AGENT_STEP, run: "01JBBBBBBBBBBBBBBBBBBBBBBB" });
    const r = await runCli(["status", "--segment", "--json"], m.io);
    expect(json(r.stdout)).toMatchObject({ segment: "norn·repo ● 1 approve ◐ 1 running", repo: ROOT });
  });

  test("reads this machine's record alone: no call to the code host, however many stories", async () => {
    const gh = fakeGh(["norn"]);
    const m = machine({ seed: { [configPaths(HOME, ROOT).local]: GITHUB_CONFIG }, script: gh.script });
    await seedUnit(m, { unit: "gh-1", step: GATE_STEP, run: null });
    const before = m.exec.calls.length;
    const r = await runCli(["status", "--segment"], m.io);
    expect(r.stdout).toBe("norn·repo ● 1 approve\n");
    expect(m.exec.calls.slice(before).filter((c) => c.argv[0] === "gh" || c.argv.includes("fetch"))).toEqual([]);
  });

  test("inside herdr it also writes each story's $norn sidebar token on the story's workspace", async () => {
    const m = inPanes({ HERDR_ENV: "1" });
    await seedUnit(m, { step: GATE_STEP, run: null });
    await runCli(["status", "--segment"], m.io);
    expect(herdrCalls(m).filter((c) => c[1] === "report-metadata")).toEqual([["workspace", "report-metadata", "w1", "--source", "norn", "--token", "norn=● approve", "--ttl-ms", "30000"]]);
    // outside herdr nothing is written there
    const outside = inPanes();
    await seedUnit(outside, { step: GATE_STEP, run: null });
    await runCli(["status", "--segment"], outside.io);
    expect(herdrCalls(outside)).toEqual([]);
  });

  test("--ttl alone is a usage error naming the flag it needs", async () => {
    const r = await runCli(["status", "--ttl", "30s", "--json"], configured().io);
    expect(r.exit).toBe(ExitCode.usage);
  });
});
