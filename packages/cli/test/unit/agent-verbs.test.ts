import { describe, expect, test } from "bun:test";
import { reportReceiptId } from "@norn/runtime";
import { ExitCode, runCli } from "../../src/index.ts";
import { machine } from "./support.ts";
import { AGENT_STEP, configured, GATE_STEP, RUN, receiptsOf, runEnv, seedUnit, UNIT, withEnv } from "./units.ts";

const json = (stdout: string): unknown => Bun.JSONL.parse(stdout)[0];

/** Claude Code's Stop payload, as recorded from a real session. */
const STOP = JSON.stringify({
  session_id: "abc123",
  transcript_path: "/home/u/.claude/projects/-repo/abc123.jsonl",
  cwd: "/repo/.worktrees/gh-12",
  permission_mode: "default",
  hook_event_name: "Stop",
  stop_hook_active: false,
  last_assistant_message: "All tests pass.",
});

describe("norn hook always answers its harness", () => {
  test("a session norn did not launch is let through without a config, whatever its stdin", async () => {
    const r = await runCli(["hook", "claude", "Stop"], machine({ stdin: "not json{" }).io);
    expect({ exit: r.exit, stdout: r.stdout }).toEqual({ exit: 0, stdout: "" });
  });

  test("a launched session with no config answers nothing, exit 0, and says why on stderr", async () => {
    const r = await runCli(["hook", "claude", "Stop", "--json"], machine({ stdin: STOP, env: runEnv() }).io);
    expect({ exit: r.exit, stdout: r.stdout }).toEqual({ exit: 0, stdout: "" });
    expect(r.stderr).toStartWith("norn hook: ");
  });

  test("bad stdin, an unknown harness or a wrong argument count still answer, exit 0", async () => {
    const m = configured({ env: runEnv(), stdin: "not json{" });
    await seedUnit(m, { step: AGENT_STEP });
    for (const argv of [
      ["hook", "claude", "Stop"],
      ["hook", "nobody", "Stop"],
      ["hook", "claude"],
    ]) {
      const r = await runCli(argv, m.io);
      expect({ argv, exit: r.exit }).toEqual({ argv, exit: 0 });
    }
  });

  test("a live run that has not reported is blocked at Stop; once it reports done, Stop is allowed", async () => {
    const m = configured({ env: runEnv(), stdin: STOP });
    await seedUnit(m, { step: AGENT_STEP });
    const blocked = await runCli(["hook", "claude", "Stop"], m.io);
    expect(blocked.exit).toBe(0);
    expect(json(blocked.stdout)).toMatchObject({ decision: "block" });
    expect((json(blocked.stdout) as { reason: string }).reason).toContain("norn done");
    expect((await runCli(["done", "done"], m.io)).exit).toBe(ExitCode.ok);
    const allowed = await runCli(["hook", "claude", "Stop"], m.io);
    expect({ exit: allowed.exit, stdout: allowed.stdout }).toEqual({ exit: 0, stdout: "" });
  });
});

describe("the agent verbs act for the run in the launch env", () => {
  test("outside a launched session they refuse, naming the env and what to do instead", async () => {
    const r = await runCli(["done", "done", "--json"], configured().io);
    expect(r.exit).toBe(ExitCode.refused);
    expect(json(r.stdout)).toMatchObject({ code: "no_run_env", error: expect.stringContaining("NORN_UNIT") });
  });

  test("brief prints the live run's brief; a replaced run's session is refused", async () => {
    const m = configured({ env: runEnv() });
    await seedUnit(m, { step: AGENT_STEP });
    const r = await runCli(["brief", "--json"], m.io);
    expect(r.exit).toBe(ExitCode.ok);
    expect(json(r.stdout)).toMatchObject({ unit: UNIT, run_id: RUN, markdown: expect.stringContaining(AGENT_STEP) });
    expect((await runCli(["brief"], m.io)).stdout).toContain(AGENT_STEP);
    const stale = await runCli(["brief", "--json"], withEnv(m, runEnv(UNIT, "01JBBBBBBBBBBBBBBBBBBBBBBB")).io);
    expect({ exit: stale.exit, code: (json(stale.stdout) as { code: string }).code }).toEqual({ exit: ExitCode.refused, code: "stale_run" });
  });

  test("done with an outcome the step does not route refuses, listing the ones it does", async () => {
    const m = configured({ env: runEnv() });
    await seedUnit(m, { step: AGENT_STEP });
    const r = await runCli(["done", "shipped", "--json"], m.io);
    expect(r.exit).toBe(ExitCode.refused);
    expect(json(r.stdout)).toEqual({ error: 'outcome "shipped" is not one step slice routes', do_instead: "report one of `done`, `replan`", code: "outcome" });
    expect(await receiptsOf(m)).toEqual([]);
  });

  test("a retried report records once; its id comes from the flag, else NORN_REPORT_ID, else what it reports", async () => {
    const m = configured({ env: runEnv() });
    await seedUnit(m, { step: AGENT_STEP });
    const first = json((await runCli(["done", "done", "--note", "all green", "--json"], m.io)).stdout);
    const again = json((await runCli(["done", "done", "--json"], m.io)).stdout);
    expect(first).toMatchObject({ report_id: `${RUN}.done.done`, replayed: false });
    expect(again).toMatchObject({ report_id: `${RUN}.done.done`, replayed: true, seq: (first as { seq: number }).seq });
    const other = await runCli(["done", "replan", "--json"], m.io);
    expect({ exit: other.exit, code: (json(other.stdout) as { code: string }).code }).toEqual({ exit: ExitCode.refused, code: "reported" });
    const receipts = await receiptsOf(m);
    expect(receipts.map((r) => [r.id, r.data])).toEqual([
      [reportReceiptId(`${RUN}.done.done`), { kind: "run.reported", step: AGENT_STEP, attempt: 1, run_id: RUN, verb: "done", outcome: "done", text: "all green" }],
    ]);

    const env = configured({ env: { ...runEnv(), NORN_REPORT_ID: "from-env" } });
    await seedUnit(env, { step: AGENT_STEP });
    expect(json((await runCli(["stuck", "no", "way", "--json"], env.io)).stdout)).toMatchObject({ report_id: "from-env", replayed: false });
    // the flag wins over the env: another id is another report, which a run that reported may not make
    expect(json((await runCli(["stuck", "no", "way", "--report-id", "from-flag", "--json"], env.io)).stdout)).toMatchObject({ code: "reported" });
    expect(json((await runCli(["stuck", "no", "way", "--report-id", "from-env", "--json"], env.io)).stdout)).toMatchObject({ report_id: "from-env", replayed: true });
    expect((await receiptsOf(env)).map((r) => r.id)).toEqual([reportReceiptId("from-env")]);
  });

  test("ask records the question as one argument; a run at a gate takes no report", async () => {
    const m = configured({ env: runEnv() });
    await seedUnit(m, { step: AGENT_STEP });
    expect((await runCli(["ask", "which", "db?"], m.io)).exit).toBe(ExitCode.ok);
    expect((await receiptsOf(m)).map((r) => r.data)).toEqual([{ kind: "run.reported", step: AGENT_STEP, attempt: 1, run_id: RUN, verb: "ask", text: "which db?" }]);
    const gate = configured({ env: runEnv() });
    await seedUnit(gate, { step: GATE_STEP });
    const r = await runCli(["done", "done", "--json"], gate.io);
    expect({ exit: r.exit, code: (json(r.stdout) as { code: string }).code }).toEqual({ exit: ExitCode.refused, code: "not_agent" });
  });
});
