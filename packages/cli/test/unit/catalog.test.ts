/**
 * The catalog commands: `norn workflow list`, `norn workflow show` and `norn skill list` show what a
 * repo can start and which skills its agents can use, overrides included; they only read, and outside
 * a norn repo they show the pack alone.
 */
import { describe, expect, test } from "bun:test";
import type { LoadedWorkflow } from "@norn/kernel";
import { SDLC_PACK } from "@norn/pack-sdlc";
import { validate } from "@norn/schema";
import { parse } from "yaml";
import { shippedWorkflows } from "../../scripts/docs-emit.ts";
import { configPaths, ExitCode, runCli } from "../../src/index.ts";
import { workflowMermaid } from "../../src/workflows-page.ts";
import { HOME, LOCAL_CONFIG, machine, ROOT } from "./support.ts";

const PATHS = configPaths(HOME, ROOT);
const DIR = `${ROOT}/.agents/workflows`;
const json = (stdout: string): Record<string, unknown> => Bun.JSONL.parse(stdout)[0] as Record<string, unknown>;
const CONFIG = LOCAL_CONFIG.replace("  intake: { label: norn }", "  intake: { label: norn }\n  user: me@box");
const tools = (argv: string[]) => (argv[1] === "--version" && ["git", "norn", "claude"].includes(argv[0] as string) ? { stdout: "1.0\n" } : undefined);

/** the pack's quick, said differently and with a wider publish limit: a repo copy no person need confirm */
const QUICK = (SDLC_PACK.workflows["quick.yaml"] as string)
  .replace(/^description: .*$/m, "description: When the repo says so.")
  .replace("failed: { to: build, max: 3 }", "failed: { to: build, max: 5 }");
const TIDY = ["name: tidy", "description: For tidying up.", "start: work", "steps:", "  work:", "    agent: Do the work.", "    skills: [house-style, deploy-notes, nowhere-skill]", "    outcomes: { done: $done }", ""].join("\n");
/** a repo's own workflow with a person's step: held until the person confirms it */
const OWN = ["name: own", "start: work", "steps:", "  work:", "    by: builder", "    do: Do the work.", "    outcomes: { done: ready }", "  ready:", "    by: person", "    do: Approve it.", "    outcomes: { approve: $done, reject: { to: work, max: 2 } }", ""].join("\n");
const HOUSE = "---\nname: house-style\ndescription: The house rules for code here. Use when writing or reviewing code in this repo.\n---\nRules.\n";
const DEPLOY = "---\nname: deploy-notes\ndescription: How a deploy goes. Use for anything about deploying.\n---\nNotes.\n";

function repo() {
  return machine({
    seed: {
      [PATHS.local]: CONFIG,
      [`${DIR}/quick.yaml`]: QUICK,
      [`${DIR}/tidy.yaml`]: TIDY,
      [`${DIR}/own.yaml`]: OWN,
      [`${ROOT}/.agents/skills/house-style/SKILL.md`]: HOUSE,
      [`${ROOT}/.claude/skills/deploy-notes/SKILL.md`]: DEPLOY,
    },
    script: tools,
  });
}
const outside = () => machine({ common: null, cwd: "/work/elsewhere" });

const packDescription = (file: string): string => ((parse(SDLC_PACK.workflows[file] as string) as { description: string }).description as string).trim();
const valid = (schema: "workflow-list" | "workflow-show" | "skill-list", value: unknown) => {
  const r = validate(schema, value);
  return r.ok ? true : r.errors;
};

type Entry = { name: string; description: string | null; source: string; state: string; changes?: string[]; confirm?: string; file: string | null };

describe("norn workflow list", () => {
  test("every startable workflow with its description, marked pack, repo or replaces pack, the held one with what it needs", async () => {
    const m = repo();
    const run = await runCli(["workflow", "list", "--json"], m.io);
    expect(run.exit).toBe(ExitCode.ok);
    const body = json(run.stdout);
    expect(valid("workflow-list", body)).toBe(true);
    expect(body.repo).toBe(ROOT);
    const byName = Object.fromEntries((body.workflows as Entry[]).map((w) => [w.name, w]));
    for (const file of Object.keys(SDLC_PACK.workflows)) expect(byName[file.replace(".yaml", "")]).toBeDefined();
    expect(byName.story).toMatchObject({ source: "pack", state: "ok", description: packDescription("story.yaml"), file: null });
    expect(byName.quick).toMatchObject({ source: "replaces-pack", state: "ok", description: "When the repo says so.", file: ".agents/workflows/quick.yaml" });
    expect(byName.tidy).toMatchObject({ source: "repo", state: "ok", description: "For tidying up.", file: ".agents/workflows/tidy.yaml" });
    expect(byName.own).toMatchObject({ source: "repo", state: "held", confirm: "norn workflow confirm own" });
    expect(byName.own?.changes?.length).toBeGreaterThan(0);

    const md = (await runCli(["workflow", "list"], m.io)).stdout;
    expect(md).toContain("When the repo says so.");
    expect(md).toMatch(/quick.*replaces pack/);
    expect(md).toMatch(/tidy.*repo/);
    expect(md).toMatch(/own.*held.*norn workflow confirm own/);
  });
});

