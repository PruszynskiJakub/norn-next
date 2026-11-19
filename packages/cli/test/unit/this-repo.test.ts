/**
 * norn runs on itself: this repo's own team config and workflows load through the same path a
 * command takes, on the plugins the binary bundles, so a change to the kernel's loader or a step
 * kind that breaks them fails here rather than on the first tick in this checkout.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Pack } from "@norn/plugin-api";
import { collectStepKinds, findProvided, loadPackWorkflows, overlayRepoWorkflows } from "@norn/runtime";
import { parse } from "yaml";
import { BUNDLED_PLUGINS, configPaths, ExitCode, REPO_COMMITTED_FILE, runCli } from "../../src/index.ts";
import { fakeGh, HOME, machine, ROOT } from "./support.ts";

const REPO = join(import.meta.dir, "..", "..", "..", "..");
const WORKFLOWS = join(".agents", "workflows");
const SKILLS = join(".agents", "skills");
const PATHS = configPaths(HOME, ROOT);

const yamlIn = (dir: string): string[] => readdirSync(join(REPO, dir)).filter((f) => /\.ya?ml$/.test(f));

/** Every workflow and shared file of this repo, and its own skills, at the same paths under the test machine's checkout. */
function repoFiles(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const dir of [WORKFLOWS, join(WORKFLOWS, "shared")]) for (const f of yamlIn(dir)) out[join(ROOT, dir, f)] = readFileSync(join(REPO, dir, f), "utf8");
  // norn's copies of the pack skills are never committed; the repo's own are, and its workflows name them
  for (const skill of readdirSync(join(REPO, SKILLS))) {
    const file = join(SKILLS, skill, "SKILL.md");
    if (!skill.startsWith("norn") && existsSync(join(REPO, file))) out[join(ROOT, file)] = readFileSync(join(REPO, file), "utf8");
  }
  return out;
}

/** the tools answer `--version`, the hook line runs, and the checkout has its remote */
const tools = (argv: string[]) => {
  if (argv[1] === "--version" && ["git", "norn", "claude", "gh"].includes(argv[0] as string)) return { stdout: "1.0\n" };
  if (argv[0] === "sh" && argv[1] === "-c" && argv[2]?.startsWith("norn hook ")) return { stdout: "" };
  if (argv.join(" ") === "git remote get-url origin") return { stdout: "git@github.com:acme/app.git\n" };
  return undefined;
};

describe("this repo on the norn it builds", () => {
  test("its team config loads, and every workflow of its .agents/workflows loads with the bundled plugins", async () => {
    const config = readFileSync(join(REPO, REPO_COMMITTED_FILE), "utf8");
    // its github tracker defines the labels doctor asks for on a repository gh answers for
    const gh = fakeGh();
    const m = machine({ seed: { [PATHS.repo]: config, ...repoFiles() }, script: (argv, o) => gh.script(argv, o) ?? tools(argv) });
    const r = await runCli(["doctor", "--json"], m.io);
    const checks = (Bun.JSONL.parse(r.stdout)[0] as { checks: Array<{ name: string; ok: boolean; detail?: string; error?: string }> }).checks;
    const byName = Object.fromEntries(checks.map((c) => [c.name, c]));
    expect(byName.config?.ok).toBe(true);
    expect(byName.slots?.ok).toBe(true);
    expect(byName.workflows?.error).toBeUndefined();
    expect(byName.workflows?.ok).toBe(true);
    const own = yamlIn(WORKFLOWS).map((f) => f.replace(/\.ya?ml$/, "")).sort();
    expect(own).toContain("release");
    expect(byName.workflows?.detail).toContain(`(${own.join(", ")} from .agents/workflows/)`);
    expect(r.exit).toBe(ExitCode.ok);
  });
});

/** A workflow as written, its shared files flattened in: the doc the loader pins. */
interface WrittenStep {
  [kind: string]: unknown;
  skills?: string[];
  outcomes: Record<string, unknown>;
}
interface Written {
  start: string;
  steps: Record<string, WrittenStep>;
  counters?: Record<string, unknown>;
  base?: unknown;
}

