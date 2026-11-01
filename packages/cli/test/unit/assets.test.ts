/** Content installed by `norn init`: workflow templates (§11), skills (§16), repo config template (K2). */
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, type Workflow, outcomeEdge, resolveConfig, validate } from "@norn/schema";
import { parse } from "yaml";
import { type AssetsSources, assetsDir, resolveAssetsDir } from "../../src/runtime/assets.ts";

const ASSETS = join(import.meta.dir, "..", "..", "assets");
const SKILLS_DIR = join(ASSETS, "skills");
const WORKFLOWS_DIR = join(ASSETS, "workflows");

/** The skills of §16: the protocol skill, the step skills, their reference skills and the retro a person runs. */
const SKILLS = [
  "norn",
  "norn-interview",
  "norn-refine",
  "norn-clarify",
  "norn-plan",
  "norn-slice",
  "norn-implement",
  "norn-review",
  "norn-qa",
  "norn-qa-person",
  "norn-diagnose",
  "norn-triage",
  "norn-merge",
  "norn-pr",
  "norn-tdd",
  "norn-codebase-design",
  "norn-prototype",
  "norn-retro",
];
const CRAFT = SKILLS.filter((s) => s !== "norn");

const readSkill = (name: string) => readFileSync(join(SKILLS_DIR, name, "SKILL.md"), "utf8");
const workflowFiles = readdirSync(WORKFLOWS_DIR).filter((f) => /\.(ya?ml|json)$/.test(f));
const loadWorkflow = (f: string) => parse(readFileSync(join(WORKFLOWS_DIR, f), "utf8")) as Workflow;

/** Splits a SKILL.md into its YAML frontmatter and body. */
function splitSkill(text: string): { meta: Record<string, unknown>; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!m) throw new Error("SKILL.md has no frontmatter");
  return { meta: parse(m[1] as string) as Record<string, unknown>, body: m[2] as string };
}

/** Text outside fenced and inline code, for prose-only lints. */
const prose = (text: string) => text.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");

/** Steps that can reach `$done` (W5), walking declared edges backwards. */
function stepsReachingDone(wf: Workflow): Set<string> {
  const reach = new Set<string>(["$done"]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [name, step] of Object.entries(wf.steps)) {
      if (reach.has(name)) continue;
      const targets = Object.values(step.outcomes as Record<string, Parameters<typeof outcomeEdge>[0]>).map((o) => outcomeEdge(o).to);
      if (targets.some((t) => reach.has(t))) {
        reach.add(name);
        grew = true;
      }
    }
  }
  return reach;
}

/**
 * Every elementary cycle has a counted edge (W4) ⇔ the graph without counted edges is acyclic.
 * Returns one uncounted cycle path, or null.
 */
function uncountedCycle(wf: Workflow): string[] | null {
  const next = (name: string) =>
    Object.values((wf.steps[name]?.outcomes ?? {}) as Record<string, Parameters<typeof outcomeEdge>[0]>)
      .map(outcomeEdge)
      .filter((e) => !e.counter && !e.to.startsWith("$"))
      .map((e) => e.to);
  const color = new Map<string, "grey" | "black">();
  const path: string[] = [];
  const dfs = (n: string): string[] | null => {
    color.set(n, "grey");
    path.push(n);
    for (const m of next(n)) {
      if (color.get(m) === "grey") return [...path.slice(path.indexOf(m)), m];
      if (!color.has(m)) {
        const c = dfs(m);
        if (c) return c;
      }
    }
    path.pop();
    color.set(n, "black");
    return null;
  };
  for (const n of Object.keys(wf.steps)) if (!color.has(n)) {
    const c = dfs(n);
    if (c) return c;
  }
  return null;
}

