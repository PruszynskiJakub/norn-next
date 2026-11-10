import { existsSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHarness, issue, sh, hostEnv, FakeRunner, runChecked } from "/Users/jakubpruszynski/Projects/norn-worktrees/gh-318-unit-worktrees-live-in-the-machine-dir/test/support/harness.ts";
import { cloneOf } from "/Users/jakubpruszynski/Projects/norn-worktrees/gh-318-unit-worktrees-live-in-the-machine-dir/test/support/clone.ts";
import { machineDir, workflowsDir, machineReposDir, checkoutOf } from "/Users/jakubpruszynski/Projects/norn-worktrees/gh-318-unit-worktrees-live-in-the-machine-dir/packages/store/src/index.ts";
const out: string[] = []; const log = (...a: unknown[]) => { const s = a.map(x => typeof x === "string" ? x : JSON.stringify(x, null, 1)).join(" "); out.push(s); console.log(s); };
const ATT = `name: story
start: refine
steps:
  refine:
    type: agent
    skill: norn-refine
    attended: true
    outcomes: { done: { to: approve, means: "spec written" } }
  approve:
    type: gate
    prompt: "Approve the spec"
    outcomes: { approve: $done, reject: { to: refine, counter: spec_loop } }
counters: { spec_loop: { max: 2 } }
`;
const BUILD = `name: build
start: build
steps:
  build:
    type: agent
    skill: norn-implement
    outcomes: { done: { to: $done, means: "built" } }
`;
async function setup(cfg: string, wf: Record<string,string>) { const h = await createHarness(); await h.norn("init"); h.config(cfg); for (const [n,y] of Object.entries(wf)) h.write(join(workflowsDir(h.root), n+".yaml"), y); h.recordVersion(); h.git(["add","-A"]); h.git(["commit","-q","-m","init"]); h.git(["push","-q","origin","main"]); return h; }
const hs: any[] = [];
try {
  const h = await setup("provider: gh\nworkflow: story\nmode: manual\n", { story: ATT }); hs.push(h);
  h.remote.issues = [issue(7, "Add login form", ["norn"])];
  for (let i=0;i<3;i++){ h.clock.advance(10000); await h.tick(); }
  const wt = join(machineDir(h.root),"worktrees","gh-7-add-login-form");
  log("## attended story; git worktree list:\n"+h.git(["worktree","list"]));
  const st = await h.norn("status");
  log("## AC6 inbox (status, markdown):\n"+st.stdout);
  const pr = await h.norn("story","start","gh-7","--print");
  log("## AC6 story start --print exit", pr.exit, "\n"+pr.stdout+pr.stderr);
  const opened: any[] = []; h.runner.capabilities = { ...h.runner.capabilities, open: true };
  Object.assign(h.runner, { openForPerson: async (spec: any) => (opened.push(spec), { pane_id: "p-9" }) });
  const tab = await h.norn("story","start","gh-7","--json");
  log("## AC6 story start with Herdr-capable runner:", tab.value, "opened tab cwd:", opened.map(o=>o.cwd));
  const env: any = { ...h.deps.env, NORN_AGENT_PID: String(process.pid) }; for (const k of ["NORN_AGENT","NORN_RUN","NORN_STORY","NORN_SLICE","NORN_AGENT_SESSION_ID"]) delete env[k];
  const br = await runChecked(["brief"], { ...h.deps, cwd: wt, env });
  log("## AC6 brief from the worktree exit", br.exit, "first lines:\n"+br.stdout.split("\n").slice(0,3).join("\n"), "\nlines naming the worktree:\n"+br.stdout.split("\n").filter((l:string)=>l.includes("worktrees/")).join("\n"));
  rmSync(wt,{recursive:true,force:true}); log("## AC8 removed worktree; exists:", existsSync(wt));
  const s8 = await h.norn("story","start","gh-7","--json"); log("story start exit", s8.exit, s8.value);
  log("after: exists", existsSync(wt), existsSync(wt) ? "branch "+sh(wt,["rev-parse","--abbrev-ref","HEAD"]).trim() : "");
  log("siblings of repo:", readdirSync(dirname(h.root)));

  const a = await setup("provider: gh\nworkflow: build\nmode: auto\n", { build: BUILD }); hs.push(a);
  a.remote.issues = [issue(10, "Two places")];
  const B = cloneOf(a, "repo-b", "bob");
  await a.tick(); await B.tick();
  const aw = join(machineDir(a.root),"worktrees","gh-10-two-places"), bw = join(machineDir(B.root),"worktrees","gh-10-two-places");
  log("## AC5 clone A wt:", aw, existsSync(aw), "\nclone B wt:", bw, existsSync(bw), "\ndiffer:", aw!==bw);
  log("siblings:", readdirSync(a.dir));
  const root = join(a.dir,"repo-c"); sh(a.dir,["clone","-q",a.remoteDir,root]); sh(root,["config","user.email","c@example.com"]); sh(root,["config","user.name","carol"]);
  const home = join(a.dir,"home-c"); mkdirSync(home);
  const e: any = { ...hostEnv(), USER:"carol", NORN_MACHINE:"repo-c", NORN_HOOK_COMMAND:"norn hook" }; delete e.NORN_HOME_DIR;
  const r = await runChecked(["tick"], { cwd: root, env: e, home, clock: a.clock, ports: { remote: a.remote, runner: new FakeRunner() as any, notifiers: [] } } as any);
  log("## AC4 tick with home given to the command (no NORN_HOME_DIR), exit", r.exit, r.stderr);
  log("repo-c worktree list:\n"+sh(root,["worktree","list"]));
  log("expected under:", join(machineReposDir(home), checkoutOf(root).id, "worktrees"));
} finally { writeFileSync("/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T//gh318-qa3/observe2-output.md", out.join("\n")); for (const h of hs) h.cleanup(); }
