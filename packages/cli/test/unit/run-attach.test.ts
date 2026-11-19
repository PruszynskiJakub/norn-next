/** `norn run attach`: a unit's live run brought in front, over the in-memory machine and a scripted herdr. */
import { describe, expect, test } from "bun:test";
import type { ExecScript } from "@norn/conformance";
import { launchRecordPath } from "@norn/runtime";
import { ExitCode, runCli } from "../../src/index.ts";
import type { TestMachine } from "./support.ts";
import { AGENT_STEP, configured, envOf, GATE_STEP, RUN, seedUnit, UNIT } from "./units.ts";

const json = (stdout: string): Record<string, unknown> => Bun.JSONL.parse(stdout)[0] as Record<string, unknown>;
/** the pane `seedUnit`'s handle names for its run */
const PANE = "4242@boot";

/** herdr answering for the run's live pane */
const herdr: ExecScript = (argv) => {
  if (argv[0] !== "herdr") return undefined;
  const verb = `${argv[1]} ${argv[2]}`;
  if (verb === "pane get") return argv[3] === PANE ? { stdout: JSON.stringify({ result: { pane: { pane_id: PANE, tab_id: "w1:t2", agent_status: "working" } } }) } : { code: 1, stderr: '{"error":{"code":"pane_not_found"}}' };
  if (verb === "agent focus") return { stdout: '{"result":{"type":"ok"}}' };
  return undefined;
};

const inPanes = (): TestMachine => configured({ runner: "herdr", script: herdr });

/** the launch record this machine writes when it starts a run: only such a run's pane is focused */
async function launchedHere(m: TestMachine): Promise<void> {
  const env = await envOf(m);
  await env.ctx.files.write(launchRecordPath(env.ctx, UNIT, RUN), JSON.stringify({ executor: "claude", cwd: "/wt", title: UNIT, workspace: UNIT, logPath: "/m/log" }));
}

const herdrCalls = (m: TestMachine) => m.exec.calls.filter((c) => c.argv[0] === "herdr").map((c) => c.argv.slice(1));

describe("norn run attach", () => {
  test("focuses the herdr pane of a unit's live run", async () => {
    const m = inPanes();
    await seedUnit(m, { step: AGENT_STEP });
    await launchedHere(m);
    const r = await runCli(["run", "attach", UNIT, "--json"], m.io);
    expect(r.exit).toBe(ExitCode.ok);
    expect(json(r.stdout)).toEqual({ unit: UNIT, run: RUN, focused: true });
    expect(herdrCalls(m).filter((c) => c[1] === "focus")).toEqual([["agent", "focus", PANE]]);
  });

  test("--next focuses the agent that has waited for you longest", async () => {
    const m = inPanes();
    await seedUnit(m, { unit: "lt-2", step: AGENT_STEP, run: "01JBBBBBBBBBBBBBBBBBBBBBBB" });
    await seedUnit(m, { step: AGENT_STEP, extra: { parked: { reason: "agent.asking.park", since: "2026-11-17T10:00:00.000Z" } } });
    await launchedHere(m);
    const r = await runCli(["run", "attach", "--next", "--json"], m.io);
    expect(json(r.stdout)).toEqual({ unit: UNIT, run: RUN, focused: true });
  });

  test("refused nothing_to_attach, naming what to do instead: no live run, nobody waiting, a runner with no pane, a run launched elsewhere", async () => {
    const m = inPanes();
    await seedUnit(m, { step: GATE_STEP, run: null });
    const noRun = await runCli(["run", "attach", UNIT, "--json"], m.io);
    expect({ exit: noRun.exit, ...json(noRun.stdout) }).toMatchObject({ exit: ExitCode.refused, code: "nothing_to_attach", error: `${UNIT} has no live run`, do_instead: expect.stringContaining(`norn story approve ${UNIT}`) });
    const nobody = await runCli(["run", "attach", "--next", "--json"], m.io);
    expect(json(nobody.stdout)).toMatchObject({ code: "nothing_to_attach", error: "No agent waits for you", do_instead: "norn status" });

    const headless = configured();
    await seedUnit(headless, { step: AGENT_STEP });
    expect(json((await runCli(["run", "attach", UNIT, "--json"], headless.io)).stdout)).toMatchObject({ code: "nothing_to_attach", error: expect.stringContaining("no pane to bring in front") });

    const elsewhere = inPanes();
    await seedUnit(elsewhere, { step: AGENT_STEP });
    expect(json((await runCli(["run", "attach", UNIT, "--json"], elsewhere.io)).stdout)).toMatchObject({ code: "nothing_to_attach", error: expect.stringContaining("launched on another machine") });
  });

  test("refused nothing_to_attach when the run's pane is gone, and for a unit not on the record", async () => {
    const goneScript: ExecScript = (argv) => (argv[0] === "herdr" && argv[2] === "get" ? { code: 1, stderr: '{"error":{"code":"pane_not_found"}}' } : herdr(argv, { cwd: "/" }));
    const m = configured({ runner: "herdr", script: goneScript });
    await seedUnit(m, { step: AGENT_STEP });
    await launchedHere(m);
    const gone = await runCli(["run", "attach", UNIT, "--json"], m.io);
    expect({ exit: gone.exit, ...json(gone.stdout) }).toMatchObject({ exit: ExitCode.refused, code: "nothing_to_attach", error: `${UNIT} run ${RUN}: its pane is gone`, do_instead: `norn story view ${UNIT}` });
    const unknown = await runCli(["run", "attach", "lt-9", "--json"], m.io);
    expect(json(unknown.stdout)).toMatchObject({ code: "nothing_to_attach", error: "lt-9 is not a unit on this machine's record", do_instead: "norn status" });
  });

  test("a unit and --next together, or neither, is a usage error", async () => {
    for (const argv of [["run", "attach"], ["run", "attach", UNIT, "--next"]]) expect((await runCli([...argv, "--json"], configured().io)).exit).toBe(ExitCode.usage);
  });
});
