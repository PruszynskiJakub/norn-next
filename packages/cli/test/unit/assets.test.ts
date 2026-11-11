/** Content installed by `norn init`: workflow templates, skills, repo config template. */
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { protocolLines } from "@norn/core";
import { DEFAULT_CONFIG, type Workflow, outcomeEdge, validate } from "@norn/schema";
import { parseWaitCondition } from "@norn/view";
import { parse } from "yaml";
import { type AssetsSources, assetsDir, resolveAssetsDir } from "../../src/runtime/assets.ts";

const ASSETS = join(import.meta.dir, "..", "..", "assets");
const SKILLS_DIR = join(ASSETS, "skills");
const WORKFLOWS_DIR = join(ASSETS, "workflows");

/** The shipped skills: the protocol skill, the step skills, their reference skills and the retro a person runs. */
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
  "norn-fsd-round",
  "norn-fsd",
];
/** The supervisor skills drive norn's own commands from the main checkout, so like `norn` they know norn */
const SUPERVISOR = ["norn-fsd-round", "norn-fsd"];
const CRAFT = SKILLS.filter((s) => s !== "norn" && !SUPERVISOR.includes(s));

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

/** Steps that can reach `$done`, walking declared edges backwards. */
function stepsReachingDone(wf: Workflow): Set<string> {
  // a merge step ends the round when its PR merges
  const reach = new Set<string>(["$done", ...Object.keys(wf.steps).filter((s) => wf.steps[s]?.type === "merge")]);
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
 * Every elementary cycle has a counted edge ⇔ the graph without counted edges is acyclic.
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

    test("every step can reach $done", () => {
      const reach = stepsReachingDone(wf);
      expect(Object.keys(wf.steps).filter((s) => !reach.has(s))).toEqual([]);
    });

    test("every cycle has a counter, and every counter is declared and used", () => {
      expect(uncountedCycle(wf)).toBeNull();
      const used = new Set<string>();
      for (const step of Object.values(wf.steps))
        for (const o of Object.values(step.outcomes as Record<string, Parameters<typeof outcomeEdge>[0]>)) {
          const c = outcomeEdge(o).counter;
          if (c) used.add(c);
        }
      expect([...used].sort()).toEqual(Object.keys(wf.counters ?? {}).sort());
    });

    test("agent outcomes routed to a step carry `means` text", () => {
      const missing: string[] = [];
      for (const [name, step] of Object.entries(wf.steps)) {
        if (step.type !== "agent") continue;
        for (const [o, spec] of Object.entries(step.outcomes)) if (!outcomeEdge(spec).means) missing.push(`${name}.${o}`);
      }
      expect(missing).toEqual([]);
    });

    test("every referenced skill exists in assets/skills", () => {
      for (const step of Object.values(wf.steps))
        if (step.type === "agent") expect({ skill: step.skill, exists: existsSync(join(SKILLS_DIR, step.skill, "SKILL.md")) }).toEqual({ skill: step.skill, exists: true });
    });

    // TODO: core's validator exists in packages/core/src/workflow.ts but is not yet exported from
    // @norn/core. Once it is, also assert:
    // validateWorkflowDefinition(wf, { skills: SKILLS }).issues → []
    // checkWorkflowLevel(wf, file === "story.yaml" ? "story": "slice") → []
  });
});

