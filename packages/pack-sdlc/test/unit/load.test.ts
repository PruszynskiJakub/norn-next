/**
 * Every workflow of the pack loads through the kernel's loader with the step kinds the real plugins
 * provide, the way the runtime loads it: no stub stands in for a step kind, so a route a plugin's
 * outcomes do not cover, or a config key its schema refuses, fails here.
 */
import { describe, expect, test } from "bun:test";
import { DEFAULT_KERNEL_CONFIG, loadWorkflow, type StepKindInfo } from "@norn/kernel";
import { HOST_INPUTS, stepsForgePlugin } from "@norn/runtime";
import { vcsGitPlugin } from "@norn/vcs-git";
import { parse } from "yaml";
import { SDLC_PACK } from "../../src/index.ts";

const STEP_KINDS: Record<string, StepKindInfo> = { ...vcsGitPlugin.provides.stepKinds, ...stepsForgePlugin.provides.stepKinds };
const SHARED = Object.fromEntries(Object.entries(SDLC_PACK.shared).map(([f, text]) => [f.replace(/\.yaml$/, ""), parse(text)]));
const load = (file: string) => loadWorkflow(parse(SDLC_PACK.workflows[file] as string), { stepKinds: STEP_KINDS, sharedFiles: SHARED, config: DEFAULT_KERNEL_CONFIG });

describe("the sdlc pack's workflows", () => {
  test("the real plugins provide every step kind the pack names", () => {
    expect(Object.keys(STEP_KINDS).sort()).toEqual(["await-checks", "await-merge", "integrate", "open-pr", "push", "update-branch", "verify-base"]);
  });

  test.each(Object.keys(SDLC_PACK.workflows))("%s loads with no errors", (file) => {
    const r = load(file);
    expect(r.ok ? [] : r.errors).toEqual([]);
  });

  test("every skill a loaded step names ships in the pack", () => {
    const named = new Set<string>();
    for (const file of Object.keys(SDLC_PACK.workflows)) {
      const r = load(file);
      if (!r.ok) continue;
      for (const step of Object.values(r.workflow.graph.steps)) for (const skill of step.agent?.skills ?? []) named.add(skill);
    }
    expect(named.size).toBeGreaterThan(0);
    expect([...named].filter((s) => !(s in SDLC_PACK.skills))).toEqual([]);
  });

  test.each(Object.keys(SDLC_PACK.workflows))("%s loads against the host's inputs, its flow checked", (file) => {
    const r = loadWorkflow(parse(SDLC_PACK.workflows[file] as string), { stepKinds: STEP_KINDS, sharedFiles: SHARED, config: DEFAULT_KERNEL_CONFIG, inputs: HOST_INPUTS });
    expect(r.ok ? [] : r.errors).toEqual([]);
  });

  test("describe produces the PR body open-pr reads, and open-pr's read stays optional: the light path reaches it without describe", () => {
    for (const file of ["quick.yaml", "story.yaml"]) {
      const r = load(file);
      expect(r.ok && r.workflow.graph.steps.describe?.agent?.produces).toEqual({ pr_body: { file: "pr.md", on: ["done"] } });
    }
    // were the read required, both workflows would be refused on the path that takes a base update after only the base moved
    const required = { ...STEP_KINDS, "open-pr": { ...(STEP_KINDS["open-pr"] as StepKindInfo), reads: ["pr_body"] } };
    const errors = (file: string) => {
      const r = loadWorkflow(parse(SDLC_PACK.workflows[file] as string), { stepKinds: required, sharedFiles: SHARED, config: DEFAULT_KERNEL_CONFIG, inputs: HOST_INPUTS });
      return r.ok ? [] : r.errors.map((e) => e.message);
    };
    expect(errors("quick.yaml")).toEqual([
      "shared/publish.yaml: step 'open-pr' (open-pr) reads `pr_body`, but no step produces it on the path sync.done → implement.done → check.pass → review.approve → update.clean → test-merge.pass → open-pr: give a step on that path produces: pr_body",
    ]);
    expect(errors("story.yaml")).toEqual([
      "shared/publish.yaml: step 'open-pr' (open-pr) reads `pr_body`, but no step produces it on the path sync.done → slice.done → approve-slices.approve → slices.done → update.clean → test-merge.pass → open-pr: give a step on that path produces: pr_body",
    ]);
  });

  test("without the routes the loader needs, the shipped land.yaml fails: the edits are what make it load", () => {
    const shared = { ...SHARED, land: parse(SDLC_PACK.shared["land.yaml"] as string) };
    const merge = shared.land.steps.merge;
    merge.outcomes = { stale: { exit: "stale" } };
    const r = loadWorkflow(parse(SDLC_PACK.workflows["quick.yaml"] as string), { stepKinds: STEP_KINDS, sharedFiles: shared, config: DEFAULT_KERNEL_CONFIG });
    expect(r.ok).toBe(false);
  });
});

