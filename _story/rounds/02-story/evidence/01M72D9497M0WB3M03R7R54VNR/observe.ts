import { existsSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHarness, issue, sh, hostEnv, FakeRunner, runChecked } from "/Users/jakubpruszynski/Projects/norn-worktrees/gh-318-unit-worktrees-live-in-the-machine-dir/test/support/harness.ts";
import { cloneOf } from "/Users/jakubpruszynski/Projects/norn-worktrees/gh-318-unit-worktrees-live-in-the-machine-dir/test/support/clone.ts";
import { runStateOf } from "/Users/jakubpruszynski/Projects/norn-worktrees/gh-318-unit-worktrees-live-in-the-machine-dir/test/support/run-state.ts";
import { machineDir, workflowsDir, machineReposDir, checkoutOf } from "/Users/jakubpruszynski/Projects/norn-worktrees/gh-318-unit-worktrees-live-in-the-machine-dir/packages/store/src/index.ts";
const out: string[] = []; const log = (...a: unknown[]) => { const s = a.map(x => typeof x === "string" ? x : JSON.stringify(x, null, 1)).join(" "); out.push(s); console.log(s); };
const SLICED = `name: sliced
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
const BUILD = `name: build
start: build
steps:
  build:
    type: agent
    skill: norn-implement
    outcomes: { done: { to: $done, means: "built" } }
`;
const h = await createHarness();
try {
  log("## setup: repo", h.root, "home", h.home);
  await h.norn("init"); h.config("provider: gh\nworkflow: sliced\nmode: auto\n");
  h.write(join(workflowsDir(h.root), "sliced.yaml"), SLICED); h.write(join(workflowsDir(h.root), "build.yaml"), BUILD);
  h.recordVersion();
  h.git(["add","-A"]); h.git(["commit","-q","-m","init"]); h.git(["push","-q","origin","main"]);
  h.remote.issues = [issue(2, "Split work")];
  const DIR = "gh-2-split-work", SPEC = ".agents/specs/"+DIR;
  const md = machineDir(h.root);
  log("## machine dir:", md);
  for (let i=0;i<6;i++){ h.clock.advance(10000); await h.tick(); }
  log("## AC1 git worktree list after intake ticks:\n"+h.git(["worktree","list"]));
  const storyWt = join(md,"worktrees",DIR);
  log("story wt exists:", existsSync(storyWt), "branch:", existsSync(storyWt) ? sh(storyWt,["rev-parse","--abbrev-ref","HEAD"]).trim() : null);
  log("siblings of repo:", readdirSync(dirname(h.root)));
  const st = await h.norn("status","--json");
  log("## AC9/AC6 status --json reach/command for gh-2:", Object.values((st.value as any).groups).flat().filter((i:any)=>i.story==="gh-2").map((i:any)=>({slice:i.slice,command:i.command,reach:i.reach})));
  const pr = await h.norn("story","start","gh-2","--print");
  log("## AC6 story start --print (exit "+pr.exit+"):\n"+pr.stdout);
  // slice
  const storyRuns = runStateOf(join(storyWt, SPEC));
  h.write(join(storyWt, SPEC, "slices/01-first.md"), "---\nid: gh-2/01\ntitle: First part\nworkflow: build\ndepends_on: []\nstatus: planned\n---\n\nAcceptance: it works.\n");
  h.report(storyRuns, "done", { outcome: "done", handoff: "one slice" });
  for (let i=0;i<8;i++){ h.clock.advance(10000); await h.tick(); }
  log("## AC2 git worktree list after slice start:\n"+h.git(["worktree","list"]));
  const st2 = await h.norn("status","--json");
  log("## AC9 status --json after slice start:", Object.values((st2.value as any).groups).flat().filter((i:any)=>i.story==="gh-2").map((i:any)=>({slice:i.slice,reach:i.reach})));
  const sl = await h.norn("story","list","--json");
  log("story list root:", (sl.value as any).stories.map((s:any)=>({key:s.key, root:s.root})));
  // AC8 gone check
  rmSync(storyWt,{recursive:true,force:true}); log("## AC8 deleted", storyWt, "exists:", existsSync(storyWt));
  const s8 = await h.norn("story","start","gh-2");
  log("story start exit", s8.exit, "stdout:\n"+s8.stdout+s8.stderr);
  log("after: exists", existsSync(storyWt));
  // AC7 tidy
  const clean = join(md,"worktrees","gh-97-gone"), dirty = join(md,"worktrees","gh-96-dirty");
  h.git(["worktree","add","-q","-b","gh-97-gone",clean,"main"]); h.git(["worktree","add","-q","-b","gh-96-dirty",dirty,"main"]);
  writeFileSync(join(dirty,"README.md"),"# changed\n");
  log("## AC7 tidy --dry-run:", (await h.norn("tidy","--dry-run","--json")).value);
  log("tidy:", (await h.norn("tidy","--json")).value);
  log("clean exists", existsSync(clean), "dirty exists", existsSync(dirty));
  // AC5 clone
  const B = cloneOf(h, "repo-b", "bob");
  h.remote.issues = [...h.remote.issues, issue(10, "Two places")];
  h.clock.advance(10000); await h.tick(); await B.tick();
  log("## AC5 A:", join(md,"worktrees","gh-10-two-places"), existsSync(join(md,"worktrees","gh-10-two-places")));
  const bwt = join(machineDir(B.root),"worktrees","gh-10-two-places");
  log("B:", bwt, existsSync(bwt));
  log("siblings of repo (AC3):", readdirSync(dirname(h.root)));
  // AC4 --home
  const root = join(h.dir,"repo-c"); sh(h.dir,["clone","-q",h.remoteDir,root]); sh(root,["config","user.email","c@example.com"]); sh(root,["config","user.name","carol"]);
  const home = join(h.dir,"home-c"); mkdirSync(home);
  const env: Record<string,string|undefined> = { ...hostEnv(), USER:"carol", NORN_MACHINE:"repo-c", NORN_HOOK_COMMAND:"norn hook" }; delete env.NORN_HOME_DIR;
  const r = await runChecked(["tick","--home",home], { cwd: root, env, home, clock: h.clock, ports: { remote: h.remote, runner: new FakeRunner() as any, notifiers: [] } } as any);
  log("## AC4 tick with --home exit", r.exit, r.stderr);
  log("worktree list in repo-c:\n"+sh(root,["worktree","list"]));
  log("home-c machine repos:", readdirSync(machineReposDir(home)), "expected prefix", join(machineReposDir(home), checkoutOf(root).id, "worktrees"));
  log("## final siblings:", readdirSync(h.dir));
} finally { writeFileSync(process.env.TMPDIR+"/qa-gh318/ev/observe-output.md", out.join("\n")); h.cleanup(); }
