/**
 * gh-252 (SK1): a session started by hand is held to the rule a launched one is — `norn brief`,
 * `norn story start` and `norn story chat` start it with the worktree's skill copies, even when a
 * bundled one differs from this norn's (gh-61 B20's refusal is gone). B21: a repo-local skill never
 * counts either.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { workflowsDir } from "@norn/store";
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

describe("brief, story start and story chat never refuse on drifted skills (gh-252)", () => {
  test("AC3 (B21): a repo-local skill that differs is not refused", async () => {
    h.write(join(wt(), ".agents/skills/release/SKILL.md"), "---\nname: release\n---\nours, edited\n");
    for (const [name, run] of Object.entries(sessionCommands())) {
      const r = await run();
      expect({ name, exit: r.exit }).toEqual({ name, exit: 0 });
    }
  });

  test("gh-252: an edited bundled skill in the unit worktree refuses none of them", async () => {
    writeFileSync(skill("norn"), `${readFileSync(skill("norn"), "utf8")}\nedited by hand\n`);
    for (const [name, run] of Object.entries(sessionCommands())) {
      const r = await run();
      expect({ name, exit: r.exit }).toEqual({ name, exit: 0 });
    }
  });
});