describe("workflow templates", () => {
  test("triage, reproduce, refinement, story, slice and quick are shipped", () => {
    expect(workflowFiles.sort()).toEqual(["quick.yaml", "refinement.yaml", "reproduce.yaml", "slice.yaml", "story.yaml", "triage.yaml"]);
  });

  describe.each(workflowFiles)("%s", (file) => {
    const wf = loadWorkflow(file);

    test("validates against the workflow schema", () => {
      const r = validate("workflow", wf);
      expect(r.ok ? [] : r.errors).toEqual([]);
    });

    test("name matches the file name", () => {
      expect(wf.name).toBe(file.replace(/\.(ya?ml|json)$/, ""));
    });

    test("start and every target name an existing step", () => {
      expect(Object.keys(wf.steps)).toContain(wf.start);
      for (const step of Object.values(wf.steps))
        for (const o of Object.values(step.outcomes as Record<string, Parameters<typeof outcomeEdge>[0]>)) {
          const to = outcomeEdge(o).to;
          if (!to.startsWith("$")) expect(Object.keys(wf.steps)).toContain(to);
        }
    });

    test("every step can reach $done (W5)", () => {
      const reach = stepsReachingDone(wf);
      expect(Object.keys(wf.steps).filter((s) => !reach.has(s))).toEqual([]);
    });

    test("every cycle has a counter, and every counter is declared and used (W4)", () => {
      expect(uncountedCycle(wf)).toBeNull();
      const used = new Set<string>();
      for (const step of Object.values(wf.steps))
        for (const o of Object.values(step.outcomes as Record<string, Parameters<typeof outcomeEdge>[0]>)) {
          const c = outcomeEdge(o).counter;
          if (c) used.add(c);
        }
      expect([...used].sort()).toEqual(Object.keys(wf.counters ?? {}).sort());
    });

    test("agent outcomes routed to a step carry `means` text (B3)", () => {
      const missing: string[] = [];
      for (const [name, step] of Object.entries(wf.steps)) {
        if (step.type !== "agent") continue;
        for (const [o, spec] of Object.entries(step.outcomes)) if (!outcomeEdge(spec).means) missing.push(`${name}.${o}`);
      }
      expect(missing).toEqual([]);
    });

    test("every referenced skill exists in assets/skills (W5)", () => {
      for (const step of Object.values(wf.steps))
        if (step.type === "agent") expect({ skill: step.skill, exists: existsSync(join(SKILLS_DIR, step.skill, "SKILL.md")) }).toEqual({ skill: step.skill, exists: true });
    });

    // TODO: core's validator exists in packages/core/src/workflow.ts but is not yet exported from
    // @norn/core. Once it is, also assert:
    //   validateWorkflowDefinition(wf, { skills: SKILLS }).issues → []            (W4, W5)
    //   checkWorkflowLevel(wf, file === "story.yaml" ? "story" : "slice") → []   (W8)
  });
});

describe("single-purpose workflows (W1, #136)", () => {
  const wf = (name: string) => loadWorkflow(`${name}.yaml`);
  const targets = (name: string, step: string) =>
    Object.fromEntries(Object.entries(wf(name).steps[step]?.outcomes ?? {}).map(([o, e]) => [o, outcomeEdge(e as Parameters<typeof outcomeEdge>[0]).to]));
  const types = (name: string) => Object.fromEntries(Object.entries(wf(name).steps).map(([s, step]) => [s, step.type]));

  test("triage is the default story workflow and slice the default slice workflow (W9)", () => {
    expect([DEFAULT_CONFIG.default_workflow, DEFAULT_CONFIG.default_slice_workflow]).toEqual(["triage", "slice"]);
  });

  test("triage is one norn-triage step that ends the round with done: the recommendation is only in its comment", () => {
    expect(wf("triage").start).toBe("explore");
    expect(Object.keys(wf("triage").steps)).toEqual(["explore"]);
    expect(wf("triage").steps.explore).toMatchObject({ type: "agent", skill: "norn-triage" });
    expect(targets("triage", "explore")).toEqual({ done: "$done" });
  });

  test("reproduce is one norn-diagnose step that changes no code and ends the round either way", () => {
    expect(Object.keys(wf("reproduce").steps)).toEqual(["reproduce"]);
    expect(wf("reproduce").steps.reproduce).toMatchObject({ type: "agent", skill: "norn-diagnose" });
    expect(targets("reproduce", "reproduce")).toEqual({ reproduced: "$done", cannot_reproduce: "$done" });
  });

  test("refinement syncs, then refines and plans with a person, and cuts no slices", () => {
    expect(wf("refinement").start).toBe("sync");
    expect(types("refinement")).toEqual({ sync: "git", "sync-resolve": "agent", refine: "agent", clarify: "agent", plan: "agent" });
    for (const s of ["refine", "clarify", "plan"]) expect(wf("refinement").steps[s]).toMatchObject({ attended: true });
    expect(targets("refinement", "plan")).toEqual({ done: "$done" });
  });

  test("story syncs before it slices, a plan that no longer holds goes $stuck, and it ends at ready after CI", () => {
    expect(wf("story").start).toBe("sync");
    expect(targets("story", "sync")).toEqual({ done: "slice", conflict: "sync-resolve" });
    expect(targets("story", "slice")).toEqual({ done: "approve-slices", replan: "$stuck" });
    expect(targets("story", "approve-slices")).toEqual({ approve: "slices", reject: "slice" });
    expect(Object.keys(wf("story").steps)).not.toContain("refine");
    expect(targets("story", "open-pr")).toEqual({ done: "ci" });
    expect(targets("story", "ci")).toEqual({ pass: "ready", fail: "implement" });
  });

  test("slice has no QA: implement, test, review, integrate", () => {
    expect(types("slice")).toEqual({ implement: "agent", test: "check", review: "agent", integrate: "git", merge: "agent" });
    expect(targets("slice", "review")).toEqual({ approve: "integrate", changes_requested: "implement" });
  });

  test("quick syncs, then implements, and ends at ready after CI", () => {
    expect(wf("quick").start).toBe("sync");
    expect(targets("quick", "sync")).toEqual({ done: "implement", conflict: "sync-resolve" });
    expect(targets("quick", "open-pr")).toEqual({ done: "ci" });
    expect(targets("quick", "ci")).toEqual({ pass: "ready", fail: "implement" });
  });

  test("story and quick wait for CI with the same script, and update-branch re-enters update (BS9)", () => {
    const run = (name: string) => (wf(name).steps.ci as { run?: string }).run;
    expect(run("story")).toContain("gh pr checks");
    expect(run("quick")).toBe(run("story"));
    for (const name of ["story", "quick"]) expect(wf(name).base).toEqual({ stale: "conflict", step: "update" });
  });
});

