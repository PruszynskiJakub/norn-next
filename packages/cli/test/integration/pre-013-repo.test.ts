/**
 * A repo from before 0.13 holds only `.agents/norn/` (its config, workflows and trace). norn never looks
 * for that layout: such a repo is one with no team file, so the missing `norn_version` refusal stops an
 * acting command, the agent hooks never refuse on it, and `norn doctor` has no layout check to report.
 * The old paths are spelled out here: what a person had.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { versionBaseline } from "@norn/core";
import { repoConfigPath, workflowsDir, writeUnitMarker } from "@norn/store";
import { createHarness, type Harness, issue, layoutPlaces, runChecked, sh } from "../../../../test/support/harness.ts";

setDefaultTimeout(60_000);

const RUNNING = "0.31.0";
/** The pre-0.13 files by absolute path, at the old places the harness spells out */
const oldFilesOf = (root: string): Record<string, string> => {
  const old = layoutPlaces(root);
  return {
    [old.config.old]: "provider: gh\nworkflow: duo\nmode: manual\n",
    [join(old.workflows.old, "duo.yaml")]: "name: duo\nstart: implement\nsteps:\n  implement:\n    type: agent\n    skill: norn-implement\n    outcomes: { done: $done }\n",
    [join(old["machine files"].old, "2026-01-01.jsonl")]: '{"type":"tick"}\n',
  };
};

let h: Harness;
let OLD_FILES: Record<string, string> = {};
beforeAll(async () => {
  h = await createHarness({ version: RUNNING });
  // init's files gone, only the pre-0.13 ones left and committed, as an old norn left the repo
  expect((await h.norn("init")).exit).toBe(0);
  rmSync(repoConfigPath(h.root), { force: true });
  rmSync(workflowsDir(h.root), { recursive: true, force: true });
  OLD_FILES = oldFilesOf(h.root);
  for (const [path, text] of Object.entries(OLD_FILES)) h.write(path, text);
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "an old norn's files"]);
  h.git(["push", "-q", "origin", "main"]);
  h.remote.issues = [issue(3, "Add totals")];
});
afterAll(() => h.cleanup());

const oldFiles = () => Object.fromEntries(Object.keys(OLD_FILES).map((p) => [p, readFileSync(p, "utf8")]));

describe("a pre-0.13 repo is a repo with no team file", () => {
  test("an acting command exits 3 with version_missing, and every old file is where it was, unchanged", async () => {
    const rule = versionBaseline(null, RUNNING)!;
    for (const argv of [["tick"], ["story", "start", "gh-3"], ["config", "set", "mode", "auto", "--local"]]) {
      const r = await h.norn(...argv, "--json");
      expect({ argv, exit: r.exit, value: r.value }).toEqual({ argv, exit: 3, value: { error: rule.error, do_instead: rule.do_instead, code: "version_missing", details: { repo: null, running: RUNNING } } });
    }
    expect(oldFiles()).toEqual(OLD_FILES);
    expect(readdirSync(layoutPlaces(h.root)["machine files"].old)).toEqual(["2026-01-01.jsonl"]);
    expect(h.git(["status", "--porcelain"])).toBe("");
  });

  test("an agent hook in a unit worktree does not refuse on the layout", async () => {
    const wt = join(h.dir, "wt-old");
    mkdirSync(wt);
    sh(wt, ["init", "-q"]);
    writeUnitMarker(wt, { repo: h.root, story: "gh-3", slice: null, unit: "_story", spec_dir: ".agents/specs/gh-3-add-totals" });
    for (const event of ["stop", "pre-tool-use"]) {
      const r = await runChecked(["hook", event, "--json"], { ...h.deps, cwd: wt, stdin: JSON.stringify({ session_id: "s", cwd: wt, hook_event_name: event === "stop" ? "Stop" : "PreToolUse", stop_hook_active: false }) });
      expect(r.exit).toBe(0);
      expect(JSON.stringify(r.value)).not.toMatch(/old_layout|both_layouts|layout/);
    }
    expect(oldFiles()).toEqual(OLD_FILES);
  });
});

describe("norn doctor has no layout check", () => {
  const mentions = /layout|norn migrate/i;
  async function expectNoLayout(of: Harness): Promise<void> {
    for (const flags of [[], ["--repo"]]) {
      const json = await of.norn("doctor", ...flags, "--json");
      const repo = (json.value as { repo?: Record<string, unknown> }).repo;
      expect(repo).toBeDefined();
      expect(Object.keys(repo ?? {})).not.toContain("layout");
      expect(JSON.stringify(json.value)).not.toMatch(mentions);
      const md = await of.norn("doctor", ...flags);
      expect(md.stdout).toContain("norn doctor:");
      expect(md.stdout).not.toMatch(mentions);
    }
  }

  test("a pre-0.13 repo: no layout key with --json, no layout line in markdown, nothing names an old layout or norn migrate, nothing moved", async () => {
    await expectNoLayout(h);
    expect(oldFiles()).toEqual(OLD_FILES);
  });

  test("a repo from 0.30 on: the same", async () => {
    const fresh = await createHarness({ version: RUNNING });
    try {
      expect((await fresh.norn("init")).exit).toBe(0);
      await expectNoLayout(fresh);
    } finally {
      fresh.cleanup();
    }
  });
});