describe("norn workflow show", () => {
  test("the override's resolved steps, outcomes and where they lead, counters with their maximums, gates and skills", async () => {
    const m = repo();
    const run = await runCli(["workflow", "show", "quick", "--json"], m.io);
    expect(run.exit).toBe(ExitCode.ok);
    const body = json(run.stdout) as { steps: Array<{ name: string; kind: string; skills: string[]; outcomes: Array<{ outcome: string; to: string; counter: string | null }> }>; counters: Array<{ name: string; max: number }>; gates: string[] } & Record<string, unknown>;
    expect(valid("workflow-show", body)).toBe(true);
    expect(body).toMatchObject({ name: "quick", source: "replaces-pack", state: "ok", description: "When the repo says so." });
    expect(body).not.toHaveProperty("when");
    expect(body.steps.map((s) => s.name)).toContain(body.start as string);
    // the shared files' steps are resolved in, not left as `use:`
    expect(body.steps.map((s) => s.name)).not.toContain("build");
    const widened = body.steps.flatMap((s) => s.outcomes.filter((o) => o.counter !== null && body.counters.find((c) => c.name === o.counter)?.max === 5));
    expect(widened.length).toBeGreaterThan(0);
    expect(body.steps.some((s) => s.skills.length > 0)).toBe(true);
    expect(body.gates).toEqual(body.steps.filter((s) => s.kind === "gate").map((s) => s.name));

    const md = (await runCli(["workflow", "show", "quick"], m.io)).stdout;
    expect(md).toContain("When the repo says so.");
    expect(md).toContain("≤5");
    const skilled = body.steps.find((s) => s.skills.length > 0);
    expect(md).toContain(skilled?.skills[0] as string);
  });

  test("--mermaid prints a repo workflow's graph as docs/workflows.md draws it", async () => {
    const m = repo();
    const run = await runCli(["workflow", "show", "tidy", "--mermaid"], m.io);
    expect(run.exit).toBe(ExitCode.ok);
    expect(run.stdout.split("\n")[1]).toBe("flowchart LR");
    expect(run.stdout).toContain("s_work");
    expect((await runCli(["workflow", "show", "tidy", "--mermaid", "--json"], m.io)).exit).toBe(ExitCode.usage);
  });

  test("--mermaid on a pack workflow outside a repo is the graph docs/workflows.md draws", async () => {
    const run = await runCli(["workflow", "show", "story", "--mermaid"], outside().io);
    expect(run.exit).toBe(ExitCode.ok);
    expect(run.stdout).toBe(`${workflowMermaid(shippedWorkflows(SDLC_PACK).story as LoadedWorkflow)}\n`);
  });

  test("a mistyped name is refused with the valid workflows, as story create refuses it", async () => {
    const m = repo();
    const shown = await runCli(["workflow", "show", "nope", "--json"], m.io);
    expect(shown.exit).toBe(ExitCode.refused);
    const body = json(shown.stdout);
    expect(body.code).toBe("unknown_workflow");
    for (const name of ["story", "quick", "tidy"]) expect(String(body.do_instead)).toContain(name);

    const created = await runCli(["story", "create", "x", "--workflow", "nope", "--json"], m.io);
    expect(created.exit).toBe(ExitCode.refused);
    const refusal = json(created.stdout);
    expect(refusal.code).toBe("unknown_workflow");
    for (const name of ["story", "quick", "tidy"]) expect(String(refusal.do_instead)).toContain(name);

    const away = await runCli(["workflow", "show", "nope", "--json"], outside().io);
    expect(away.exit).toBe(ExitCode.refused);
    expect(String(json(away.stdout).do_instead)).toContain("story");
  });

  test("a name an object inherits (__proto__, constructor, toString) is refused as unknown, never read as a workflow", async () => {
    for (const name of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
      const shown = await runCli(["workflow", "show", name, "--json"], repo().io);
      expect(shown.exit).toBe(ExitCode.refused);
      expect(json(shown.stdout).code).toBe("unknown_workflow");
      const away = await runCli(["workflow", "show", name, "--json"], outside().io);
      expect(away.exit).toBe(ExitCode.refused);
      expect(json(away.stdout).code).toBe("unknown_workflow");
    }
  });
});

