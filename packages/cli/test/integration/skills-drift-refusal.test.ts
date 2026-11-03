/**
 * gh-61 B20 (D11): a session started by hand is held to the rule a launched one is — `norn brief`,
 * `norn story start` and `norn story chat` refuse (`skills_drift`, exit 3) when the worktree the
 * agent would run in holds bundled skills that differ from this norn's. B21: a repo-local skill
 * never counts; D14: a worktree whose team file records a newer `norn_version` is not checked.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repoConfigPath, workflowsDir } from "@norn/store";
import type { CliDeps, CliResult } from "../../src/index.ts";
import { createHarness, type Harness, issue, runChecked } from "../../../../test/support/harness.ts";

setDefaultTimeout(30_000);

const STORY = `name: story
start: refine
steps:
  refine:
    type: agent
    skill: norn-refine
    attended: true
    outcomes: { done: $done }
`;

let h: Harness;
const wt = () => `${h.root}-worktrees/gh-7-add-login-form`;
const skill = (name: string) => join(wt(), ".agents/skills", name, "SKILL.md");
const norn = (deps: Partial<CliDeps>, ...argv: string[]): Promise<CliResult> => runChecked(argv, { ...h.deps, ...deps });
function agentEnv() {
  const e: Record<string, string | undefined> = { ...h.deps.env, NORN_AGENT_PID: String(process.pid) };
  for (const k of ["NORN_AGENT", "NORN_RUN", "NORN_STORY", "NORN_SLICE", "NORN_AGENT_SESSION_ID"]) delete e[k];
  return e;
}
/** the three commands a person or an agent starts a session with, for gh-7 */
const sessionCommands = () => ({
  brief: () => norn({ cwd: wt(), env: agentEnv() }, "brief", "--json"),
  start: () => norn({}, "story", "start", "gh-7", "--print", "--json"),
  chat: () => norn({ herdr: null }, "story", "chat", "gh-7", "--json"),
});

beforeAll(async () => {
  h = await createHarness({ version: "0.19.0" });
  expect((await h.norn("init")).exit).toBe(0);
  h.config("provider: gh\nworkflow: story\nmode: manual\n");
  h.write(join(workflowsDir(h.root), "story.yaml"), STORY);
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn init"]);
  h.git(["push", "-q", "origin", "main"]);
  h.remote.issues = [issue(7, "Add login form", ["norn"])];
  for (let i = 0; i < 3; i++) {
    await h.tick();
    h.clock.advance(10_000);
  }
});
afterAll(() => h.cleanup());

describe("brief, story start and story chat refuse on drifted skills (gh-61 B20, B21, D14)", () => {
  test("AC3 (B21): a repo-local skill that differs is not refused", async () => {
    h.write(join(wt(), ".agents/skills/release/SKILL.md"), "---\nname: release\n---\nours, edited\n");
    for (const [name, run] of Object.entries(sessionCommands())) {
      const r = await run();
      expect({ name, exit: r.exit }).toEqual({ name, exit: 0 });
    }
  });

  test("AC1, AC2 (B20): an edited bundled skill in the unit worktree refuses each one, naming the fix", async () => {
    writeFileSync(skill("norn"), `${readFileSync(skill("norn"), "utf8")}\nedited by hand\n`);
    for (const [name, run] of Object.entries(sessionCommands())) {
      const r = await run();
      expect({ name, exit: r.exit, value: r.value }).toEqual({
        name,
        exit: 3,
        value: { error: "skills differ from norn 0.19.0: norn", do_instead: "bring the base in with `norn story update-branch gh-7`", code: "skills_drift" },
      });
    }
  });

  test("AC3 (D14): a worktree whose team file records a newer norn_version is not refused", async () => {
    const team = repoConfigPath(wt());
    writeFileSync(team, `${readFileSync(team, "utf8")}norn_version: 0.20.0\n`);
    for (const [name, run] of Object.entries(sessionCommands())) {
      const r = await run();
      expect({ name, exit: r.exit }).toEqual({ name, exit: 0 });
    }
  });
});