describe("single-purpose workflows (#136)", () => {
  const wf = (name: string) => loadWorkflow(`${name}.yaml`);
  const targets = (name: string, step: string) =>
    Object.fromEntries(Object.entries(wf(name).steps[step]?.outcomes ?? {}).map(([o, e]) => [o, outcomeEdge(e as Parameters<typeof outcomeEdge>[0]).to]));
  const types = (name: string) => Object.fromEntries(Object.entries(wf(name).steps).map(([s, step]) => [s, step.type]));

  test("triage is the default story workflow and slice the default slice workflow", () => {
    expect([DEFAULT_CONFIG.workflow, DEFAULT_CONFIG.slice_workflow]).toEqual(["triage", "slice"]);
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
    expect(targets("story", "ci")).toEqual({ pass: "ready", fail: "implement", stale: "update" });
  });

  test("story's describe step reads the record, not runs/ in the worktree, here and in this repo's copy (B28)", () => {
    const local = parse(readFileSync(join(ASSETS, "..", "..", "..", ".agents", "workflows", "story.yaml"), "utf8")) as Workflow;
    for (const w of [wf("story"), local]) expect(w.steps.describe).toMatchObject({ skill: "norn-pr", inputs: ["spec", "diff", "record"] });
    expect(readSkill("norn-pr")).toContain("`evidence/<unit>/<run_id>/<file>`");
  });

  // Slices are reviewed before they integrate, so only story-level rework would reach the PR unreviewed
  test("story reviews its rework before the check, and a round without rework never reaches review", () => {
    expect(targets("story", "implement")).toEqual({ done: "review" });
    expect(wf("story").steps.review).toMatchObject({ type: "agent", skill: "norn-review", inputs: ["spec", "diff", "last_findings"] });
    expect(wf("story").steps.review?.outcomes).toMatchObject({ changes_requested: { counter: "review_loop" } });
    expect(targets("story", "review")).toEqual({ approve: "test", changes_requested: "implement" });
    const into = (step: string) =>
      Object.entries(wf("story").steps).flatMap(([from, s]) =>
        Object.entries(s.outcomes).filter(([, e]) => outcomeEdge(e as Parameters<typeof outcomeEdge>[0]).to === step).map(([o]) => `${from}.${o}`),
      );
    expect(into("review")).toEqual(["implement.done"]);
    expect(targets("story", "update")).toMatchObject({ done: "test" });
  });

  test("slice has no QA: implement, test, review, integrate", () => {
    expect(types("slice")).toEqual({ implement: "agent", test: "check", review: "agent", integrate: "git", merge: "agent" });
    expect(targets("slice", "review")).toEqual({ approve: "integrate", changes_requested: "implement" });
  });

  test("quick syncs, then implements, and ends at ready after CI", () => {
    expect(wf("quick").start).toBe("sync");
    expect(targets("quick", "sync")).toEqual({ done: "implement", conflict: "sync-resolve" });
    expect(targets("quick", "open-pr")).toEqual({ done: "ci" });
    expect(targets("quick", "ci")).toEqual({ pass: "ready", fail: "implement", stale: "update" });
  });

  test("story, quick and release approve at ready into a merge step that goes back to update when stale, in both copies", () => {
    const local = (name: string) => parse(readFileSync(join(ASSETS, "..", "..", "..", ".agents", "workflows", `${name}.yaml`), "utf8")) as Workflow;
    const all = [wf("story"), wf("quick"), local("story"), local("quick"), local("release")];
    for (const w of all) {
      const ready = Object.fromEntries(Object.entries(w.steps.ready?.outcomes ?? {}).map(([o, e]) => [o, outcomeEdge(e as Parameters<typeof outcomeEdge>[0]).to]));
      expect({ name: w.name, approve: ready.approve }).toEqual({ name: w.name, approve: "merge" });
      expect({ name: w.name, merge: w.steps.merge }).toMatchObject({ name: w.name, merge: { type: "merge", outcomes: { stale: { to: "update", counter: "stale_loop" } } } });
    }
  });

  test("story and quick wait for CI with the same script, and update-branch re-enters update", () => {
    const run = (name: string) => (wf(name).steps.ci as { run?: string }).run;
    expect(run("story")).toContain("gh pr checks");
    expect(run("quick")).toBe(run("story"));
    for (const name of ["story", "quick"]) expect(wf(name).base).toEqual({ stale: "conflict", step: "update" });
  });

  test("story's and quick's resolve take the base side of each conflict", () => {
    for (const name of ["story", "quick"]) expect((wf(name).steps.resolve as { inputs?: unknown[] }).inputs).toContain("base_side");
  });
});

