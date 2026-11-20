import { describe, expect, test } from "bun:test";
import { configPaths, ExitCode, runCli } from "../../src/index.ts";
import { HOME, LOCAL_CONFIG, machine, ROOT } from "./support.ts";

const PATHS = configPaths(HOME, ROOT);
const DIR = `${ROOT}/.agents/workflows`;
const json = (stdout: string): Record<string, unknown> => Bun.JSONL.parse(stdout)[0] as Record<string, unknown>;

const TIDY = ["name: tidy", "start: work", "steps:", "  work:", "    agent: Do the work.", "    outcomes: { done: $done }", ""].join("\n");
/** the local tracker names its user, so story create can assign the item without asking git */
const CONFIG = LOCAL_CONFIG.replace("  intake: { label: norn }", "  intake: { label: norn }\n  user: me@box");
const tools = (argv: string[]) => (argv[1] === "--version" && ["git", "norn", "claude"].includes(argv[0] as string) ? { stdout: "1.0\n" } : undefined);

function repoWith(files: Record<string, string>) {
  return machine({ seed: { [PATHS.local]: CONFIG, ...Object.fromEntries(Object.entries(files).map(([f, t]) => [`${DIR}/${f}`, t])) }, script: tools });
}

describe("the repo's own workflows in .agents/workflows", () => {
  test("a new repo workflow loads beside the pack's: doctor names it as the repo's, and story create takes it", async () => {
    const m = repoWith({ "tidy.yaml": TIDY });
    const doctor = await runCli(["doctor", "--json"], m.io);
    const check = (json(doctor.stdout).checks as Array<{ name: string; ok: boolean; detail?: string }>).find((c) => c.name === "workflows");
    expect(check?.ok).toBe(true);
    expect(check?.detail).toContain("tidy");
    expect(check?.detail).toContain("(tidy from .agents/workflows/)");
    expect(check?.detail).toContain("story");
    const created = await runCli(["story", "create", "Tidy up", "--workflow", "tidy", "--json"], m.io);
    expect({ exit: created.exit, labels: json(created.stdout).labels }).toEqual({ exit: ExitCode.ok, labels: ["norn", "norn:wf:tidy"] });
  });

  test("a repo file named like a pack workflow replaces it", async () => {
    const m = repoWith({ "story.yaml": TIDY.replace("name: tidy", "name: story") });
    const doctor = await runCli(["doctor", "--json"], m.io);
    const check = (json(doctor.stdout).checks as Array<{ name: string; detail?: string }>).find((c) => c.name === "workflows");
    expect(check?.detail).toContain("(story from .agents/workflows/)");
  });

  test("a broken repo file: a tick refuses naming the repo's path, doctor fails its workflows check, and the other commands still work", async () => {
    const m = repoWith({ "tidy.yaml": TIDY, "broken.yaml": "name: broken\nsteps: [unclosed\n" });
    const tick = await runCli(["tick", "--json"], m.io);
    expect(tick.exit).toBe(ExitCode.refused);
    const body = json(tick.stdout);
    expect(body.code).toBe("repo_workflow_invalid");
    expect(body.error).toContain(".agents/workflows/broken.yaml");
    expect(body.error).toContain("does not parse");
    expect(body.error).not.toContain("tidy");
    expect(body.do_instead).toContain("fix .agents/workflows/broken.yaml");

    const doctor = await runCli(["doctor", "--json"], m.io);
    const checks = json(doctor.stdout).checks as Array<{ name: string; ok: boolean; code?: string }>;
    expect(checks.find((c) => c.name === "slots")?.ok).toBe(true);
    expect(checks.find((c) => c.name === "workflows")).toEqual(expect.objectContaining({ ok: false, code: "repo_workflow_invalid" }));

    expect((await runCli(["config", "show", "--json"], m.io)).exit).toBe(ExitCode.ok);
    expect((await runCli(["story", "create", "Tidy up", "--workflow", "tidy", "--json"], m.io)).exit).toBe(ExitCode.ok);
    const asked = await runCli(["story", "create", "Fix it", "--workflow", "broken", "--json"], m.io);
    expect({ exit: asked.exit, body: json(asked.stdout) }).toMatchObject({ exit: ExitCode.refused, body: { code: "invalid_workflow", do_instead: "fix .agents/workflows/broken.yaml, then norn doctor" } });
    expect(String(json(asked.stdout).error)).toContain("does not parse");
  });

  test("a repo workflow naming a skill neither the pack nor the repo has: doctor warns naming it, and the tick still runs, since the harness may load it from outside the repo", async () => {
    const skilled = TIDY.replace("    agent: Do the work.", "    agent: Do the work.\n    skills: [norn-tdd, house-style, user-level-skill, some-plugin:its-skill]");
    const m = repoWith({ "tidy.yaml": skilled });
    await m.files.write(`${ROOT}/.agents/skills/house-style/SKILL.md`, "---\nname: house-style\n---\n");
    expect((await runCli(["tick", "--json"], m.io)).exit).toBe(ExitCode.ok);
    const doctor = await runCli(["doctor", "--json"], m.io);
    const check = (json(doctor.stdout).checks as Array<{ name: string; ok: boolean; warning?: string }>).find((c) => c.name === "workflows");
    expect(check?.ok).toBe(true);
    expect(check?.warning).toContain(".agents/workflows/tidy.yaml names a skill neither the pack nor the repo has: user-level-skill (step work)");
    expect(check?.warning).not.toContain("house-style");
    expect(check?.warning).not.toContain("its-skill");
    expect((await runCli(["doctor"], m.io)).stdout).toContain("user-level-skill (step work)");
    await m.files.write(`${ROOT}/.agents/skills/user-level-skill/SKILL.md`, "---\nname: user-level-skill\n---\n");
    const again = (json((await runCli(["doctor", "--json"], m.io)).stdout).checks as Array<{ name: string; warning?: string }>).find((c) => c.name === "workflows");
    expect(again?.warning).toBeUndefined();
  });

  test("a repo workflow or shared file still routing stale or unpushed under a waiting step's outcomes: loads, and doctor warns naming the step and the move to on:", async () => {
    const gate = (on: string) => ["  ready:", "    gate: Approve?", "    outcomes:", "      approve: $done", "      reject: work", ...on.split("\n")];
    const legacy = [...TIDY.trimEnd().replace("{ done: $done }", "{ done: ready }").split("\n"), ...gate("      stale: work\n      unpushed: work"), ""].join("\n");
    const sharedLegacy = ["start: ready", "steps:", ...gate("      stale: $stuck"), ""].join("\n");
    const m = repoWith({ "tidy.yaml": legacy, "shared/hold.yaml": sharedLegacy });
    expect((await runCli(["tick", "--json"], m.io)).exit).toBe(ExitCode.ok);
    const doctor = await runCli(["doctor", "--json"], m.io);
    const check = (json(doctor.stdout).checks as Array<{ name: string; ok: boolean; warning?: string; do_instead?: string }>).find((c) => c.name === "workflows");
    expect(check?.ok).toBe(true);
    expect(check?.warning).toContain(".agents/workflows/tidy.yaml routes stale and unpushed under outcomes: (step ready)");
    expect(check?.warning).toContain(".agents/workflows/shared/hold.yaml routes stale under outcomes: (step ready)");
    expect(check?.do_instead).toBe("in .agents/workflows/tidy.yaml, .agents/workflows/shared/hold.yaml, move stale and unpushed from each waiting step's outcomes: to an on: block beside it");
    expect((await runCli(["doctor"], m.io)).stdout).toContain("— do instead: in .agents/workflows/tidy.yaml");

    const moved = legacy.replace("      reject: work\n      stale: work", "      reject: work\n    on:\n      stale: work");
    await m.files.write(`${DIR}/tidy.yaml`, moved);
    await m.files.write(`${DIR}/shared/hold.yaml`, sharedLegacy.replace("      reject: work\n", "      reject: work\n    on:\n"));
    const again = (json((await runCli(["doctor", "--json"], m.io)).stdout).checks as Array<{ name: string; warning?: string; do_instead?: string }>).find((c) => c.name === "workflows");
    expect(again).not.toHaveProperty("warning");
    expect(again).not.toHaveProperty("do_instead");
  });

  test("a broken repo shared file is named for the pack workflow that loads it", async () => {
    const m = repoWith({ "shared/sync.yaml": "start: sync\nsteps: [unclosed\n" });
    const tick = await runCli(["tick", "--json"], m.io);
    const body = json(tick.stdout);
    expect(body.code).toBe("repo_workflow_invalid");
    expect(body.error).toContain(".agents/workflows/shared/sync.yaml (workflow story)");
  });
});
