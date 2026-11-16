/**
 * `norn upgrade` moves the main checkout's workflow and shared files to the new wording: each old
 * file rewritten (loading to the same workflow) and staged with the rest of the upgrade; a file the
 * rewrite cannot place a comment in left as written and listed, the others still moved, the exit 0;
 * a rerun and an all-new repo change no workflow file; run state in the machine dir never touched.
 */
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { loadWorkflows, loadWorkflowText, repoConfigPath, rewriteWorkflowWording, sharedFile, translateWording, workflowsDir } from "@norn/store";
import type { Workflow } from "@norn/schema";
import { createHarness, type Harness, issue, runChecked, sh } from "../../../../test/support/harness.ts";

setDefaultTimeout(60_000);

const RUNNING = "0.31.0";
// Old-wording files a person wrote before the upgrade: a workflow, a shared file with an exit route's meaning, and a workflow using it
const SOLO = `# one agent step
name: solo
start: implement
steps:
  implement:
    type: agent
    skill: norn-implement # the skill it runs
    outcomes: { done: $done }
`;
const GREET = `description: Say hello.
start: greet
steps:
  greet:
    type: agent
    skill: norn-implement
    instructions: Say hello.
    outcomes:
      done: { exit: greeted, means: "said hello" }
`;
const USES = `name: uses
start: hello
steps:
  hello:
    use: greet
    outcomes: { greeted: test }
  test:
    type: check
    run: bun test
    timeout: 5m
    outcomes: { pass: $done, fail: $done }
`;
const OLD_FILES = [".agents/workflows/shared/greet.yaml", ".agents/workflows/solo.yaml", ".agents/workflows/uses.yaml"];

interface Report {
  norn_version: { from: string; to: string; changed: boolean };
  workflows: { rewritten: string[]; refused: Array<{ file: string; line: number; message: string }> };
  staged: string[];
}

/**
 * A repo set up by norn 0.30.0 and committed, holding the old-wording files above and init's files in
 * the new wording (whichever wording this norn ships them in); the binary under test is 0.31.0.
 */
async function repoAt030(): Promise<Harness> {
  const h = await createHarness({ version: RUNNING });
  expect((await runChecked(["init"], { ...h.deps, version: "0.30.0" })).exit).toBe(0);
  expect(rewriteWorkflowWording(h.root).refused).toEqual([]);
  h.write(join(workflowsDir(h.root), "solo.yaml"), SOLO);
  h.write(join(workflowsDir(h.root), "shared", "greet.yaml"), GREET);
  h.write(join(workflowsDir(h.root), "uses.yaml"), USES);
  sh(h.root, ["add", "-A"]);
  sh(h.root, ["commit", "-q", "-m", "Set up norn 0.30.0"]);
  return h;
}

/** Every file in `.agents/workflows/` (shared folder included), relative to the root, with its text. */
function workflowTexts(h: Harness): Record<string, string> {
  const dir = workflowsDir(h.root);
  const out: Record<string, string> = {};
  for (const p of (readdirSync(dir, { recursive: true }) as string[]).sort()) {
    const path = join(dir, p);
    if (/\.(ya?ml|json)$/.test(p)) out[relative(h.root, path)] = readFileSync(path, "utf8");
  }
  return out;
}

const oldWording = (texts: Record<string, string>) => Object.keys(texts).filter((f) => {
  const r = translateWording(texts[f] as string, f);
  return !r.ok || r.changed;
});
function loaded(h: Harness) {
  const l = loadWorkflows(h.root);
  expect(l.errors).toEqual([]);
  return Object.fromEntries(Object.entries(l.workflows).map(([n, w]) => [n, w.workflow]));
}
/** The workflows as copies of these texts load them (the main checkout refuses the old wording), by name. */
function loadedAsCopies(h: Harness) {
  const dir = workflowsDir(h.root);
  const out: Record<string, Workflow> = {};
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".yaml"))) {
    const name = f.slice(0, -".yaml".length);
    const r = loadWorkflowText(name, readFileSync(join(dir, f), "utf8"), f, "copy", h.root, (n) => readFileSync(join(dir, sharedFile(n)), "utf8"));
    if (!r.ok) throw new Error(`${f}: ${JSON.stringify(r)}`);
    out[name] = r.value.workflow;
  }
  return out;
}
const stagedFiles = (h: Harness) => sh(h.root, ["diff", "--staged", "--name-only"]).trim().split("\n").filter(Boolean);
const unstaged = (h: Harness) => sh(h.root, ["diff", "--name-only"]).trim();