type Doc = { start: string; steps: Record<string, Record<string, unknown>>; counters?: Record<string, unknown> };
const written = (file: string) => parse(SDLC_PACK.workflows[file] as string) as Doc;
const sharedDoc = (name: string) => parse(SDLC_PACK.shared[`${name}.yaml`] as string) as Doc;

/** The exits a shared file leaves by, in file order. */
function exitsOf(name: string): string[] {
  const out: string[] = [];
  for (const step of Object.values(sharedDoc(name).steps))
    for (const block of ["outcomes", "on"])
      for (const route of Object.values((step[block] ?? {}) as Record<string, unknown>))
        if (typeof route === "object" && route !== null && "exit" in route && !out.includes(String(route.exit))) out.push(String(route.exit));
  return out;
}

describe("how the pack's workflows bring in their shared files", () => {
  const files = Object.keys(SDLC_PACK.workflows);
  const uses = (file: string) => Object.entries(written(file).steps).filter(([, s]) => "use" in s) as Array<[string, { use: string }]>;

  test("a use step is named after the shared file it brings in, so a route to it reads as the file it enters", () => {
    const misnamed = files.flatMap((file) => uses(file).filter(([step, s]) => step !== s.use).map(([step, s]) => `${file}: ${step} uses ${s.use}`));
    expect(misnamed).toEqual([]);
  });

  test("no exit of a shared file shares its name with a use step of the workflow that routes it", () => {
    const clashing = files.flatMap((file) => {
      const names = uses(file).map(([step]) => step);
      return uses(file).flatMap(([step, s]) => exitsOf(s.use).filter((e) => names.includes(e)).map((e) => `${file}: ${step}.${e}`));
    });
    expect(clashing).toEqual([]);
  });

  test("the base is caught up by the shared catch-up file, which leaves at synced, in every workflow that changes the branch", () => {
    expect(Object.keys(SDLC_PACK.shared).sort()).toEqual(["base-update.yaml", "build.yaml", "catch-up.yaml", "diagnose.yaml", "land.yaml", "publish.yaml"]);
    expect(exitsOf("catch-up")).toEqual(["synced"]);
    for (const file of ["refinement.yaml", "quick.yaml", "story.yaml", "fix.yaml"]) {
      const doc = written(file);
      expect({ file, start: doc.start, step: doc.steps["catch-up"] }).toEqual({ file, start: "catch-up", step: expect.objectContaining({ use: "catch-up" }) });
      // only the shared files merge the base: no workflow writes an update-branch step of its own
      expect({ file, own: Object.entries(doc.steps).filter(([, s]) => s.by === "vcs.update-branch").map(([n]) => n) }).toEqual({ file, own: [] });
    }
  });

  test("the base update leaves at tested, failed, merged or redescribe", () => {
    expect(exitsOf("base-update").sort()).toEqual(["failed", "merged", "redescribe", "tested"]);
  });

  test("the build loop is the shared build file, implement → check → review, which leaves at reviewed; its check is not named test, base-update's step", () => {
    const build = sharedDoc("build");
    expect({ start: build.start, steps: Object.keys(build.steps) }).toEqual({ start: "implement", steps: ["implement", "check", "review"] });
    expect(exitsOf("build")).toEqual(["reviewed"]);
    expect(Object.keys(sharedDoc("base-update").steps)).toContain("test");
  });

  test("slice, quick and story build through the shared build file and write no build step of their own", () => {
    for (const file of ["slice.yaml", "quick.yaml", "story.yaml", "fix.yaml"]) {
      const doc = written(file);
      expect({ file, build: doc.steps.build }).toEqual({ file, build: expect.objectContaining({ use: "build" }) });
      const own = Object.entries(doc.steps).filter(([, s]) => s.by === "builder" && !String(s.do ?? "").includes("merge")).map(([n]) => n);
      expect({ file, own }).toEqual({ file, own: [] });
    }
  });

  test("slice goes build → integrate, a conflict through merge back to integrate", () => {
    const doc = written("slice.yaml");
    expect(doc.start).toBe("build");
    expect(Object.keys(doc.steps)).toEqual(["build", "integrate", "merge"]);
    expect(doc.steps.build?.outcomes).toEqual({ reviewed: "integrate" });
  });

  test("quick goes catch-up → build → base-update → publish → land, and every rework goes back through build", () => {
    const doc = written("quick.yaml");
    expect(Object.keys(doc.steps)).toEqual(["catch-up", "build", "base-update", "publish", "land"]);
    expect(doc.steps["catch-up"]?.outcomes).toEqual({ synced: "build" });
    expect(doc.steps.build?.outcomes).toEqual({ reviewed: "base-update" });
    expect(doc.steps["base-update"]?.outcomes).toEqual({ tested: "publish", failed: "build", merged: "open-pr", redescribe: "publish" });
    expect(doc.steps.publish?.outcomes).toEqual({ passed: "land", failed: { to: "build", max: 3 }, stale: "base-update" });
    expect(doc.steps.land?.outcomes).toEqual({ rejected: "build", stale: "base-update", unpushed: "open-pr" });
  });

  test("story's rework is built, then base-updated before it is tested: no route enters the base update past its start", () => {
    const r = load("story.yaml");
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    const steps = r.workflow.graph.steps;
    expect(steps.review?.routes.approve).toEqual({ to: "update" });
    const base = Object.keys(sharedDoc("base-update").steps);
    const inner = base.filter((s) => s !== sharedDoc("base-update").start);
    const entering = Object.entries(steps).flatMap(([s, step]) =>
      Object.entries(step.routes)
        .filter(([, route]) => inner.includes(route.to) && !base.includes(s))
        .map(([o, route]) => `${s}.${o} → ${route.to}`),
    );
    expect(entering).toEqual([]);
    // every rework, from QA, the person, a failed check or a rejection at ready, starts at implement
    for (const [s, o] of [["qa", "fail"], ["human-qa", "reject"], ["checks", "fail"], ["ready", "reject"], ["test", "fail"]] as const) expect({ at: `${s}.${o}`, to: steps[s]?.routes[o]?.to }).toEqual({ at: `${s}.${o}`, to: "implement" });
  });

  test("fix goes catch-up → diagnose → build → base-update → publish → land; a bug that would not reproduce ends the round, every rework goes back through build", () => {
    const doc = written("fix.yaml");
    expect(doc.start).toBe("catch-up");
    expect(Object.keys(doc.steps)).toEqual(["catch-up", "diagnose", "build", "base-update", "publish", "land"]);
    expect(doc.steps["catch-up"]?.outcomes).toEqual({ synced: "diagnose" });
    expect(doc.steps.diagnose?.outcomes).toEqual({ reproduced: "build", cannot_reproduce: "$done" });
    // past the reproduce step, fix is quick
    for (const step of ["build", "base-update", "publish", "land"]) expect({ step, outcomes: doc.steps[step]?.outcomes }).toEqual({ step, outcomes: written("quick.yaml").steps[step]?.outcomes });
    const signals = (file: string) => {
      const d = parse(SDLC_PACK.workflows[file] as string) as { signals?: unknown; entries?: unknown };
      return { signals: d.signals, entries: d.entries };
    };
    expect(signals("fix.yaml")).toEqual(signals("quick.yaml"));
  });

  test("fix and reproduce run one reproduce step, brought in from the shared diagnose file, which leaves at reproduced or cannot_reproduce", () => {
    expect(exitsOf("diagnose")).toEqual(["reproduced", "cannot_reproduce"]);
    expect(Object.keys(sharedDoc("diagnose").steps)).toEqual(["reproduce"]);
    const reproduce = (file: string) => {
      const r = load(file);
      if (!r.ok) throw new Error(JSON.stringify(r.errors));
      return r.workflow.graph.steps.reproduce;
    };
    expect(reproduce("fix.yaml")?.agent?.instructions).toBeString();
    expect(reproduce("fix.yaml")?.agent).toEqual(reproduce("reproduce.yaml")?.agent as NonNullable<ReturnType<typeof reproduce>>["agent"]);
    expect(written("reproduce.yaml").steps.diagnose?.outcomes).toEqual({ reproduced: "$done", cannot_reproduce: "$done" });
  });

  test("fix stands on the person's ready before the merge: without a person there, it does not load", () => {
    const floored = (sharedFiles: typeof SHARED) => {
      const r = loadWorkflow(parse(SDLC_PACK.workflows["fix.yaml"] as string), { stepKinds: STEP_KINDS, sharedFiles, config: DEFAULT_KERNEL_CONFIG, inputs: HOST_INPUTS, floor: { delegated: [] } });
      return r.ok ? [] : r.errors.map((e) => e.message);
    };
    expect(floored(SHARED)).toEqual([]);
    const land = parse(SDLC_PACK.shared["land.yaml"] as string);
    land.steps.ready = { by: "reviewer", do: "Read the draft PR.", outcomes: { approve: { to: "merge", means: "ready" }, reject: { exit: "rejected", means: "not ready" } } };
    expect(floored({ ...SHARED, land })).toEqual([expect.stringContaining("no `by: person` step on the way")]);
  });

  test("triage ends the round with the outcome that names its recommendation, so the next round is on the record, not only in a note", () => {
    const r = load("triage.yaml");
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    const explore = r.workflow.graph.steps.explore;
    expect(Object.keys(explore?.routes ?? {})).toEqual(["refinement", "quick", "reproduce", "fix", "close"]);
    for (const route of Object.values(explore?.routes ?? {})) expect(route.to).toBe("$done");
    // the skill reports the outcome the comment recommends, one for one
    const skill = SDLC_PACK.skills["norn-triage"]?.["SKILL.md"] ?? "";
    expect(skill).toContain("**Recommend:** <refinement | quick | reproduce | fix | close>");
    expect(skill).toMatch(/norn done <recommendation>/);
  });

  test("implement is told one thing everywhere; what a reproduce round's red loop asks of it is in the norn-implement skill", () => {
    const build = sharedDoc("build");
    const text = String(build.steps.implement?.do);
    expect(text).toMatch(/slice/);
    expect(text).toMatch(/Plan/);
    expect(text).toMatch(/Triage/);
    expect(text).toMatch(/Reproduce/);
    expect(text).toMatch(/findings/);
    const skill = SDLC_PACK.skills["norn-implement"]?.["SKILL.md"] ?? "";
    expect(skill).toMatch(/`## Reproduce`[^\n]*failing test[^\n]*before/);
  });

  test("the resolver that merges the base is told the same before the work and after it", () => {
    const r = load("story.yaml");
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    const before = r.workflow.graph.steps["sync-resolve"]?.agent?.instructions;
    expect(before).toBeString();
    expect(r.workflow.graph.steps.resolve?.agent?.instructions).toBe(before as string);
  });

  test("story and quick declare no counter the kernel derives anyway: their stale routes are bounded alike", () => {
    for (const file of ["quick.yaml", "story.yaml"]) expect({ file, counters: Object.keys(written(file).counters ?? {}) }).toEqual({ file, counters: file === "story.yaml" ? ["qa_loop"] : [] });
    const stale = (file: string) => {
      const r = load(file);
      if (!r.ok) throw new Error(JSON.stringify(r.errors));
      return { publish: r.workflow.graph.counters["publish.stale"], land: r.workflow.graph.counters["land.stale"] };
    };
    expect(stale("story.yaml")).toEqual(stale("quick.yaml"));
    expect(stale("quick.yaml").land).toEqual({ max: DEFAULT_KERNEL_CONFIG.counterDefaults.stale, reset_on: [] });
  });

  test("a workflow file's header says when to use it and what comes next, in a few lines, without restating the pack it ships in", () => {
    const all = { ...Object.fromEntries(files.map((f) => [f, SDLC_PACK.workflows[f] as string])), ...Object.fromEntries(Object.entries(SDLC_PACK.shared).map(([f, t]) => [`shared/${f}`, t])) };
    const long = Object.entries(all).flatMap(([file, text]) => {
      const header = text.split("\n").findIndex((l) => !l.startsWith("#"));
      return header > 4 || /shipped in the sdlc pack/i.test(text) ? [`${file}: ${header} header lines`] : [];
    });
    expect(long).toEqual([]);
  });
});

