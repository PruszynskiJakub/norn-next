import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repoConfigPath, workflowsDir, setSpawnObserver } from "/Users/jakubpruszynski/Projects/norn-worktrees/gh-71-approving-triage-s-confirm-gate-ends-the--02-story-close-effects/packages/store/src/index.ts";
import { createHarness, issue } from "/Users/jakubpruszynski/Projects/norn-worktrees/gh-71-approving-triage-s-confirm-gate-ends-the--02-story-close-effects/test/support/harness.ts";
setDefaultTimeout(120_000);
const OUT = process.env.QA_OUT as string;
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
    outcomes: { done: $done }
`;
const CONFIG = `agents:
  claude: { adapter: claude }
runner: { adapter: headless }
remote: { provider: gh, label: norn }
default_workflow: mini
default_mode: auto
notifiers: []
`;
const SPEC = ".agents/specs/gh-7-add-login-form", BRANCH = "gh-7-add-login-form";
const log: string[] = [];
let h: Awaited<ReturnType<typeof createHarness>>;
afterAll(() => h?.cleanup());
test("AC2", async () => {
  h = await createHarness();
  const storyWt = `${h.root}-worktrees/${BRANCH}`, sliceWt = `${storyWt}--01-form`;
  const storyRuns = join(storyWt, SPEC, "runs/_story"), sliceRuns = join(sliceWt, SPEC, "runs/01-form");
  const tick = async () => { h.clock.advance(10_000); return h.tick(); };
  const until = async (ok: () => boolean) => { for (let i = 0; i < 12 && !ok(); i++) await tick(); expect(ok()).toBe(true); };
  await h.norn("init");
  h.write(repoConfigPath(h.root), CONFIG);
  h.write(join(workflowsDir(h.root), "mini.yaml"), MINI);
  h.write(join(workflowsDir(h.root), "slice.yaml"), SLICE);
  h.git(["add", "-A"]); h.git(["commit", "-q", "-m", "init"]); h.git(["push", "-q", "origin", "main"]);
  h.remote.issues = [issue(7, "Add login form")];
  await until(() => h.state(storyRuns)?.run?.session != null);
  await tick();
  h.write(join(storyWt, SPEC, "slices/01-form.md"), "---\nid: gh-7/01\ntitle: Form\ndepends_on: []\nstatus: planned\n---\n\nAcceptance: it renders.\n");
  h.report(storyRuns, "done", { outcome: "done", handoff: "planned" });
  await until(() => h.state(sliceRuns)?.run?.session != null);
  // uncommitted work in the slice worktree: must survive the close via the pushed branch
  h.write(join(sliceWt, "form.txt"), "uncommitted work\n");
  const before = h.git(["ls-remote", "origin"]);
  setSpawnObserver((s) => { if (s.argv[0] === "git") log.push(s.argv.slice(1).join(" ")); });
  const r = await h.norn("story", "close", "gh-7", "--yes");
  setSpawnObserver(null);
  const after = h.git(["ls-remote", "origin"]);
  const remoteSpec = h.git(["show", `origin/${BRANCH}:${SPEC}/spec.md`.replace("origin/", "refs/remotes/origin/")]) ;
  let sliceFile = ""; try { h.git(["fetch", "-q", "origin"]); sliceFile = h.git(["show", "origin/gh-7/01-form:form.txt"]); } catch (e) { sliceFile = String(e); }
  const wtGone = { story: !existsSync(storyWt), slice: !existsSync(sliceWt) };
  const localBranches = h.git(["branch", "--list"]);
  const refs = h.git(["for-each-ref", "refs/norn"]);
  const re = await h.norn("story", "reopen", "gh-7");
  const reState = { storyWt: existsSync(storyWt), sliceWt: existsSync(sliceWt), sliceFile: existsSync(join(sliceWt, "form.txt")) ? readFileSync(join(sliceWt, "form.txt"), "utf8") : null, specStatus: (readFileSync(join(storyWt, SPEC, "spec.md"), "utf8").match(/^status:.*$/m) ?? [""])[0] };
  writeFileSync(OUT, JSON.stringify({ close: r, gitLog: log, remoteBefore: before, remoteAfter: after, remoteSpecStatus: (remoteSpec.match(/^status:.*$/m) ?? [""])[0], sliceFileOnRemote: sliceFile, wtGone, localBranches, normRefsAfterClose: refs, reopen: re, afterReopen: reState }, null, 2));
  expect(r.exit).toBe(0);
});
