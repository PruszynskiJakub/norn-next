/**
 * Run state is read only from the machine dir (and a finished story's archive ref): a
 * `runs/` folder an older norn left in a story branch's tree is never read, moved or committed away.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { cpSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { workflowsDir } from "@norn/store";
import type { CliResult, TickReport } from "../../src/index.ts";
import { createHarness, type Harness, issue, runChecked, sh } from "../../../../test/support/harness.ts";
import { runStateOf } from "../../../../test/support/run-state.ts";

setDefaultTimeout(60_000);

const DUO = `name: duo
start: implement
steps:
  implement:
    type: agent
    skill: norn-implement
    outcomes: { done: { to: review, means: "every criterion has a passing test" } }
  review:
    type: agent
    skill: norn-review
    outcomes:
      approve: { to: $done, means: "no blocking findings" }
      changes_requested: { to: implement, counter: review_loop, means: "blocking findings" }
counters: { review_loop: { max: 3 } }
`;

let h: Harness;
const inWt = (cwd: string, ...argv: string[]): Promise<CliResult> => {
  const env: Record<string, string | undefined> = { ...h.deps.env, NORN_AGENT_PID: String(process.pid) };
  for (const k of ["NORN_AGENT", "NORN_RUN", "NORN_STORY", "NORN_SLICE", "NORN_AGENT_SESSION_ID"]) delete env[k];
  return runChecked(argv, { ...h.deps, cwd, env });
};
const tick = (): Promise<TickReport> => {
  h.clock.advance(10_000);
  return h.tick();
};
async function tickUntil(pred: () => boolean, max = 12) {
  for (let i = 0; i < max && !pred(); i++) await tick();
  expect(pred()).toBe(true);
}
const treeRuns = (cwd: string, ref: string, spec: string) =>
  sh(cwd, ["ls-tree", "-r", "--name-only", ref, "--", `${spec}/runs`])
    .split("\n")
    .filter(Boolean);

beforeAll(async () => {
  h = await createHarness();
  expect((await h.norn("init")).exit).toBe(0);
  h.config("provider: gh\nworkflow: duo\nmode: manual\n");
  h.write(join(workflowsDir(h.root), "duo.yaml"), DUO);
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn init"]);
  h.git(["push", "-q", "origin", "main"]);
});
afterAll(() => h.cleanup());

describe("runs/ in a story branch's tree is never read or moved", () => {
  test("ticks leave the branch tree as it is and the story moves on from its machine-dir state", async () => {
    const spec = ".agents/specs/gh-9-keep-it-local";
    const wt = `${h.root}-worktrees/gh-9-keep-it-local`;
    const runs = () => runStateOf(join(wt, spec));
    h.remote.issues = [...h.remote.issues, issue(9, "Keep it local")];
    await h.tick("--sync");
    await tickUntil(() => h.state(runs())?.step === "implement");
    const before = h.state(runs());

    // an older norn's copy of the record, on the branch: the machine dir keeps its own
    cpSync(runs(), join(wt, spec, "runs", "_story"), { recursive: true });
    sh(wt, ["add", "-A"]);
    sh(wt, ["commit", "-q", "-m", "norn: gh-9 run state (older norn)"]);
    sh(wt, ["push", "-q", "--force", "origin", "HEAD"]);
    const head = sh(wt, ["rev-parse", "HEAD"]);
    const files = treeRuns(wt, "HEAD", spec);
    expect(files.length).toBeGreaterThan(1);

    const r = await tick();
    expect(r.decisions.filter((d) => d.unit === "gh-9").map((d) => d.rule)).not.toContain("record.move");
    expect(h.state(runs())).toEqual(before);
    expect((await inWt(wt, "brief")).exit).toBe(0);
    await tick();
    expect(h.state(runs())).toMatchObject({ step: "implement", status: "running" });
    h.write(join(wt, "src", "f9.ts"), "export const x = 1;\n");
    expect((await inWt(wt, "done", "done", "--handoff", "built it")).exit).toBe(0);
    await tickUntil(() => h.state(runs())?.step === "review");

    // no commit removed runs/ from the branch, here or on the remote
    expect(treeRuns(wt, "HEAD", spec)).toEqual(files);
    const log = sh(wt, ["log", "--format=%s", `${head}..HEAD`]).split("\n").filter(Boolean);
    expect(log.some((s) => s.includes("run state off the branch"))).toBe(false);
    h.git(["fetch", "-q", "origin"]);
    expect(treeRuns(h.root, "origin/gh-9-keep-it-local", spec)).toEqual(files);
    expect(readdirSync(join(wt, spec, "runs"))).toEqual(["_story"]);
  });
});
