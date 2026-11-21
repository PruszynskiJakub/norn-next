/**
 * `norn workflow confirm <name>`: the person confirms a repo workflow held because its change touches
 * a person's step, `attended:` or `allow:`. Until then doctor names what changed, the ticks go on, and
 * new rounds run the revision last confirmed (or the pack's), or none for a workflow only the repo has.
 */
import { describe, expect, test } from "bun:test";
import { SDLC_PACK } from "@norn/pack-sdlc";
import { confirmedWorkflowPath } from "@norn/runtime";
import { configPaths, ExitCode, machineDir, machineId, runCli } from "../../src/index.ts";
import { COMMON, HOME, LOCAL_CONFIG, machine, ROOT } from "./support.ts";
import { AGENT_STEP, configured, receiptsOf, seedUnit, UNIT } from "./units.ts";

const PATHS = configPaths(HOME, ROOT);
const DIR = `${ROOT}/.agents/workflows`;
const MACHINE = machineDir(HOME, machineId(COMMON));
const json = (stdout: string): Record<string, unknown> => Bun.JSONL.parse(stdout)[0] as Record<string, unknown>;

const OWN = ["name: own", "start: work", "steps:", "  work:", "    by: builder", "    do: Do the work.", "    outcomes: { done: ready }", "  ready:", "    by: person", "    do: Approve it.", "    outcomes: { approve: $done, reject: { to: work, max: 2 } }", ""].join("\n");
const CONFIG = LOCAL_CONFIG.replace("  intake: { label: norn }", "  intake: { label: norn }\n  user: me@box");
const tools = (argv: string[]) => (argv[1] === "--version" && ["git", "norn", "claude"].includes(argv[0] as string) ? { stdout: "1.0\n" } : undefined);
const repoWith = (files: Record<string, string>) =>
  machine({ seed: { [PATHS.local]: CONFIG, ...Object.fromEntries(Object.entries(files).map(([f, t]) => [`${DIR}/${f}`, t])) }, script: tools });
const workflowsCheck = async (m: ReturnType<typeof repoWith>) =>
  (json((await runCli(["doctor", "--json"], m.io)).stdout).checks as Array<{ name: string; ok: boolean; warning?: string; do_instead?: string }>).find((c) => c.name === "workflows");

/** The pack's file with its first `allow: [docs:write]` dropped: a repo copy that lets its reviewer write the code. */
const widened = (file: string): string => {
  const text = SDLC_PACK.workflows[file] as string;
  if (!text.includes("    allow: [docs:write]\n")) throw new Error(`${file} has no allow: [docs:write] to drop`);
  return text.replace("    allow: [docs:write]\n", "");
};
const HELD_QUICK = "workflow quick is held for the person's confirmation (step review: allow [docs:write] → [code:write]); new rounds run the pack's revision, not the repo's file: a person runs norn workflow confirm quick";

describe("a repo copy of a pack workflow held on upgrade is impossible to miss", () => {
  test("every tick says new rounds run the pack's revision, and watch says it once", async () => {
    const m = repoWith({ "quick.yaml": widened("quick.yaml") });
    const ticked = await runCli(["tick", "--json"], m.io);
    expect(ticked.exit).toBe(ExitCode.ok);
    expect(json(ticked.stdout).problems).toContain(HELD_QUICK);
    expect((await runCli(["tick"], m.io)).stdout).toContain(`problem: ${HELD_QUICK}`);
    const lines: string[] = [];
    m.io.log = (l) => lines.push(l);
    m.io.sleep = async () => {};
    await runCli(["watch", "--interval", "30s", "--max-ticks", "3"], m.io);
    expect(lines.filter((l) => l.includes(HELD_QUICK))).toHaveLength(1);
    await runCli(["workflow", "confirm", "quick"], m.io);
    expect(json((await runCli(["tick", "--json"], m.io)).stdout).problems).toEqual([]);
  });

  test("a story is not created on a held workflow, named or the default, until the person confirms it", async () => {
    const m = repoWith({ "quick.yaml": widened("quick.yaml"), "story.yaml": widened("story.yaml") });
    const named = await runCli(["story", "create", "Do it", "--workflow", "quick", "--json"], m.io);
    expect({ exit: named.exit, body: json(named.stdout) }).toMatchObject({ exit: ExitCode.refused, body: { code: "workflow_held", do_instead: "norn workflow confirm quick" } });
    expect(String(json(named.stdout).error)).toContain("new rounds would run the pack's revision, not the repo's file");
    const byDefault = await runCli(["story", "create", "Do it", "--json"], m.io);
    expect({ exit: byDefault.exit, body: json(byDefault.stdout) }).toMatchObject({ exit: ExitCode.refused, body: { code: "workflow_held", do_instead: "norn workflow confirm story" } });
    expect((await runCli(["story", "list", "--json"], m.io)).stdout).not.toContain("Do it");
    await runCli(["workflow", "confirm", "quick"], m.io);
    expect((await runCli(["story", "create", "Do it", "--workflow", "quick", "--json"], m.io)).exit).toBe(ExitCode.ok);
  });

  test("a round of a held workflow is refused, recording nothing, until the person confirms it", async () => {
    const m = configured();
    await seedUnit(m, { step: AGENT_STEP, extra: { ended: "done" }, run: null });
    await m.files.write(`${DIR}/quick.yaml`, widened("quick.yaml"));
    const r = await runCli(["story", "round", UNIT, "--workflow", "quick", "--json"], m.io);
    expect({ exit: r.exit, body: json(r.stdout) }).toMatchObject({ exit: ExitCode.refused, body: { code: "workflow_held", do_instead: "norn workflow confirm quick" } });
    expect(await receiptsOf(m)).toEqual([]);
    await runCli(["workflow", "confirm", "quick"], m.io);
    expect((await runCli(["story", "round", UNIT, "--workflow", "quick", "--json"], m.io)).exit).toBe(ExitCode.ok);
  });
});

