/**
 * The cockpit through the CLI: `status --watch` with its keys (`--json` for the model, one frame per
 * key read) and `--pane`, over the in-memory machine and a scripted herdr.
 */
import { describe, expect, test } from "bun:test";
import type { ExecScript } from "@norn/conformance";
import { type CliIo, ExitCode, runCli } from "../../src/index.ts";
import { HOME, ROOT, type TestMachine } from "./support.ts";
import { AGENT_STEP, configured, envOf, GATE_STEP, receiptsOf, runEnv, seedUnit, UNIT, withEnv } from "./units.ts";

const json = (stdout: string): Record<string, unknown> => Bun.JSONL.parse(stdout)[0] as Record<string, unknown>;
/** herdr answering for a pane split below the asking one */
const herdr: ExecScript = (argv) => {
  if (argv[0] !== "herdr") return undefined;
  const verb = `${argv[1]} ${argv[2]}`;
  if (verb === "pane split") return { stdout: JSON.stringify({ result: { pane: { pane_id: "w1:p9" } } }) };
  if (verb === "pane rename" || verb === "pane run") return { stdout: "" };
  return undefined;
};

const inPanes = (env: Record<string, string> = {}): TestMachine => configured({ runner: "herdr", script: herdr, env });

const herdrCalls = (m: TestMachine) => m.exec.calls.filter((c) => c.argv[0] === "herdr").map((c) => c.argv.slice(1));

/** A terminal a person types `chunks` into, one read each; frames land in `frames`. */
function terminal(m: TestMachine, chunks: string[]): { io: CliIo; frames: string[] } {
  const frames: string[] = [];
  const io: CliIo = {
    ...m.io,
    log: (line) => frames.push(line),
    terminal: () => ({
      keys: (async function* () {
        for (const c of chunks) yield c;
      })(),
      columns: 120,
      rows: 30,
      color: false,
      close: () => {},
    }),
  };
  return { io, frames };
}

describe("norn status --watch", () => {
  test("--json prints the cockpit model once: what needs you first, each row with the keys its actions take", async () => {
    const m = configured();
    await seedUnit(m, { step: GATE_STEP, run: null });
    await seedUnit(m, { unit: "lt-2", step: AGENT_STEP, run: null, extra: { parked: { reason: "agent.ready.manual", since: "2026-11-17T10:00:00.000Z" } } });
    await seedUnit(m, { unit: "lt-3", step: AGENT_STEP, run: null, extra: { ended: "stuck", ended_reason: "check failed" } });
    await seedUnit(m, { unit: "lt-4", step: AGENT_STEP, run: "01JCCCCCCCCCCCCCCCCCCCCCCC", extra: { parked: { reason: "agent.asking.park", since: "2026-11-17T10:00:00.000Z" } } });
    const r = await runCli(["status", "--watch", "--json"], m.io);
    expect(r.exit).toBe(ExitCode.ok);
    const rows = (json(r.stdout) as { rows: Array<{ unit: string; kind: string; group: string | null; actions: Array<{ key: string; argv?: string[] }> }> }).rows;
    const keys = Object.fromEntries(rows.map((row) => [row.unit, [row.kind, row.group, row.actions.map((a) => a.key).join(" ")]]));
    expect(keys).toEqual({
      "lt-2": ["item", "your_turn", "enter s"],
      "lt-4": ["item", "answer", "enter a"],
      [UNIT]: ["item", "approve", "enter y x"],
      "lt-3": ["item", "unblock", "enter u"],
    });
  });

  test("each key runs the norn command that does it: y approves the gate, and the frame says so", async () => {
    const m = configured();
    await seedUnit(m, { step: GATE_STEP, run: null });
    const { io, frames } = terminal(m, ["y", "q"]);
    const r = await runCli(["status", "--watch"], io);
    expect(r.exit).toBe(ExitCode.ok);
    expect((await receiptsOf(m)).map((x) => x.data.kind)).toContain("gate.decided");
    expect(frames[0]).toContain("NEEDS YOU");
    expect(frames[0]).toContain(`● ${UNIT}`);
    expect(frames.at(-1)).toContain(`ok: norn story approve ${UNIT}`);
    expect(json(r.stdout)).toMatchObject({ frames: 2, last: { action: "approve", unit: UNIT, ok: true } });
  });

  test("a answers in the footer: what is typed goes to story answer, esc cancels", async () => {
    const m = configured();
    await seedUnit(m, { step: AGENT_STEP });
    await runCli(["ask", "which db?"], withEnv(m, runEnv()).io);
    // the tick that applies the ask parks the unit on it, which is what status shows
    await (await envOf(m)).slots.store.claims.acquire(UNIT, "me@box", 60_000);
    await runCli(["tick"], m.io);
    const { io, frames } = terminal(m, ["a", "use v2\r", "q"]);
    await runCli(["status", "--watch"], io);
    expect(frames[1]).toContain("Your answer (answer lt-1):");
    expect((await receiptsOf(m)).at(-1)?.data).toMatchObject({ kind: "answer.sent", text: "use v2" });
  });

  test("a stdin that ends draws one frame and ends the cockpit", async () => {
    const m = configured();
    const { io, frames } = terminal(m, []);
    const r = await runCli(["status", "--watch"], io);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toContain("nothing needs you");
    expect(json(r.stdout)).toMatchObject({ frames: 1 });
  });

  test("--pane opens the cockpit in a pane below the asking one, without focus; with no runner that opens panes it is refused", async () => {
    const m = inPanes({ HERDR_PANE_ID: "w1:p1" });
    const r = await runCli(["status", "--watch", "--pane", "--json"], m.io);
    expect(json(r.stdout)).toEqual({ opened: true, pane: "w1:p9" });
    expect(herdrCalls(m)).toEqual([
      // the cockpit in the pane reads the same norn home as the command that opened it
      ["pane", "split", "--pane", "w1:p1", "--direction", "down", "--ratio", "0.3", "--cwd", ROOT, "--env", `NORN_HOME_DIR=${HOME}`, "--no-focus"],
      ["pane", "rename", "w1:p9", "norn"],
      ["pane", "run", "w1:p9", "norn status --watch"],
    ]);
    const headless = await runCli(["status", "--watch", "--pane", "--json"], configured().io);
    expect({ exit: headless.exit, code: json(headless.stdout).code }).toEqual({ exit: ExitCode.refused, code: "no_pane_runner" });
  });

  test("--interval and --pane alone are usage errors naming the flag they need", async () => {
    for (const [flag, value] of [["--interval", "5s"], ["--pane"]] as const) {
      const r = await runCli(["status", flag, ...(value ? [value] : []), "--json"], configured().io);
      expect(r.exit).toBe(ExitCode.usage);
    }
  });
});
