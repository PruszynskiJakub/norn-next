/** gh-80 loop (throwaway, not committed): merge step resolves an integrate conflict with `git merge --no-ff`, then integrate conflicts again. */
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runCli } from "../src/index.ts";
import { createHarness, type Harness, issue } from "./harness.ts";

setDefaultTimeout(60_000);
const MINI = `name: mini
start: plan
steps:
  plan:
    type: agent
    skill: norn-plan
    outcomes: { done: { to: slices, means: "slice files written" } }
  slices:
    type: slices
    outcomes: { done: $done, stuck: $stuck }
`;
const SLICE = `name: slice
start: implement
steps:
  implement:
    type: agent
    skill: norn-implement
    outcomes: { done: { to: integrate, means: "built" } }
  integrate:
    type: git
    action: integrate
    outcomes: { done: $done, conflict: { to: merge, counter: conflict_loop } }
  merge:
    type: agent
    skill: norn-merge
    outcomes: { done: { to: integrate, means: "conflicts resolved keeping the intent of both sides; tests pass" } }
counters: { conflict_loop: { max: 2 } }
`;
const CONFIG = `agents:
  claude: { adapter: claude }
runner: { adapter: headless }
remote: { provider: gh, label: norn }
default_workflow: mini
default_mode: auto
notifiers: []
`;
let h: Harness;
beforeAll(async () => { h = await createHarness(); });
afterAll(() => h.cleanup());

test("gh-80: a conflict resolved in merge stays resolved when integrate runs again", async () => {
  const storyWt = `${h.root}-worktrees/gh-7-add-login-form`;
  const sliceWt = `${storyWt}--01-form`;
  const spec = ".agents/specs/gh-7-add-login-form";
  const storyRuns = join(storyWt, spec, "runs/_story");
  const sliceRuns = join(sliceWt, spec, "runs/01-form");
  const step = () => h.clock.advance(10_000);
  const tick = async () => { step(); return (await h.tick()).decisions.filter((d) => d.kind !== "noop" && d.rule !== "claim.renew").map((d) => `${d.unit} ${d.kind}${d.ok ? "" : ` FAILED ${d.error}`}`); };
  const log = (...a: unknown[]) => console.log("[gh80]", ...a);
  await h.norn("init");
  h.write(join(h.root, "f.txt"), "base\n");
  h.write(join(h.root, ".agents/norn/config.yaml"), CONFIG);
  h.write(join(h.root, ".agents/norn/workflows/mini.yaml"), MINI);
  h.write(join(h.root, ".agents/norn/workflows/slice.yaml"), SLICE);
  h.git(["add", "-A"]); h.git(["commit", "-q", "-m", "setup"]); h.git(["push", "-q", "origin", "main"]);
  h.remote.issues = [issue(7, "Add login form", ["norn", "norn:wf:mini"])];
  for (let i = 0; i < 4; i++) log(await tick()); // intake, claim, start_unit, start_run(plan)
  h.write(join(storyWt, spec, "slices/01-form.md"), "---\nid: gh-7/01\ntitle: Login form\ndepends_on: []\nstatus: planned\n---\n\nAcceptance: x.\n");
  h.report(storyRuns, "done", { outcome: "done", handoff: "planned" });
  await tick(); await tick(); // apply, start_slices
  await tick(); // slice start_run(implement)
  // the slice and the story branch change the same line after the fork
  h.write(join(sliceWt, "f.txt"), "slice side\n");
  h.report(sliceRuns, "done", { outcome: "done", handoff: "built" });
  h.write(join(storyWt, "f.txt"), "story side\n");
  h.git(["commit", "-q", "-am", "story moves f"], storyWt);
  log(await tick()); // apply → integrate
  log(await tick()); // run_git integrate
  log(await tick()); // apply conflict → merge
  let st = h.state(sliceRuns)!;
  log("after integrate#1:", st.step, st.counters);
  expect(st).toMatchObject({ step: "merge", counters: { conflict_loop: 1 } });
  log(await tick()); // start_run(merge)
  // merge#1 does what norn-merge says when nothing is in progress: merge the story branch, resolve
  const storyBranch = "gh-7-add-login-form";
  try { h.git(["merge", "--no-ff", "-q", storyBranch], sliceWt); } catch { /* conflict expected */ }
  h.write(join(sliceWt, "f.txt"), "slice side + story side\n");
  h.git(["commit", "-q", "-am", "merge story branch, resolve f.txt"], sliceWt);
  log("story tip ancestor of slice HEAD:", Bun.spawnSync(["git", "merge-base", "--is-ancestor", storyBranch, "HEAD"], { cwd: sliceWt }).exitCode === 0);
  const done = await runCli(["done", "done", "--handoff", "resolved f.txt", "--json"], { ...h.deps, cwd: sliceWt });
  log("norn done exit", done.exit, JSON.stringify(done.value).slice(0, 200));
  log(await tick()); // apply merge.done → integrate
  log(await tick()); // run_git integrate
  log(await tick()); // apply
  st = h.state(sliceRuns)!;
  const rc = readdirSync(join(sliceRuns, "receipts")).filter((f) => f.endsWith("-classify.json") || f.endsWith("-git.json"));
  for (const f of rc) log(f, readFileSync(join(sliceRuns, "receipts", f), "utf8").match(/"detail"[^\n]*/)?.[0]);
  log("after integrate#2:", st.step, st.status, st.counters);
  // the resolution is in the slice HEAD: integrate must not conflict again
  expect(st.counters.conflict_loop ?? 0).toBe(1);
  expect(st.step).toBe("$done");
});