describe("skills", () => {
  test("exactly the skills of §16 are shipped", () => {
    expect(readdirSync(SKILLS_DIR).sort()).toEqual([...SKILLS].sort());
  });

  test.each(SKILLS)("%s has frontmatter with matching name and a description", (name) => {
    const { meta, body } = splitSkill(readSkill(name));
    expect(meta.name).toBe(name);
    expect(typeof meta.description).toBe("string");
    expect((meta.description as string).length).toBeGreaterThan(40);
    expect(body.trim().length).toBeGreaterThan(0);
  });

  test("the norn skill stays under 80 lines (SK2)", () => {
    expect(readSkill("norn").split("\n").length).toBeLessThanOrEqual(80);
  });

  test("the norn skill names no step of any template (SK2)", () => {
    const text = readSkill("norn");
    const reserved = new Set(["test", "slice", "slices", "plan", "ready"]); // glossary nouns / plain words
    const names = new Set(workflowFiles.flatMap((f) => Object.keys(loadWorkflow(f).steps)).filter((n) => !reserved.has(n)));
    expect([...names].filter((n) => new RegExp(`\\b${n}\\b`, "i").test(text))).toEqual([]);
  });

  test("the norn skill states the protocol and hard rules", () => {
    const text = readSkill("norn");
    for (const s of ["norn brief", "norn done", "norn ask", "norn stuck", "--handoff", "Do instead", "handoff.md", "Goal", "Progress", "Resume", "git push", "runs/", "gh", "glab"])
      expect(text).toContain(s);
  });

  test.each(CRAFT)("%s is unaware of norn (P7)", (name) => {
    // skill names carry the `norn-` prefix (SK1); any other mention of norn is a leak
    const text = readSkill(name).replace(/\bnorn-[a-z-]+/g, "");
    expect(text).not.toMatch(/norn/i);
    expect(prose(text)).not.toMatch(/\b(workflows?|receipts?|outcomes?|steps?|brief)\b/i);
  });

  test.each(SKILLS)("%s links only to files that exist (whole skill folders, SK1)", (name) => {
    const links = [...readSkill(name).matchAll(/\]\(([^)#\s]+\.md)\)/g)].map((m) => m[1] as string).filter((l) => !/^[a-z]+:/.test(l));
    expect(links.filter((l) => !existsSync(join(SKILLS_DIR, name, l)))).toEqual([]);
  });

  /** Banned synonyms (§5), same set as test/repo/repo.test.ts lints in sources. */
  const BANNED: Array<[RegExp, string]> = [
    [/\b(task|tasks|job|jobs|ticket|tickets)\b/i, "story / slice"],
    [/\binteractive step/i, "attended step"],
    [/\bapproved\b/i, "approve"],
  ];
  test.each(SKILLS)("%s uses no banned glossary synonyms (§5)", (name) => {
    const hits: string[] = [];
    readSkill(name)
      .split("\n")
      .forEach((line, i) => {
        for (const [re, say] of BANNED) if (re.test(line)) hits.push(`${name}:${i + 1} → say ${say}: ${line.trim()}`);
      });
    expect(hits).toEqual([]);
  });
});

describe("config template", () => {
  test("validates as a config layer (K2)", () => {
    const value = parse(readFileSync(join(ASSETS, "config.yaml"), "utf8")) ?? {};
    const r = validate("config", value);
    expect(r.ok ? [] : r.errors).toEqual([]);
  });

  test("every commented-out key also validates once uncommented", () => {
    const text = readFileSync(join(ASSETS, "config.yaml"), "utf8");
    // Uncomment lines that hold a lowercase YAML key or list item (`# key:`, `#   - key:`); prose comments start uppercase.
    const uncommented = text.replace(/^(\s*)# ( *(?:- )?[a-z_]+:)/gm, "$1$2");
    const value = parse(uncommented) as Record<string, unknown>;
    const r = validate("config", value);
    expect(r.ok ? [] : r.errors).toEqual([]);
    expect(Object.keys(value)).toContain("limits");
  });

  test("as installed, keeps the built-in agent entries, args included", () => {
    const value = parse(readFileSync(join(ASSETS, "config.yaml"), "utf8")) ?? {};
    expect(resolveConfig({}, value).agents).toEqual(DEFAULT_CONFIG.agents);
  });
});

describe("asset resolution (X3)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "norn-assets-"));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));
  const assetsAt = (name: string) => {
    const dir = join(tmp, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "config.yaml"), `# ${name}\n`);
    return dir;
  };
  const src = (over: Partial<AssetsSources> = {}): AssetsSources => ({ env: {}, embedded: null, candidates: [], cacheDir: join(tmp, "cache"), ...over });

  test("NORN_ASSETS_DIR wins over embedded and on-disk assets", () => {
    const override = assetsAt("override");
    const embedded = { hash: "h0", files: [["config.yaml", join(assetsAt("emb0"), "config.yaml")] as const] };
    expect(resolveAssetsDir(src({ env: { NORN_ASSETS_DIR: override }, embedded, candidates: [ASSETS] }))).toBe(override);
  });

  test("a NORN_ASSETS_DIR without assets is an error, not a silent fallback", () => {
    expect(() => resolveAssetsDir(src({ env: { NORN_ASSETS_DIR: join(tmp, "nope") }, candidates: [ASSETS] }))).toThrow(/NORN_ASSETS_DIR/);
  });

  test("embedded assets are extracted once into a content-hashed cache dir", () => {
    const from = assetsAt("emb");
    mkdirSync(join(from, "skills", "x"), { recursive: true });
    writeFileSync(join(from, "skills", "x", "SKILL.md"), "skill x\n");
    const embedded = { hash: "abc", files: [["config.yaml", join(from, "config.yaml")], ["skills/x/SKILL.md", join(from, "skills", "x", "SKILL.md")]] as const };
    const dir = resolveAssetsDir(src({ embedded, candidates: [ASSETS] }));
    expect(dir).toBe(join(tmp, "cache", "norn", "assets-abc"));
    expect(readFileSync(join(dir, "skills", "x", "SKILL.md"), "utf8")).toBe("skill x\n");
    rmSync(join(from, "skills"), { recursive: true });
    expect(resolveAssetsDir(src({ embedded, candidates: [ASSETS] }))).toBe(dir); // reused, sources not re-read
  });

  test("embedded assets extract under XDG_CACHE_HOME, else HOME/.cache", () => {
    const from = join(assetsAt("emb2"), "config.yaml");
    const embedded = { hash: "x1", files: [["config.yaml", from]] as const };
    expect(resolveAssetsDir({ env: { XDG_CACHE_HOME: join(tmp, "xdg") }, embedded, candidates: [] })).toBe(join(tmp, "xdg", "norn", "assets-x1"));
    expect(resolveAssetsDir({ env: { HOME: join(tmp, "home") }, embedded, candidates: [] })).toBe(join(tmp, "home", ".cache", "norn", "assets-x1"));
  });

  test("on disk: the first candidate holding config.yaml (bundle-adjacent before source tree)", () => {
    const adjacent = assetsAt("dist-adjacent");
    expect(resolveAssetsDir(src({ candidates: [join(tmp, "missing"), adjacent, ASSETS] }))).toBe(adjacent);
    expect(resolveAssetsDir(src({ candidates: [join(tmp, "missing"), ASSETS] }))).toBe(ASSETS);
    expect(() => resolveAssetsDir(src({ candidates: [join(tmp, "missing")] }))).toThrow(/NORN_ASSETS_DIR/);
  });

  test("the default resolver finds the source tree", () => {
    expect(assetsDir({})).toBe(ASSETS);
  });
});