describe("norn upgrade rewrites the old-wording workflow and shared files", () => {
  test("each old file is rewritten to the new wording, loads to the same workflow, is staged and listed under workflows.rewritten", async () => {
    const h = await repoAt030();
    try {
      const before = workflowTexts(h);
      const old = oldWording(before);
      expect(old).toEqual(OLD_FILES);
      const workflowsBefore = loadedAsCopies(h);
      expect(Object.keys(workflowsBefore)).toEqual(expect.arrayContaining(["solo", "uses"]));

      const r = await h.norn("upgrade", "--json");
      expect(r.exit).toBe(0);
      const v = r.value as Report;
      expect(v.workflows.refused).toEqual([]);
      expect([...v.workflows.rewritten].sort()).toEqual(old);
      expect(oldWording(workflowTexts(h))).toEqual([]);
      expect(loaded(h)).toEqual(workflowsBefore);
      // comments stay where they were written
      expect(h.read(join(workflowsDir(h.root), "solo.yaml"))).toContain("# the skill it runs");
      for (const f of old) {
        expect(v.staged).toContain(f);
        expect(stagedFiles(h)).toContain(f);
      }
      expect(unstaged(h)).toBe("");
    } finally {
      h.cleanup();
    }
  });

  test("the markdown report names the rewritten files", async () => {
    const h = await repoAt030();
    try {
      const old = oldWording(workflowTexts(h));
      const r = await h.norn("upgrade");
      expect(r.exit).toBe(0);
      expect(r.stdout).toContain("Workflows rewritten to the new wording");
      for (const f of old) expect(r.stdout).toContain(f);
    } finally {
      h.cleanup();
    }
  });
});

describe("norn upgrade refuses one file it cannot rewrite and moves the rest", () => {
  // the comment on `type:` has no line left once `type` and `instructions` become one `agent:` line
  const ODD = `name: odd
start: a
steps:
  a:
    type: agent # an agent
    skill: norn-implement
    instructions: Do it. # and its orientation
    outcomes: { done: { to: $done, means: "m" } }
`;

  test("that file is left as written and listed with its file, line and message; every other file is rewritten; norn_version is written; exit 0", async () => {
    const h = await repoAt030();
    try {
      const odd = join(workflowsDir(h.root), "odd.yaml");
      h.write(odd, ODD);
      sh(h.root, ["add", "-A"]);
      sh(h.root, ["commit", "-q", "-m", "an odd workflow"]);
      const others = oldWording(workflowTexts(h)).filter((f) => f !== ".agents/workflows/odd.yaml");
      expect(others).toEqual(OLD_FILES);

      const r = await h.norn("upgrade", "--json");
      expect(r.exit).toBe(0);
      const v = r.value as Report;
      expect([...v.workflows.rewritten].sort()).toEqual(others);
      expect(v.workflows.refused).toHaveLength(1);
      expect(v.workflows.refused[0]).toMatchObject({ file: ".agents/workflows/odd.yaml", line: 5 });
      expect(v.workflows.refused[0]?.message).toContain("comment");
      expect(h.read(odd)).toBe(ODD);
      expect(v.staged).not.toContain(".agents/workflows/odd.yaml");
      expect(oldWording(workflowTexts(h))).toEqual([".agents/workflows/odd.yaml"]);
      expect(v.norn_version).toEqual({ from: "0.30.0", to: RUNNING, changed: true });
      expect(h.read(repoConfigPath(h.root))).toContain(`norn_version: ${RUNNING}`);
    } finally {
      h.cleanup();
    }
  });

  test("the markdown report names the refused file with its line", async () => {
    const h = await repoAt030();
    try {
      h.write(join(workflowsDir(h.root), "odd.yaml"), ODD);
      const r = await h.norn("upgrade");
      expect(r.exit).toBe(0);
      expect(r.stdout).toContain(".agents/workflows/odd.yaml:5");
    } finally {
      h.cleanup();
    }
  });
});

