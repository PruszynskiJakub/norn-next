import { join } from "node:path";
import { repoConfigPath, workflowsDir } from "/Users/jakubpruszynski/Projects/norn-worktrees/gh-71-approving-triage-s-confirm-gate-ends-the--01-record-folder-resolver/packages/store/src/index.ts";
import { createHarness, issue } from "/Users/jakubpruszynski/Projects/norn-worktrees/gh-71-approving-triage-s-confirm-gate-ends-the--01-record-folder-resolver/test/support/harness.ts";
const MINI = `name: mini
start: plan
steps:
  plan:
    type: agent
    skill: norn-plan
    outcomes: { done: { to: slices, means: "slice files written" } }
  slices:
    type: slices
    outcomes: { done: open-pr, stuck: $stuck }
  open-pr:
    type: git
    action: open-pr
    outcomes: { done: $done }
`;
const SLICE = `name: slice
start: implement
steps:
  implement:
    type: agent
    skill: norn-implement
    outcomes: { done: { to: test, means: "tests pass" } }
  test:
    type: check
    run: test -f pass.flag && echo checked
    timeout: 1m
    outcomes: { pass: $done, fail: { to: implement, counter: test_loop } }
counters: { test_loop: { max: 3 } }
`;
const CONFIG = `agents:
  claude: { adapter: claude }
runner: { adapter: headless }
remote: { provider: gh, label: norn }
default_workflow: story
default_mode: auto
notifiers: []
`;
const h = await createHarness();
await h.norn("init");
h.write(repoConfigPath(h.root), CONFIG);
h.write(join(workflowsDir(h.root), "mini.yaml"), MINI);
h.write(join(workflowsDir(h.root), "slice.yaml"), SLICE);
h.git(["add", "-A"]); h.git(["commit", "-q", "-m", "norn init"]); h.git(["push", "-q", "origin", "main"]);
h.remote.issues = [issue(7, "Add login form", ["norn", "norn:wf:mini"])];
const storyWt = `${h.root}-worktrees/gh-7-add-login-form`;
const spec = ".agents/specs/gh-7-add-login-form";
const storyRuns = join(storyWt, spec, "runs/_story");
const step = () => h.clock.advance(10_000);
const log = (r: any) => console.error(JSON.stringify(r.decisions.filter((d: any) => d.kind !== "noop").map((d: any) => d.unit + " " + d.kind + (d.ok ? "" : " FAILED " + d.error))));
log(await h.tick()); step(); log(await h.tick()); step(); log(await h.tick()); step(); log(await h.tick());
h.write(join(storyWt, spec, "slices/01-form.md"), "---\nid: gh-7/01\ntitle: Login form\ndepends_on: []\nstatus: planned\n---\n\nAcceptance: the form renders.\n");
h.report(storyRuns, "done", { outcome: "done", handoff: "planned one slice" });
step(); log(await h.tick()); step(); log(await h.tick()); step(); log(await h.tick());
console.log(JSON.stringify({ dir: h.dir, root: h.root, home: h.home, storyWt, sliceWt: storyWt + "--01-form" }));
