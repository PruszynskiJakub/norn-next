import { describe, expect, test } from "bun:test";
import type { ExecScript } from "@norn/conformance";
import type { HarnessEvent } from "@norn/plugin-api";
import { appendEvents } from "@norn/runtime";
import { ExitCode, runCli } from "../../src/index.ts";
import { AGENT_STEP, configured, envOf, GATE_STEP, RUN, receiptsOf, seedUnit, UNIT } from "./units.ts";
import type { TestMachine } from "./support.ts";

const json = (stdout: string): Record<string, unknown> => Bun.JSONL.parse(stdout)[0] as Record<string, unknown>;
/** the pane `seedUnit`'s handle names for its run */
const PANE = "4242@boot";

/** herdr answering for one live pane: the agent holds its foreground, and keys go in */
const herdr: ExecScript = (argv) => {
  if (argv[0] !== "herdr") return undefined;
  const verb = `${argv[1]} ${argv[2]}`;
  if (verb === "pane process-info") return { stdout: JSON.stringify({ result: { process_info: { foreground_process_group_id: 900, shell_pid: 800 } } }) };
  if (verb === "pane send-text" || verb === "pane send-keys") return { stdout: "" };
  return undefined;
};

/** the configured machine with its claude executor in herdr panes */
const inPanes = (): TestMachine => configured({ runner: "herdr", script: herdr });

const at = (seq: number) => new Date(Date.parse("2026-11-17T10:00:00.000Z") + seq * 1000).toISOString();
const ev = (seq: number, body: Record<string, unknown>) => ({ run_id: RUN, seq, at: at(seq), ...body }) as HarnessEvent;

async function permissionOpen(m: TestMachine): Promise<void> {
  const env = await envOf(m);
  const wrote = await appendEvents(env.ctx, UNIT, RUN, [
    ev(0, { type: "session.started", harness_session: "s-1" }),
    ev(1, { type: "tool.requested", id: "t1", kind: "shell", tool: "Bash", detail: "rm -rf build" }),
    ev(2, { type: "tool.permission", id: "perm-1", prompt: "Claude needs your permission to use Bash" }),
  ]);
  if (!wrote.ok) throw new Error(wrote.failure.message);
}

describe("a permission prompt in an agent's pane", () => {
  test("story answer records a dialog answer naming the call, and the next tick presses its keys in the pane", async () => {
    const m = inPanes();
    await seedUnit(m, { step: AGENT_STEP });
    await permissionOpen(m);
    const r = await runCli(["story", "answer", UNIT, "1", "--json"], m.io);
    expect(r.exit).toBe(ExitCode.ok);
    expect(json(r.stdout)).toMatchObject({ unit: UNIT, question: "Bash(rm -rf build): Claude needs your permission to use Bash", replayed: false });
    expect((await receiptsOf(m)).at(-1)?.data).toEqual({ kind: "answer.sent", input_id: "perm-1@t1", text: "1", by: "me@box", to: "dialog", step: AGENT_STEP, attempt: 1 });
    await (await envOf(m)).slots.store.claims.acquire(UNIT, "me@box", 60_000);
    const before = m.exec.calls.length;
    await runCli(["tick", "--json"], m.io);
    expect(m.exec.calls.slice(before).filter((c) => c.argv[0] === "herdr" && c.argv[2]?.startsWith("send-")).map((c) => c.argv.slice(1))).toEqual([
      ["pane", "send-text", PANE, "1"],
      ["pane", "send-keys", PANE, "enter"],
    ]);
  });

  test("an answer the dialog takes no key for is refused, and nothing is recorded", async () => {
    const m = inPanes();
    await seedUnit(m, { step: AGENT_STEP });
    await permissionOpen(m);
    const r = await runCli(["story", "answer", UNIT, "sure thing", "--json"], m.io);
    expect({ exit: r.exit, code: json(r.stdout).code }).toEqual({ exit: ExitCode.refused, code: "not_an_option" });
    expect(await receiptsOf(m)).toEqual([]);
  });
});