/** The bundled pack's workflows and this repo's laid over them, each loaded as a command loads it. */
function loadAll(): { repo: Record<string, Written>; pack: Record<string, Written> } {
  const kinds = collectStepKinds(BUNDLED_PLUGINS);
  const pack = findProvided<Pack>(BUNDLED_PLUGINS, "packs", "sdlc");
  if (!kinds.ok || !pack.ok) throw new Error("the bundled plugins give no step kinds or no sdlc pack");
  const read = (dir: string) => Object.fromEntries(yamlIn(dir).map((f) => [f, readFileSync(join(REPO, dir, f), "utf8")]));
  const docs = (p: Pack): Record<string, Written> => {
    const loaded = loadPackWorkflows(p, kinds.value);
    if (!loaded.ok) throw new Error(loaded.failure.message);
    return Object.fromEntries(
      Object.entries(loaded.value).map(([name, w]) => {
        if (!w.ok) throw new Error(`${name} does not load: ${JSON.stringify(w.errors)}`);
        return [name, w.workflow.pinned.doc as unknown as Written];
      }),
    );
  };
  return { repo: docs(overlayRepoWorkflows(pack.value, { workflows: read(WORKFLOWS), shared: read(join(WORKFLOWS, "shared")) })), pack: docs(pack.value) };
}