describe("skills", () => {
  test("exactly these skills are shipped", () => {
    expect(readdirSync(SKILLS_DIR).sort()).toEqual([...SKILLS].sort());
  });

  test.each(SKILLS)("%s has frontmatter with matching name and a description", (name) => {
    const { meta, body } = splitSkill(readSkill(name));
    expect(meta.name).toBe(name);
    expect(typeof meta.description).toBe("string");
    expect((meta.description as string).length).toBeGreaterThan(40);
    expect(body.trim().length).toBeGreaterThan(0);
  });

  test("the norn skill stays under 80 lines", () => {
    expect(readSkill("norn").split("\n").length).toBeLessThanOrEqual(80);
  });

  test("the norn skill and the brief's protocol name no step of any template", () => {
    const text = `${readSkill("norn")}\n${protocolLines({ handoff_file: "handoffs/story.md", attended: false }).join("\n")}`;
    const reserved = new Set(["test", "slice", "slices", "plan", "ready"]); // glossary nouns / plain words
    const names = new Set(workflowFiles.flatMap((f) => Object.keys(loadWorkflow(f).steps)).filter((n) => !reserved.has(n)));
    expect([...names].filter((n) => new RegExp(`\\b${n}\\b`, "i").test(text))).toEqual([]);
  });

  test("the norn skill sends the agent to the brief, whose protocol states the reporting and hard rules", () => {
    const skill = readSkill("norn");
    for (const s of ["norn brief", "norn status", "norn story start <unit>", "How to work"]) expect(skill).toContain(s);
    const protocol = protocolLines({ handoff_file: "handoffs/story.md", attended: false }).join("\n");
    for (const s of ["`brief`", "`done`", "`ask`", "`stuck`", "--handoff", "`--evidence <dir>`", "handoffs/story.md", "Goal", "Proof", "Easy to miss", "Not proven yet", "Notes", "Resume", "8 KB", "git push", "runs/", "gh", "glab"])
      expect(protocol).toContain(s);
  });

  // The supervisor protocol states its terms; the command lint checks every command it prints
  test("norn-fsd-round states the supervisor protocol (B2–B32, B35–B45)", () => {
    const text = readSkill("norn-fsd-round");
    const terms = [
      // Where and what it supervises
      ".norn-unit", "main checkout", "One supervisor per checkout", "Named stories only", "/release-start",
      // The watch is checked by `status --json`'s heartbeat.up (true or false whatever mode the stories are
      // in) before start and after every wait, never started
      "No watch is running", "`! norn watch`", "`heartbeat.up`", "after every wait", "stopped moving",
      // One foreground subagent per story, one voice naming the story, JSON only
      "one subagent per story", "foreground", "norn story wait", "only one who talks to the person", "Name the story in every message", "--json", "never grep markdown",
      // Auto mode, never a step's commands
      "norn story edit <story> --auto", "norn brief", "norn story start",
      // Delegated decisions with reasons; B12: the person's reply is their own answer
      "--delegated --reason", "norn story answer", "norn story approve", "norn story reject", "norn run rerun", "--reset", "without `--delegated`: it is their answer",
      // CI and the PR; B19 reads the checks of the exact head
      "gh run rerun --failed", "exact head", "statusCheckRollup", "headRefOid", "runs/", "handoff.md", "PR's state",
      // Allowed, forbidden, permission rule
      "Allowed:", "Forbidden:", "norn tick", "norn run cancel", "--force", "norn story checkout", "Bash(norn story approve:*)",
      // Escalations; B27: stuck or exhausted again, with the receipts; B36: an unknown workflow
      "a merge, a release, an install or a watch restart the request did not name", "force pushes", "rules file", "max_agents", "closing an issue", "a workflow the skill does not know", "`release`'s `ready`", "question set", "sent once", "quiet",
      "Stuck again at the same step → escalate with the receipts", "Exhausted again → escalate",
      // Release, install and restart in that order
      "approve on their answer → wait for the merge and the publish → install → pull → restart the watch and the cockpit",
      // Load and flakes; Rerun at its check while implement runs, no cancel first
      "reason: timeout", "the load is far above the core count", "suspected flake", "never run tests in a unit worktree", "--step <check> --delegated --reason",
      // A CI glitch and a load failure are rerun at their check too
      "Rerun at its check** (CI glitch, load, suspected flake)", "then rerun at its check (`--step ci`, below)", "then rerun at its check once (`--step <check>`, below)",
      // Whether the work changed since the fail is run view's `check_retry`, not git; norn stops the session itself
      "norn run view <unit> --json", "check_retry", "code_changed", "norn stops that session itself",
      "gh run cancel <id>",
      // JSON only and no story passed to status; a permission prompt answered by its option number
      "never pass a story to `norn status`", "its option number",
      // A merge and a watch restart the request named are allowed
      "when the request named them, `gh pr merge --squash`", "(unless the request named a watch restart)",
      // Stops at the round's end; B13, B27: a stuck unit does not end the round
      "Never start another round", "The round ends at `$done`", "A stuck unit does not end the round",
      // A gate left parked on purpose is never waited on with `--until gate` (it returns at once)
      "Never loop on `--until gate` while you leave a gate parked", "norn story wait <story> --until merged --timeout 160s", "(`--until merged`, not `--until gate`)", "timeout 170 gh run watch <run-id> --exit-status",
      // Every wait stays under the harness's foreground limit; norn and gh run directly, never through a script
      "under the harness's foreground limit", "Bash timeout about 178 s", "norn story wait <story> --until gate --timeout 160s",
      "exit 7: the timeout passed", "never through a script or in the background",
      // The report
      "One report", "delegated decisions with their reasons", "suspected flakes", "waiting: your answer to",
    ];
    expect(terms.filter((t) => !text.includes(t))).toEqual([]);
    // `$stuck` parks a unit for its one diagnosed rerun; it never ends a round
    expect(text).not.toMatch(/round ends at[^.\n]*\$stuck/);
    // No wait outlasts the harness's foreground limit (Claude Code moves a command over ~180 s to the background)
    expect(text).not.toMatch(/--timeout 5m|five minutes/);
    // the shipped text names no spec ids and no story of this repo
    expect(text).not.toMatch(/\(B\d+[,)–]|claims were lost/);
  });

  test("norn-fsd links norn-fsd-round and adds the round choice and the round start (B31–B36, D6)", () => {
    const text = readSkill("norn-fsd");
    const terms = [
      "norn-fsd-round", ".norn-unit", "`quick`", "`story`", "`reproduce`", "Pick the cheapest workflow that delivers safely", "one seam and no new contract → `quick`", "a new contract → `story`", "--workflow <name> --delegated --reason", "Never `--force`", "never on an unfinished round", "closing the issue", "rules file",
      // Refinement without the person: asks answered, the rest as one question set, the plan approved
      "Refinement on the person's behalf", "one question set", "approve the plan yourself",
      // An attended step is the person's turn; B36: a workflow the skill does not know is a suggestion
      "norn story start", "Never type into the pane", "a repo-local workflow the skill does not know",
    ];
    expect(terms.filter((t) => !text.includes(t))).toEqual([]);
  });

  // Norn-fsd's agent and every subagent load norn-fsd-round, so the model must be able to;
  // norn-fsd stays person-only
  test("norn-fsd-round can be loaded by an agent; norn-fsd is started by a person (D6)", () => {
    expect(splitSkill(readSkill("norn-fsd-round")).meta["disable-model-invocation"]).toBeUndefined();
    expect(splitSkill(readSkill("norn-fsd")).meta["disable-model-invocation"]).toBe(true);
  });

  // An agent runs the printed `norn story wait` as written, so every --until value must parse
  test("every `--until` a bundled skill prints is a story wait condition", () => {
    const values = readdirSync(SKILLS_DIR).flatMap((s) => [...readSkill(s).matchAll(/norn story wait \S+ --until (\S+?)[`\s]/g)].map((m) => [s, m[1] as string] as const));
    expect(values.length).toBeGreaterThan(0);
    expect(values.filter(([, v]) => !/^<[^>]+>$/.test(v) && parseWaitCondition(v) === null)).toEqual([]);
  });

  test("norn-review traces every user story and criterion to a test, and writes the table into the handoff", () => {
    const text = readSkill("norn-review");
    // the Spec axis builds the table, one row per item with what it says in words, a test or UNTRACED
    for (const s of ["traceability table", "| Criterion or story | What it says | Verifier | Proven by |", "UNTRACED"]) expect(text).toContain(s);
    // an UNTRACED row blocks, unless the verifier is agent or person: those point at QA
    expect(text).toMatch(/`UNTRACED` row is a blocking Spec finding, unless the criterion's `verifier`[^.]*`agent` or `person`/);
    for (const s of ["QA (agent)", "QA (person)", "counts as `verifier: test`"]) expect(text).toContain(s);
    // the table goes into the handoff's Proof section, an UNTRACED row also under Not proven yet
    expect(text).toMatch(/Write the table into the handoff's Proof section\*\*/);
    expect(text).toContain("`UNTRACED` row also goes under Not proven yet");
    // a craft skill does not cite the rule ids of norn's own rules file
    expect(text).not.toMatch(/\bQV\d/);
  });

  test("norn-refine writes the to-spec layout, and agents name spec items in words to a person", () => {
    const refine = readSkill("norn-refine");
    for (const h of ["## Problem Statement", "## Solution", "## User Stories", "## Out of Scope", "## Further Notes", "## Open questions", "## Plan"]) expect(refine).toContain(h);
    expect(refine).not.toMatch(/^## Behaviour$/m);
    // stories are cited by what they say, never by a number
    expect(refine).toContain("nothing cites a story by its number");
    for (const skill of ["norn-refine", "norn-slice", "norn-review", "norn-qa", "norn-plan", "norn-pr"]) expect(readSkill(skill)).not.toMatch(/\bUS\d|US<n>/);
    // the step protocol and the interview speak in words, to a person and in files
    expect(protocolLines({ handoff_file: "handoffs/story.md", attended: false }).join("\n")).toContain("Never an id alone");
    expect(readSkill("norn-interview")).toMatch(/never by a number or id/);
  });

  test("norn-review reads REVIEW.md, verifies each blocking candidate, and pins every finding to a file and line", () => {
    const text = readSkill("norn-review");
    // the repo's REVIEW.md: ignored paths, what fails here, what not to report
    expect(text).toMatch(/`REVIEW\.md`\*\* at the repo root, when present/);
    for (const s of ["ignore", "counts as failure", "not to report"]) expect(text).toContain(s);
    // a verify pass sits before Decide and drops a candidate that does not hold
    expect(text.indexOf("**Verify each blocking candidate**")).toBeGreaterThan(-1);
    expect(text.indexOf("**Verify each blocking candidate**")).toBeLessThan(text.indexOf("**Decide.**"));
    expect(text).toContain("fresh subagent");
    expect(text).toContain("Drop a candidate that does not hold");
    // every finding names a file and line; the summary states the count, and says so when there are none
    expect(text).toMatch(/`file` and `line` are required/);
    expect(text).toContain("No findings.");
  });

  test("norn-review keeps its contracts and gives its axes principles, not fixed prompts or word caps", () => {
    const text = readSkill("norn-review");
    // two axes, judged apart
    for (const s of ["**Spec**", "**Standards**", "kept apart"]) expect(text).toContain(s);
    // the findings JSON with its blocking flag
    for (const s of ['"axis": "spec"', '"severity": "blocking"', "`severity`: `blocking` | `minor` | `nit`"]) expect(text).toContain(s);
    // no word-for-word subagent prompt and no word cap
    expect(prose(text)).not.toMatch(/"[^"\n]{100,}"/);
    expect(text).not.toMatch(/\b(under|at most|within) \d+ words\b/i);
  });

  /** A subagent sees only what it is given, so one that runs commands needs each rule it could break, with the reason. */
  const expectSubagentRules = (name: string) => {
    const text = readSkill(name);
    const start = text.indexOf("**Subagents that run commands**");
    expect(start).toBeGreaterThan(-1);
    const rules = text.slice(start).split("\n\n")[0] as string;
    // each rule is a bullet that says why after a dash
    for (const rule of [/No push\b/, /No branch or worktree switch/, /No command of the delivery tool/, /No writes under (its|the delivery tool's) run state/]) {
      const line = rules.split("\n").find((l) => rule.test(l));
      expect(line).toMatch(/^\s*- .+ — .{20,}/);
    }
  };

  test("norn-review gives a subagent that runs commands the rules its work can break, each with its reason", () => {
    expectSubagentRules("norn-review");
  });

  // Not every agent tool can start subagents, so each skill that uses them says how to do the work without.
  test.each(["norn-review", "norn-qa", "norn-triage", "norn-diagnose"])("%s does the work itself when it cannot start subagents", (name) => {
    expect(readSkill(name)).toMatch(/When you cannot start subagents, [^.\n]*yourself/);
  });

  test("norn-qa collects each independent criterion's evidence in its own subagent against one prepared environment", () => {
    const text = readSkill("norn-qa");
    // the main agent prepares once and writes the report; subagents write their criterion's evidence files
    for (const s of ["its own subagent", "the environment you prepared", "You write the criteria report"]) expect(text).toContain(s);
    // parallel only where criteria leave shared state alone
    expect(text).toMatch(/in parallel only[^.\n]*shared state/);
    expectSubagentRules("norn-qa");
  });

  test("norn-triage has a subagent read the code and bring back file:line usages and its conclusion, not the files", () => {
    const text = readSkill("norn-triage");
    expect(text).toMatch(/subagent[^\n]*`file:line` usages[^\n]*conclusion[^\n]*not the files/);
  });

  test("norn-diagnose explores the code in a subagent and may ask a fresh one, given only the loop and the symptom, for hypotheses", () => {
    const text = readSkill("norn-diagnose");
    expect(text).toMatch(/code involved in a subagent/);
    expect(text).toMatch(/fresh subagent[^\n]*only the loop and the symptom/);
    // the unanchored list comes before any hypothesis is tested
    expect(text.indexOf("fresh subagent")).toBeLessThan(text.indexOf("## 4. Instrument"));
  });

  test("norn-retro lists the gate rulings after the friction and asks which read as a lasting preference", () => {
    const text = readSkill("norn-retro");
    const section = text.indexOf("## 3. Propose lasting preferences");
    expect(section).toBeGreaterThan(text.indexOf("## 2. Find the friction"));
    const terms = ["`approve` and `reject`", "the gate, the round", "the person's words", "`delegated: true`", "mark it delegated", "which read as a lasting preference"];
    expect(terms.filter((t) => !text.slice(section).includes(t))).toEqual([]);
  });

  test("norn-retro proposes a REVIEW.md or agent instructions line naming file, section, wording and ruling", () => {
    const text = readSkill("norn-retro");
    const terms = [
      "`REVIEW.md`", "how code is judged", "`AGENTS.md`", "else `CLAUDE.md`", "how agents work",
      "**File**", "**Section**", "**Wording**", "**Ruling**",
      // a missing target file is proposed for creation; a preference already stated is cited, not duplicated
      "propose creating it", "cite that line as evidence", "never propose a duplicate",
    ];
    expect(terms.filter((t) => !text.includes(t))).toEqual([]);
  });

  test("norn-retro changes no file", () => {
    const text = readSkill("norn-retro");
    expect(text).toContain("changes no file");
    expect(text).toContain("You write no file and change nothing");
    expect(text).toContain("Do not write it to a file, and do not apply any change");
  });

  test.each(CRAFT)("%s is unaware of norn", (name) => {
    // skill names carry the `norn-` prefix; any other mention of norn is a leak
    const text = readSkill(name).replace(/\bnorn-[a-z-]+/g, "");
    expect(text).not.toMatch(/norn/i);
    expect(prose(text)).not.toMatch(/\b(workflows?|receipts?|outcomes?|steps?|brief)\b/i);
  });

  test.each(SKILLS)("%s links only to files that exist (whole skill folders)", (name) => {
    const links = [...readSkill(name).matchAll(/\]\(([^)#\s]+\.md)\)/g)].map((m) => m[1] as string).filter((l) => !/^[a-z]+:/.test(l));
    expect(links.filter((l) => !existsSync(join(SKILLS_DIR, name, l)))).toEqual([]);
  });

  /** Banned synonyms, same set as test/repo/repo.test.ts lints in sources. */
  const BANNED: Array<[RegExp, string]> = [
    [/\b(task|tasks|job|jobs|ticket|tickets)\b/i, "story / slice"],
    [/\binteractive step/i, "attended step"],
    [/\bapproved\b/i, "approve"],
  ];
  test.each(SKILLS)("%s uses no banned glossary synonyms", (name) => {
    const hits: string[] = [];
    readSkill(name)
      .split("\n")
      .forEach((line, i) => {
        for (const [re, say] of BANNED) if (re.test(line)) hits.push(`${name}:${i + 1} → say ${say}: ${line.trim()}`);
      });
    expect(hits).toEqual([]);
  });

  // The brief's How to work forbids pushes and branch switches for every step, so a skill repeating it can only drift from it.
  test("skills leave the push and branch rules to the brief, keeping committing locally as craft", () => {
    expect(readSkill("norn-implement")).not.toMatch(/never push/i);
    expect(readSkill("norn-merge")).not.toMatch(/never push/i);
    expect(readSkill("norn-diagnose")).not.toMatch(/Never push\./);
    expect(readSkill("norn-prototype")).not.toMatch(/Never create or switch branches for it\./);
    expect(readSkill("norn-implement")).toMatch(/- Commit locally\.\n/);
    expect(readSkill("norn-merge")).toMatch(/both sides' intended behaviour survives\. Commit locally\.\n/);
    expect(readSkill("norn-diagnose")).toMatch(/is in the commit message \(or in your hand-back\)\.\n/);
    expect(readSkill("norn-prototype")).toMatch(/commit the prototype and the spec together on the branch you are on\.\n/);
  });

  // The brief alone adapts a step to the story's mode; the supervisors set it only through the `--auto`/`--manual` flags.
  test.each(SKILLS)("%s names no mode", (name) => {
    const text = readSkill(name).replace(/--(auto|manual)\b/g, "");
    expect(text).not.toMatch(/\b(auto|manual)\b[ -]*(mode|step|story|stories)\b/i);
    expect(text).not.toMatch(/\bmode\b[^.\n]{0,30}\b(auto|manual)\b/i);
  });
});

describe("config starters (B49, B50)", () => {
  const STARTERS = [
    ["config.yaml", "repo"],
    ["user-config.yaml", "user"],
  ] as const;

  test.each(STARTERS)("%s sets nothing as installed and carries a schema modeline", (file, kind) => {
    const text = readFileSync(join(ASSETS, file), "utf8");
    expect(text.split("\n")[0]).toMatch(/^# yaml-language-server: \$schema=\S+\.schema\.json$/);
    expect(parse(text) ?? null).toBeNull();
  });

  test.each(STARTERS)("every commented-out key in %s is valid in its file once uncommented", (file, kind) => {
    const text = readFileSync(join(ASSETS, file), "utf8");
    // Uncomment lines that hold a lowercase YAML key (`# key:`); prose comments start uppercase.
    const uncommented = text.replace(/^(\s*)# ( *[a-z_]+:.*)$/gm, "$1$2").replace(/<[^>]+>/g, "x");
    const value = parse(uncommented) as Record<string, unknown>;
    // The file's schema is what norn checks it with
    expect(validate(`${kind}-config`, value)).toMatchObject({ ok: true });
  });
});

describe("asset resolution", () => {
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
