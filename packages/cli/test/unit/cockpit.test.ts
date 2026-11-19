/**
 * The cockpit through the CLI: `status --watch` with its keys (`--json` for the model, one frame per
 * key read) and `--pane`, over the in-memory machine and a scripted herdr.
 */
import { describe, expect, test } from "bun:test";
import type { ExecScript } from "@norn/conformance";
import { launchRecordPath } from "@norn/runtime";
import { type CliIo, configPaths, ExitCode, runCli } from "../../src/index.ts";
import { fakeGh, GITHUB_CONFIG, HOME, LOCAL_CONFIG, machine, ROOT, type TestMachine } from "./support.ts";
import { AGENT_STEP, configured, envOf, GATE_STEP, RUN, receiptsOf, runEnv, seedUnit, UNIT, withEnv } from "./units.ts";

const json = (stdout: string): Record<string, unknown> => Bun.JSONL.parse(stdout)[0] as Record<string, unknown>;
/** herdr answering for a pane split below the asking one */
const herdr: ExecScript = (argv) => {
  if (argv[0] !== "herdr") return undefined;
  const verb = `${argv[1]} ${argv[2]}`;
  if (verb === "pane split") return { stdout: JSON.stringify({ result: { pane: { pane_id: "w1:p9" } } }) };
  if (verb === "pane rename" || verb === "pane run") return { stdout: "" };
  // the pane `seedUnit`'s handle names for its run, and the story's workspace
  if (verb === "pane get") return { stdout: JSON.stringify({ result: { pane: { pane_id: argv[3], tab_id: "w1:t2", agent_status: "working" } } }) };
  if (verb === "agent focus") return { stdout: '{"result":{"type":"ok"}}' };
  if (verb === "workspace list") return { stdout: JSON.stringify({ result: { workspaces: [{ workspace_id: "w1", label: UNIT }] } }) };
  if (verb === "workspace report-metadata") return { stdout: "" };
  return undefined;
};