describe("this repo's workflows, as norn loads them", () => {
  const { repo, pack } = loadAll();
  const steps = (wf: string) => (repo[wf] as Written).steps;
  const UNIT_ONLY = "bun install --frozen-lockfile && bun run test && bun run typecheck";

  test("the team config names triage as the default workflow", () => {
    const config = parse(readFileSync(join(REPO, REPO_COMMITTED_FILE), "utf8")) as { kernel?: { workflow?: string } };
    expect(config.kernel?.workflow).toBe("triage");
  });

  test("are the pack's six workflows plus release", () => {
    expect(Object.keys(repo).sort()).toEqual(["quick", "refinement", "release", "reproduce", "slice", "story", "triage"]);
    expect(yamlIn(WORKFLOWS).map((f) => f.replace(/\.ya?ml$/, "")).sort()).toEqual(Object.keys(repo).sort());
  });

  test("every skill a workflow names is linked under .claude/skills", () => {
    const named = Object.entries(repo).flatMap(([wf, w]) => Object.values(w.steps).flatMap((s) => (s.skills ?? []).map((skill) => ({ wf, skill }))));
    expect(named.length).toBeGreaterThan(0);
    expect(named.filter(({ skill }) => !existsSync(join(REPO, ".claude", "skills", skill, "SKILL.md")))).toEqual([]);
  });

  test("the test check of quick, story and slice runs the unit tier, then the type check, in 15m; the integration tier runs only in CI", () => {
    const delivery = ["quick", "story", "slice"];
    const checks = delivery.map((wf) => ({ wf, check: steps(wf).test?.check, timeout: steps(wf).test?.timeout }));
    expect(checks).toEqual(delivery.map((wf) => ({ wf, check: UNIT_ONLY, timeout: "15m" })));
  });

  test("the implement step of quick names bun run test as the loop after each change", () => {
    expect(steps("quick").implement?.agent).toMatch(/`bun run test`[^.]*after each change/);
  });

  test("quick and story wait for the PR's CI after open-pr, send a red run back to implement and a conflicting PR to update", () => {
    for (const wf of ["quick", "story"]) {
      const s = steps(wf);
      expect({ wf, openPr: s["open-pr"]?.outcomes }).toEqual({ wf, openPr: { done: "ci" } });
      expect({ wf, ci: s.ci?.outcomes }).toEqual({ wf, ci: { pass: "ready", fail: { to: "implement", counter: "ship.failed" }, stale: { to: "update", counter: "stale_loop" } } });
      expect({ wf, bound: repo[wf]?.counters?.["ship.failed"] }).toEqual({ wf, bound: { max: 3 } });
    }
  });

  test("quick, story and release run the same ci script, which waits with gh run watch, written once in shared/ci.yaml", () => {
    const ci = (wf: string) => steps(wf).ci?.check;
    expect(ci("quick")).toContain("gh run watch");
    expect([ci("story"), ci("release")]).toEqual([ci("quick"), ci("quick")]);
    const files = [...yamlIn(WORKFLOWS), ...yamlIn(join(WORKFLOWS, "shared")).map((f) => `shared/${f}`)];
    expect(files.filter((f) => readFileSync(join(REPO, WORKFLOWS, f), "utf8").includes("gh run watch"))).toEqual(["shared/ci.yaml"]);
  });

  test("release goes prepare → open-pr → ci → ready → merge, a red CI goes $stuck, and a base commit or a conflicting PR makes it stale", () => {
    const w = repo.release as Written;
    expect(w.start).toBe("prepare");
    expect(Object.keys(w.steps).sort()).toEqual(["ci", "merge", "open-pr", "prepare", "ready", "resolve", "update"]);
    expect(w.steps.prepare?.skills).toEqual(["release"]);
    expect(w.steps.prepare?.outcomes).toEqual({ done: "open-pr" });
    expect(w.steps["open-pr"]?.outcomes).toEqual({ done: "ci" });
    expect(w.steps.ci?.outcomes).toEqual({ pass: "ready", fail: "$stuck", stale: { to: "update", counter: "stale_loop" } });
    expect(w.steps.ready?.outcomes).toMatchObject({ approve: "merge", reject: { to: "prepare", counter: "ready.reject" }, stale: { to: "update", counter: "stale_loop" } });
    expect(w.counters?.["ready.reject"]).toEqual({ max: 2 });
    expect(w.steps.merge?.outcomes).toMatchObject({ merged: "$done", stale: { to: "update", counter: "stale_loop" } });
    expect(w.base).toEqual({ stale: "behind" });
  });

  test("story's and quick's resolve take the base side of each conflict, as the pack's do", () => {
    for (const wf of ["story", "quick"]) expect({ wf, inputs: steps(wf).resolve?.inputs }).toEqual({ wf, inputs: expect.arrayContaining(["base_side"]) });
  });

  test("triage is one norn-triage step that ends the round with done: the recommendation is only in its comment", () => {
    expect(Object.keys(steps("triage"))).toEqual(["explore"]);
    expect(steps("triage").explore?.skills).toEqual(["norn-triage"]);
    expect(steps("triage").explore?.outcomes).toEqual({ done: "$done" });
  });

  test("reproduce is one norn-diagnose agent step whose reproduced or cannot_reproduce ends the round", () => {
    expect(repo.reproduce?.start).toBe("reproduce");
    expect(Object.keys(steps("reproduce"))).toEqual(["reproduce"]);
    expect(steps("reproduce").reproduce?.skills).toEqual(["norn-diagnose"]);
    expect(steps("reproduce").reproduce?.outcomes).toEqual({ reproduced: "$done", cannot_reproduce: "$done" });
  });

  test("quick's implement turns a red loop from reproduce into a failing test first", () => {
    expect(steps("quick").implement?.agent).toContain("## Reproduce");
  });

  test("the repo's copies of the pack's workflows have the same steps, kinds and edges", () => {
    // what a step does is the one key beside these; its text (agent, check, gate) is the repo's own
    const NOT_KIND = new Set(["outcomes", "skills", "inputs", "means", "hand_back", "timeout", "exits"]);
    // a counter's name follows the exit its edge leaves by, and the copies name their exits apart: compare its bound
    const bounded = (w: Written, outcomes: Record<string, unknown>) =>
      Object.fromEntries(
        Object.entries(outcomes).map(([o, e]) => {
          if (typeof e !== "object" || e === null || !("counter" in e)) return [o, e];
          const { counter, ...rest } = e as { counter: string };
          return [o, { ...rest, bound: w.counters?.[counter] }];
        }),
      );
    const shape = (w: Written) => ({
      start: w.start,
      steps: Object.fromEntries(Object.entries(w.steps).map(([s, step]) => [s, { kind: Object.keys(step).filter((k) => !NOT_KIND.has(k)), skills: step.skills, outcomes: bounded(w, step.outcomes) }])),
    });
    for (const wf of ["triage", "reproduce", "refinement", "story", "slice", "quick"]) expect({ wf, ...shape(repo[wf] as Written) }).toEqual({ wf, ...shape(pack[wf] as Written) });
  });
});
