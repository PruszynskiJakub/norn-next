/**
 * norn runs on itself: this repo's own team config and workflows load through the same path a
 * command takes, on the plugins the binary bundles, so a change to the kernel's loader or a step
 * kind that breaks them fails here rather than on the first tick in this checkout.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Pack, STEP_KEYS } from "@norn/plugin-api";
import { collectStepKinds, findProvided, loadPackWorkflows, overlayRepoWorkflows } from "@norn/runtime";
import { parse } from "yaml";
import { BUNDLED_PLUGINS, configPaths, ExitCode, REPO_COMMITTED_FILE, runCli } from "../../src/index.ts";
import { fakeGh, HOME, machine, ROOT } from "./support.ts";

const REPO = join(import.meta.dir, "..", "..", "..", "..");
const WORKFLOWS = join(".agents", "workflows");
const SKILLS = join(".agents", "skills");
const PATHS = configPaths(HOME, ROOT);

// git keeps no empty folder, so a repo with no shared file of its own has no shared/ at all
const yamlIn = (dir: string): string[] => (existsSync(join(REPO, dir)) ? readdirSync(join(REPO, dir)).filter((f) => /\.ya?ml$/.test(f)) : []);

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

describe("this repo's workflow files, as written", () => {
  const files = [...yamlIn(WORKFLOWS).map((f) => join(WORKFLOWS, f)), ...yamlIn(join(WORKFLOWS, "shared")).map((f) => join(WORKFLOWS, "shared", f))];
  const written = files.map((file) => ({ file, doc: parse(readFileSync(join(REPO, file), "utf8")) as { steps: Record<string, Record<string, unknown>>; base?: unknown } }));

  test("every step is written in the step form: by:, do: and with:, no older head key or sibling map", () => {
    const keys: readonly string[] = STEP_KEYS;
    const older = written.flatMap(({ file, doc }) =>
      Object.entries(doc.steps).flatMap(([step, body]) => Object.keys(body).filter((k) => !keys.includes(k)).map((k) => `${file}: ${step}.${k}`)),
    );
    expect(older).toEqual([]);
    // a step that brings in a shared file or copies another names no actor of its own
    const actorless = written.flatMap(({ file, doc }) => Object.entries(doc.steps).filter(([, b]) => !("by" in b) && !("use" in b) && !("like" in b)).map(([step]) => `${file}: ${step}`));
    expect(actorless).toEqual([]);
  });

  test("a workflow sets its stale signal under signals: and its entries under entries:, never base:", () => {
    expect(written.filter(({ doc }) => "base" in doc).map(({ file }) => file)).toEqual([]);
  });
});

/** A workflow as written, its shared files flattened in: the doc the loader pins. */
interface WrittenStep {
  [kind: string]: unknown;
  skills?: string[];
  outcomes: Record<string, unknown>;
  on?: Record<string, unknown>;
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

  test("are the pack's six workflows plus release; the repo keeps a copy only of a workflow it changes", () => {
    expect(Object.keys(repo).sort()).toEqual(["quick", "refinement", "release", "reproduce", "slice", "story", "triage"]);
    expect(yamlIn(WORKFLOWS).map((f) => f.replace(/\.ya?ml$/, "")).sort()).toEqual(["release", "reproduce", "triage"]);
    expect(yamlIn(join(WORKFLOWS, "shared"))).toEqual([]);
  });

  test("every skill a workflow names is linked under .claude/skills", () => {
    const named = Object.entries(repo).flatMap(([wf, w]) => Object.values(w.steps).flatMap((s) => (s.skills ?? []).map((skill) => ({ wf, skill }))));
    expect(named.length).toBeGreaterThan(0);
    expect(named.filter(({ skill }) => !existsSync(join(REPO, ".claude", "skills", skill, "SKILL.md")))).toEqual([]);
  });

  test("the test checks of quick, story and slice run the team config's checks.test, the unit tier then the type check, in 15m; the integration tier runs only in CI", () => {
    const config = parse(readFileSync(join(REPO, REPO_COMMITTED_FILE), "utf8")) as { checks?: Record<string, string> };
    expect(config.checks?.test).toBe(UNIT_ONLY);
    const delivery = ["quick", "story", "slice"];
    const checks = delivery.flatMap((wf) => ["check", "test"].filter((s) => steps(wf)[s]).map((s) => ({ wf, s, check: steps(wf)[s]?.check, timeout: steps(wf)[s]?.timeout })));
    expect(checks.map(({ wf, s }) => `${wf}.${s}`)).toEqual(["quick.check", "quick.test", "story.check", "story.test", "slice.check"]);
    expect(checks.filter((c) => c.check !== "{checks.test}" || c.timeout !== "15m")).toEqual([]);
  });

  test("no step of this repo's workflows repeats what AGENTS.md and the brief's rules already tell an agent: the unit tier loop, or the dev build only under $TMPDIR", () => {
    const files = [...yamlIn(WORKFLOWS), ...yamlIn(join(WORKFLOWS, "shared")).map((f) => `shared/${f}`)];
    expect(files.filter((f) => /\$TMPDIR|`bun run test`/.test(readFileSync(join(REPO, WORKFLOWS, f), "utf8")))).toEqual([]);
  });