describe("norn skill list", () => {
  test("pack, repo and harness-folder skills, each with its Use when clause and where it comes from; doctor's unseen-skill warning agrees", async () => {
    const m = repo();
    const run = await runCli(["skill", "list", "--json"], m.io);
    expect(run.exit).toBe(ExitCode.ok);
    const body = json(run.stdout) as { skills: Array<{ name: string; source: string; use_when: string | null; description: string | null; path: string | null; harness?: string }> } & Record<string, unknown>;
    expect(valid("skill-list", body)).toBe(true);
    const byName = Object.fromEntries(body.skills.map((s) => [s.name, s]));
    for (const skill of Object.keys(SDLC_PACK.skills)) expect(byName[skill]?.source).toBe("pack");
    expect(byName["norn-implement"]?.use_when).toStartWith("Use when");
    expect(byName["house-style"]).toEqual({ name: "house-style", source: "repo", use_when: "Use when writing or reviewing code in this repo.", description: "The house rules for code here. Use when writing or reviewing code in this repo.", path: ".agents/skills/house-style" });
    expect(byName["deploy-notes"]).toMatchObject({ source: "harness", harness: "claude", use_when: "Use for anything about deploying.", path: ".claude/skills/deploy-notes" });

    const md = (await runCli(["skill", "list"], m.io)).stdout;
    expect(md).toContain("house-style");
    expect(md).toContain("Use for anything about deploying.");

    const doctor = json((await runCli(["doctor", "--json"], m.io)).stdout);
    const warning = String((doctor.checks as Array<{ name: string; warning?: string }>).find((c) => c.name === "workflows")?.warning);
    expect(warning).toContain("nowhere-skill");
    for (const s of body.skills) expect(warning).not.toContain(`${s.name} (step`);
  });
});

describe("the catalog commands only read", () => {
  test("no file in the repo, the config or the run state changes", async () => {
    const m = repo();
    expect((await runCli(["status", "--json"], m.io)).exit).toBe(ExitCode.ok);
    const before = m.files.snapshot();
    m.files.failWrites(true);
    for (const argv of [["workflow", "list"], ["workflow", "list", "--json"], ["workflow", "show", "quick"], ["workflow", "show", "own", "--json"], ["workflow", "show", "tidy", "--mermaid"], ["skill", "list"], ["skill", "list", "--json"]])
      expect({ argv, exit: (await runCli(argv, m.io)).exit }).toEqual({ argv, exit: ExitCode.ok });
    m.files.failWrites(false);
    expect(m.files.snapshot()).toEqual(before);
  });
});

describe("outside a norn repo", () => {
  test("each command shows the pack alone, says no repo overrides were read, and is not refused", async () => {
    for (const m of [outside(), machine({ script: tools })]) {
      const list = await runCli(["workflow", "list", "--json"], m.io);
      expect(list.exit).toBe(ExitCode.ok);
      const body = json(list.stdout);
      expect(valid("workflow-list", body)).toBe(true);
      expect(body.repo).toBeNull();
      expect((body.workflows as Entry[]).map((w) => w.name).sort()).toEqual(Object.keys(SDLC_PACK.workflows).map((f) => f.replace(".yaml", "")).sort());
      expect((body.workflows as Entry[]).every((w) => w.source === "pack")).toBe(true);
      expect((await runCli(["workflow", "list"], m.io)).stdout).toContain("no repo overrides were read");

      const show = await runCli(["workflow", "show", "story", "--json"], m.io);
      expect(show.exit).toBe(ExitCode.ok);
      expect(valid("workflow-show", json(show.stdout))).toBe(true);
      expect(json(show.stdout).repo).toBeNull();
      expect((await runCli(["workflow", "show", "story"], m.io)).stdout).toContain("no repo overrides were read");

      const skills = await runCli(["skill", "list", "--json"], m.io);
      expect(skills.exit).toBe(ExitCode.ok);
      const sk = json(skills.stdout) as { repo: unknown; skills: Array<{ name: string; source: string }> };
      expect(valid("skill-list", sk)).toBe(true);
      expect(sk.repo).toBeNull();
      expect(sk.skills.map((s) => s.name).sort()).toEqual(Object.keys(SDLC_PACK.skills).sort());
      expect((await runCli(["skill", "list"], m.io)).stdout).toContain("no repo overrides were read");
    }
  });
});