/** the launch record this machine writes when it starts a run: only such a run's pane is focused */
async function launchedHere(m: TestMachine): Promise<void> {
  const env = await envOf(m);
  await env.ctx.files.write(launchRecordPath(env.ctx, UNIT, RUN), JSON.stringify({ executor: "claude", cwd: "/wt", title: UNIT, workspace: UNIT, logPath: "/m/log" }));
}

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

  test("t takes a story another machine holds: the reason typed is the confirmation, and the take goes through with --force", async () => {
    const m = configured();
    await seedUnit(m, { step: AGENT_STEP });
    await (await envOf(m)).slots.store.claims.acquire(UNIT, "alice@laptop", 60_000);
    const { io, frames } = terminal(m, ["t", "alice is away\r", "q"]);
    const r = await runCli(["status", "--watch"], io);
    expect(frames[1]).toContain(`Take ${UNIT} from alice@laptop? Why (take ${UNIT}):`);
    expect(frames.at(-1)).toContain(`ok: norn story take ${UNIT}`);
    expect(json(r.stdout)).toMatchObject({ last: { action: "take", unit: UNIT, ok: true } });
    const claim = await (await envOf(m)).slots.store.claims.read(UNIT);
    expect(claim.ok && claim.value?.holder).toBe("me@box");
    expect((await receiptsOf(m)).at(-1)?.data).toMatchObject({ kind: "claim.taken", reason: "alice is away" });
  });

  test("enter shows the story in full in place of the preview, esc goes back to the preview", async () => {
    const m = configured();
    await seedUnit(m, { step: AGENT_STEP });
    const { io, frames } = terminal(m, ["\r", "\x1b", "q"]);
    await runCli(["status", "--watch"], io);
    const view = (await runCli(["story", "view", UNIT], m.io)).stdout.split("\n")[0] as string;
    expect(frames[1]).toContain(`norn story view ${UNIT} — esc closes it`);
    expect(frames[1]).toContain(view.slice(0, 30));
    expect(frames[2]).toContain("LINKS");
  });

  test("g brings the pane of the story's live run in front through herdr", async () => {
    const m = inPanes();
    await seedUnit(m, { step: AGENT_STEP });
    await launchedHere(m);
    const { io, frames } = terminal(m, ["g", "q"]);
    await runCli(["status", "--watch"], io);
    expect(herdrCalls(m).filter((c) => c[1] === "focus")).toEqual([["agent", "focus", "4242@boot"]]);
    expect(frames.at(-1)).toContain(`focused the pane of ${UNIT}`);
  });

  test("x rejects the gate with the reason typed in the footer", async () => {
    const m = configured();
    await seedUnit(m, { step: GATE_STEP, run: null });
    const { io, frames } = terminal(m, ["x", "tests are thin\r", "q"]);
    await runCli(["status", "--watch"], io);
    expect((await receiptsOf(m)).find((x) => x.data.kind === "gate.decided")?.data).toMatchObject({ outcome: "reject", reason: "tests are thin" });
    expect(frames.at(-1)).toContain(`ok: norn story reject ${UNIT}`);
  });

  test("2 lists the intake no tick took in yet, 3 the finished stories", async () => {
    // a local tracker with nobody to assign to: every labelled open item is intake
    const m = machine({ seed: { [configPaths(HOME, ROOT).local]: LOCAL_CONFIG.replace("{ label: norn }", "{ label: norn, assignee: null }") } });
    await (await envOf(m)).slots.tracker.perform({ kind: "create", title: "Add search", body: "", labels: ["norn"] }, { receipt_id: "01JAAAAAAAAAAAAAAAAAAAAAAA" });
    await seedUnit(m, { unit: "lt-2", step: AGENT_STEP, run: null, extra: { ended: "done" } });
    const { io, frames } = terminal(m, ["2", "3", "q"]);
    await runCli(["status", "--watch"], io);
    expect(frames[1]).toContain("INTAKE 1");
    expect(frames[1]).toContain("lt-1");
    expect(frames[1]).toContain("Add search");
    expect(frames[2]).toContain("DONE 1");
    expect(frames[2]).toContain("lt-2");
  });

  test("i opens the story's issue with the system opener", async () => {
    const gh = fakeGh(["norn"]);
    const issue = { number: 1, url: "https://github.com/acme/app/issues/1", title: "Fix login", body: "", state: "OPEN", assignees: [], labels: [{ name: "norn" }], updatedAt: "2026-11-17T10:00:00Z" };
    const script: ExecScript = (argv, o) => {
      if (argv[0] === "open" || argv[0] === "xdg-open") return { stdout: "" };
      return argv[0] === "gh" && argv[1] === "issue" && argv[2] === "view" ? { stdout: JSON.stringify(issue) } : gh.script(argv, o);
    };
    const m = machine({ seed: { [configPaths(HOME, ROOT).local]: GITHUB_CONFIG }, script });
    await seedUnit(m, { unit: "gh-1", step: AGENT_STEP });
    const { io, frames } = terminal(m, ["i", "q"]);
    await runCli(["status", "--watch"], io);
    expect(m.exec.calls.map((c) => c.argv).filter((a) => a[0] === "open" || a[0] === "xdg-open")).toEqual([[process.platform === "darwin" ? "open" : "xdg-open", issue.url]]);
    expect(frames.at(-1)).toContain(`opened ${issue.url}`);
  });

  test("frames between are read from this machine's record alone: the code host is asked again on r, not every interval", async () => {
    const gh = fakeGh(["norn"]);
    const issue = { number: 1, url: "https://github.com/acme/app/issues/1", title: "Fix login", body: "", state: "OPEN", assignees: [], labels: [{ name: "norn" }], updatedAt: "2026-11-17T10:00:00Z" };
    const script: ExecScript = (argv, o) => (argv[0] === "gh" && argv[1] === "issue" && argv[2] === "view" ? { stdout: JSON.stringify(issue) } : gh.script(argv, o));
    const m = machine({ seed: { [configPaths(HOME, ROOT).local]: GITHUB_CONFIG }, script });
    await seedUnit(m, { unit: "gh-1", step: AGENT_STEP });
    const asked = () => m.exec.calls.filter((c) => c.argv[0] === "gh" && c.argv[1] === "issue" && c.argv[2] === "view").length;
    const seen: number[] = [];
    const frames: string[] = [];
    const io: CliIo = {
      ...m.io,
      log: (line) => frames.push(line),
      terminal: () => ({
        keys: (async function* () {
          await Bun.sleep(60);
          seen.push(asked());
          yield "r";
          await Bun.sleep(60);
          seen.push(asked());
          yield "q";
        })(),
        columns: 120,
        rows: 30,
        color: false,
        close: () => {},
      }),
    };
    await runCli(["status", "--watch", "--interval", "5ms"], io);
    expect(frames.length).toBeGreaterThan(4);
    // once at start, once on r, whatever number of frames was read in between
    expect(seen).toEqual([1, 2]);
    expect(frames.at(-1)).toContain("Fix login");
  });

  test("inside herdr each frame's read writes the story's $norn sidebar token", async () => {
    const m = inPanes({ HERDR_ENV: "1" });
    await seedUnit(m, { step: GATE_STEP, run: null });
    const { io } = terminal(m, []);
    await runCli(["status", "--watch"], io);
    expect(herdrCalls(m).filter((c) => c[1] === "report-metadata")).toEqual([["workspace", "report-metadata", "w1", "--source", "norn", "--token", "norn=● approve", "--ttl-ms", "15000"]]);
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