  test("quick and story wait for the PR's checks after open-pr, send a failed check back to implement and a conflicting PR to update", () => {
    for (const wf of ["quick", "story"]) {
      const s = steps(wf);
      expect({ wf, openPr: s["open-pr"]?.outcomes }).toEqual({ wf, openPr: { done: "checks" } });
      expect({ wf, checks: s.checks?.outcomes }).toEqual({ wf, checks: { pass: "ready", fail: { to: "implement", counter: "publish.failed" }, stale: { to: "update", counter: "publish.stale" } } });
      expect({ wf, bound: repo[wf]?.counters?.["publish.failed"] }).toEqual({ wf, bound: { max: 3 } });
    }
  });

  test("quick, story and release wait for the PR's checks with the forge's await-checks, and no workflow file runs gh or a script of its own", () => {
    for (const wf of ["quick", "story", "release"]) expect({ wf, kind: Object.keys(steps(wf).checks ?? {}) }).toEqual({ wf, kind: expect.arrayContaining(["await-checks"]) });
    const files = [...yamlIn(WORKFLOWS), ...yamlIn(join(WORKFLOWS, "shared")).map((f) => `shared/${f}`)];
    expect(files.filter((f) => /\bgh (pr|run|api)\b|\.agents\/scripts\//.test(readFileSync(join(REPO, WORKFLOWS, f), "utf8")))).toEqual([]);
  });

  test("release goes prepare → open-pr → checks → ready → merge, a failed check goes $stuck, and a base commit or a conflicting PR makes it stale", () => {
    const w = repo.release as Written;
    expect(w.start).toBe("prepare");
    expect(Object.keys(w.steps).sort()).toEqual(["checks", "merge", "open-pr", "prepare", "ready", "resolve", "update"]);
    expect(w.steps.prepare?.skills).toEqual(["release"]);
    expect(w.steps.prepare?.outcomes).toEqual({ done: "open-pr" });
    expect(w.steps["open-pr"]?.outcomes).toEqual({ done: "checks" });
    expect(w.steps.checks?.outcomes).toEqual({ pass: "ready", fail: "$stuck", stale: { to: "update", counter: "checks.stale" } });
    // a signal is routed under `on:`, never among the outcomes a person or a step kind reports
    expect(w.steps.ready?.outcomes).toEqual({ approve: "merge", reject: { to: "prepare", counter: "land.rejected" } });
    expect(w.steps.ready?.on).toEqual({ stale: { to: "update", counter: "land.stale" }, unpushed: expect.objectContaining({ to: "open-pr" }) });
    expect(w.counters?.["land.rejected"]).toEqual({ max: 2 });
    expect(w.steps.merge?.outcomes).toEqual({ merged: "$done" });
    expect(w.steps.merge?.on).toEqual({ stale: { to: "update", counter: "land.stale" }, unpushed: expect.objectContaining({ to: "open-pr" }) });
    expect(w.base).toEqual({ stale: "behind" });
  });

  test("story's and quick's resolve take the base side of each conflict, as the pack's do", () => {
    for (const wf of ["story", "quick"]) expect({ wf, inputs: steps(wf).resolve?.inputs }).toEqual({ wf, inputs: expect.arrayContaining(["base_side"]) });
  });

  test("triage is one norn-triage step whose outcome is its recommendation, each ending the round", () => {
    expect(Object.keys(steps("triage"))).toEqual(["explore"]);
    expect(steps("triage").explore?.skills).toEqual(["norn-triage"]);
    expect(steps("triage").explore?.outcomes).toEqual({ refinement: "$done", quick: "$done", reproduce: "$done", fix: "$done", close: "$done" });
  });

  test("reproduce is one norn-diagnose agent step whose reproduced or cannot_reproduce ends the round", () => {
    expect(repo.reproduce?.start).toBe("reproduce");
    expect(Object.keys(steps("reproduce"))).toEqual(["reproduce"]);
    expect(steps("reproduce").reproduce?.skills).toEqual(["norn-diagnose"]);
    expect(steps("reproduce").reproduce?.outcomes).toEqual({ reproduced: "$done", cannot_reproduce: "$done" });
  });

  test("the repo's copies of the pack's workflows have the same steps, kinds and edges", () => {
    // what a step does is the one key beside these; its text (agent, check, gate), its means and its timeout are the repo's own
    const NOT_KIND = new Set(["outcomes", "on", "skills", "inputs", "means", "timeout", "exits"]);
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
      steps: Object.fromEntries(
        Object.entries(w.steps).map(([s, step]) => [s, { kind: Object.keys(step).filter((k) => !NOT_KIND.has(k)), role: step.role, skills: step.skills, outcomes: bounded(w, step.outcomes), on: step.on && bounded(w, step.on) }]),
      ),
    });
    for (const wf of ["triage", "reproduce"]) expect({ wf, ...shape(repo[wf] as Written) }).toEqual({ wf, ...shape(pack[wf] as Written) });
  });
});