describe("norn upgrade changes no workflow file when there is nothing to rewrite", () => {
  test("a second run changes no workflow file and reports none rewritten", async () => {
    const h = await repoAt030();
    try {
      expect((await h.norn("upgrade", "--json")).exit).toBe(0);
      const once = workflowTexts(h);
      const r = await h.norn("upgrade", "--json");
      expect(r.exit).toBe(0);
      expect((r.value as Report).workflows).toEqual({ rewritten: [], refused: [] });
      expect(workflowTexts(h)).toEqual(once);
    } finally {
      h.cleanup();
    }
  });

  test("a repo whose files are all in the new wording: none rewritten, no workflow change reported", async () => {
    const h = await repoAt030();
    try {
      expect((await h.norn("upgrade", "--json")).exit).toBe(0);
      sh(h.root, ["commit", "-q", "-m", "upgrade"]);
      // the next upgrade starts from an older recorded version, with every file already new
      const team = h.read(repoConfigPath(h.root)).replace(/^norn_version:.*$/m, "norn_version: 0.30.0");
      h.write(repoConfigPath(h.root), team);
      sh(h.root, ["commit", "-q", "-am", "back to 0.30.0"]);
      const before = workflowTexts(h);
      expect(oldWording(before)).toEqual([]);

      const r = await h.norn("upgrade", "--json");
      expect(r.exit).toBe(0);
      const v = r.value as Report;
      expect(v.workflows).toEqual({ rewritten: [], refused: [] });
      expect(v.norn_version.changed).toBe(true);
      expect(workflowTexts(h)).toEqual(before);
      expect(stagedFiles(h).filter((f) => f.startsWith(".agents/workflows/"))).toEqual([]);
      const md = await h.norn("upgrade");
      expect(md.stdout).not.toContain("Workflows rewritten");
    } finally {
      h.cleanup();
    }
  });
});

describe("norn upgrade never touches run state", () => {
  /** sha256 over every file under a `runs/` folder in the norn home, with its path. */
  function runStateHash(h: Harness): string {
    const files = (readdirSync(h.home, { recursive: true }) as string[]).filter((p) => p.split("/").includes("runs")).sort();
    const hash = createHash("sha256");
    let count = 0;
    for (const p of files) {
      let bytes: Buffer;
      try {
        bytes = readFileSync(join(h.home, p));
      } catch {
        continue; // a folder
      }
      count++;
      hash.update(p).update(bytes);
    }
    expect(count).toBeGreaterThan(0);
    return hash.digest("hex");
  }

  test("units with pins, receipts and state: the machine dir's run state hashes the same before and after", async () => {
    const h = await createHarness();
    try {
      expect((await h.norn("init")).exit).toBe(0);
      h.config("provider: gh\nworkflow: solo\nmode: manual\n");
      // the main checkout refuses the old wording, so the unit starts on solo's new wording and the old file comes after
      const translated = translateWording(SOLO, "solo.yaml");
      if (!translated.ok) throw new Error("SOLO does not translate");
      h.write(join(workflowsDir(h.root), "solo.yaml"), translated.text);
      h.git(["add", "-A"]);
      h.git(["commit", "-q", "-m", "norn"]);
      h.git(["push", "-q", "origin", "main"]);
      h.remote.issues = [issue(4, "Four")];
      for (let i = 0; i < 4; i++) {
        h.clock.advance(10_000);
        await h.tick();
      }
      const pinned = (readdirSync(h.home, { recursive: true }) as string[]).filter((p) => p.endsWith("/workflow.yaml") && p.split("/").includes("runs"));
      expect(pinned.length).toBeGreaterThan(0);
      h.write(join(workflowsDir(h.root), "solo.yaml"), SOLO);
      h.git(["commit", "-q", "-am", "solo in the old wording"]);
      const before = runStateHash(h);

      const r = await h.norn("upgrade", "--json");
      expect(r.exit).toBe(0);
      expect((r.value as Report).workflows.rewritten).toContain(".agents/workflows/solo.yaml");
      expect(runStateHash(h)).toBe(before);
    } finally {
      h.cleanup();
    }
  });
});