describe("norn workflow confirm", () => {
  test("a workflow only the repo has waits for the person: doctor says so, ticks go on, a story cannot take it until it is confirmed", async () => {
    const m = repoWith({ "own.yaml": OWN });
    const check = await workflowsCheck(m);
    expect(check?.ok).toBe(true);
    expect(check?.warning).toContain("workflow own is held for your confirmation (person step ready added); new rounds run none of it");
    expect(check?.do_instead).toContain("norn workflow confirm own");
    expect((await runCli(["tick", "--json"], m.io)).exit).toBe(ExitCode.ok);
    const asked = await runCli(["story", "create", "Do it", "--workflow", "own", "--json"], m.io);
    expect({ exit: asked.exit, body: json(asked.stdout) }).toMatchObject({ exit: ExitCode.refused, body: { code: "workflow_held", do_instead: "norn workflow confirm own" } });

    const confirmed = await runCli(["workflow", "confirm", "own", "--json"], m.io);
    expect(confirmed.exit).toBe(ExitCode.ok);
    expect(json(confirmed.stdout)).toMatchObject({ workflow: "own", confirmed: true, changes: ["person step ready added"] });
    expect(JSON.parse((await m.files.read(confirmedWorkflowPath(MACHINE, "own"))) as string)).toMatchObject({ name: "own", hash: json(confirmed.stdout).hash });
    expect((await workflowsCheck(m))?.warning).toBeUndefined();
    expect((await runCli(["story", "create", "Do it", "--workflow", "own", "--json"], m.io)).exit).toBe(ExitCode.ok);
  });

  test("the answer names what the person confirmed, in markdown too", async () => {
    const m = repoWith({ "own.yaml": OWN });
    await runCli(["workflow", "confirm", "own"], m.io);
    await m.files.write(`${DIR}/own.yaml`, OWN.replace("    do: Do the work.", "    do: Do the work.\n    attended: person"));
    const md = await runCli(["workflow", "confirm", "own"], m.io);
    expect(md.stdout).toContain("Confirmed workflow own");
    expect(md.stdout).toContain("step work: attended none → person");
  });

  test("a workflow nothing holds has nothing to confirm, and writes nothing", async () => {
    const m = repoWith({});
    const r = await runCli(["workflow", "confirm", "story", "--json"], m.io);
    expect(r.exit).toBe(ExitCode.ok);
    expect(json(r.stdout)).toMatchObject({ workflow: "story", confirmed: false });
    expect(await m.files.read(confirmedWorkflowPath(MACHINE, "story"))).toBeNull();
  });

  test("a workflow no file holds, or one whose file does not load, is refused", async () => {
    const m = repoWith({ "broken.yaml": "name: broken\nsteps: [unclosed\n" });
    expect(json((await runCli(["workflow", "confirm", "nope", "--json"], m.io)).stdout)).toMatchObject({ code: "unknown_workflow" });
    const broken = json((await runCli(["workflow", "confirm", "broken", "--json"], m.io)).stdout);
    expect(broken).toMatchObject({ code: "invalid_workflow" });
    expect(String(broken.error)).toContain("does not parse");
  });
});