describe("a run whose agent has sent no event, parked for the dialog in its pane", () => {
  const noEvents = { parked: { reason: "agent.no_events.park", since: "2026-11-17T10:20:00.000Z" } };

  test("story answer presses the trust prompt's keys through a runner that can", async () => {
    const m = inPanes();
    await seedUnit(m, { step: AGENT_STEP, extra: noEvents });
    const r = await runCli(["story", "answer", UNIT, "yes", "--json"], m.io);
    expect(r.exit).toBe(ExitCode.ok);
    expect((await receiptsOf(m)).at(-1)?.data).toEqual({ kind: "answer.sent", input_id: `dialog-${RUN}`, text: "yes", by: "me@box", to: "dialog", step: AGENT_STEP, attempt: 1 });
  });

  test("an executor that cannot press keys in a pane is refused, sent to the pane or a rerun", async () => {
    const m = configured();
    await seedUnit(m, { step: AGENT_STEP, extra: noEvents });
    const r = await runCli(["story", "answer", UNIT, "1", "--json"], m.io);
    expect({ exit: r.exit, code: json(r.stdout).code }).toEqual({ exit: ExitCode.refused, code: "dialog_unanswerable" });
    expect(json(r.stdout).do_instead).toContain(`norn run rerun ${UNIT}`);
    expect(await receiptsOf(m)).toEqual([]);
  });
});

type Waiting = { for: string; text: string; next?: string } | null;
const waitingIn = (stdout: string): Waiting => ((json(stdout).stories as Array<{ units: Array<{ waiting: Waiting }> }>)[0]?.units[0]?.waiting ?? null) as Waiting;

describe("status and story view say what a parked unit waits for, never the rule that parked it", () => {
  test("a permission park shows the call and the prompt, and the answer that lets it run", async () => {
    const m = inPanes();
    await seedUnit(m, { step: AGENT_STEP, extra: { parked: { reason: "agent.permission.park", since: "2026-11-17T10:00:00.000Z" } } });
    await permissionOpen(m);
    expect(waitingIn((await runCli(["status", "--json"], m.io)).stdout)).toEqual({
      for: "permission",
      text: "Bash(rm -rf build): Claude needs your permission to use Bash",
      next: `norn story answer ${UNIT} <option> (1 allows it, no refuses it)`,
    });
    const md = (await runCli(["status"], m.io)).stdout;
    expect(md).toContain("waits for permission: Bash(rm -rf build): Claude needs your permission to use Bash");
    expect(md).not.toContain("agent.permission.park");
    expect((await runCli(["story", "view", UNIT], m.io)).stdout).toContain(`→ norn story answer ${UNIT} <option>`);
  });

  test("a silent run's park tells the person to trust the folder in the pane", async () => {
    const m = inPanes();
    await seedUnit(m, { step: AGENT_STEP, extra: { parked: { reason: "agent.no_events.park", since: "2026-11-17T10:20:00.000Z" } } });
    const w = waitingIn((await runCli(["status", "--json"], m.io)).stdout);
    expect(w?.text).toContain("trust the folder there");
    expect(w?.next).toBe(`norn story answer ${UNIT} 1, or norn run rerun ${UNIT} if the pane shows something else`);
  });

  test("an attended step names run start, a stuck park names rerun, and a gate shows its prompt", async () => {
    const cases: Array<[string, string, Partial<Waiting & object>]> = [
      [AGENT_STEP, "agent.ready.attended", { for: "person", next: `norn run start ${UNIT}` }],
      [AGENT_STEP, "agent.died.manual", { for: "person", text: "its run ended without a report", next: `norn run rerun ${UNIT}` }],
      [GATE_STEP, "gate.park", { for: "gate", next: `norn story approve ${UNIT}, or norn story reject ${UNIT} --reason "<what to change>"` }],
    ];
    for (const [step, reason, expected] of cases) {
      const m = configured();
      await seedUnit(m, { step, run: null, extra: { parked: { reason, since: "2026-11-17T10:00:00.000Z" } } });
      const w = waitingIn((await runCli(["status", "--json"], m.io)).stdout);
      expect([reason, w]).toMatchObject([reason, expected]);
      expect(w?.text).not.toBe(reason);
    }
    const gate = configured();
    await seedUnit(gate, { step: GATE_STEP, run: null, extra: { parked: { reason: "gate.park", since: "2026-11-17T10:00:00.000Z" } } });
    expect(waitingIn((await runCli(["status", "--json"], gate.io)).stdout)?.text).toContain("Review the slice files");
  });
});
