import { existsSync, readdirSync, writeFileSync, mkdirSync, symlinkSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { createHarness, issue, sh, hostEnv, FakeRunner, runChecked } from "/Users/jakubpruszynski/Projects/norn-worktrees/gh-318-unit-worktrees-live-in-the-machine-dir/test/support/harness.ts";
import { workflowsDir } from "/Users/jakubpruszynski/Projects/norn-worktrees/gh-318-unit-worktrees-live-in-the-machine-dir/packages/store/src/index.ts";
const out: string[] = []; const log = (...a: unknown[]) => { const s = a.map(x => typeof x === "string" ? x : JSON.stringify(x, null, 1)).join(" "); out.push(s); };
const BUILD = "name: build\nstart: build\nsteps:\n  build:\n    type: agent\n    skill: norn-implement\n    outcomes: { done: { to: $done, means: \"built\" } }\n";
const a = await createHarness();
try {
  await a.norn("init"); a.config("provider: gh\nworkflow: build\nmode: auto\n"); a.write(join(workflowsDir(a.root),"build.yaml"),BUILD); a.recordVersion();
  a.git(["add","-A"]); a.git(["commit","-q","-m","init"]); a.git(["push","-q","origin","main"]);
  a.remote.issues = [issue(11, "Linked home")];
  const root = join(a.dir,"repo-s"); sh(a.dir,["clone","-q",a.remoteDir,root]); sh(root,["config","user.email","s@example.com"]); sh(root,["config","user.name","sam"]);
  const real = join(a.dir,"real-home"); mkdirSync(real); const link = join(a.dir,"link-home"); symlinkSync(real, link);
  const e: any = { ...hostEnv(), USER:"sam", NORN_MACHINE:"repo-s", NORN_HOOK_COMMAND:"norn hook", NORN_HOME_DIR: link };
  const deps: any = { cwd: root, env: e, clock: a.clock, ports: { remote: a.remote, runner: new FakeRunner() as any, notifiers: [] } };
  const r = await runChecked(["tick"], deps);
  log("## symlinked NORN_HOME_DIR", link, "->", realpathSync(link), "; tick exit", r.exit, r.stderr);
  log("git worktree list:\n"+sh(root,["worktree","list"]));
  const id = readdirSync(join(real,"repos"))[0]; const wts = join(realpathSync(real),"repos",id,"worktrees");
  log("worktrees folder:", readdirSync(wts));
  const orphan = join(wts,"gh-98-orphan"); sh(root,["worktree","add","-q","-b","gh-98-orphan",orphan,"main"]);
  const t = await runChecked(["tidy","--dry-run","--json"], deps);
  log("## tidy --dry-run under symlinked home exit", t.exit, JSON.stringify(JSON.parse(t.stdout).would_remove.worktrees), "kept", JSON.stringify(JSON.parse(t.stdout).kept));
  const s = await runChecked(["status","--json"], deps);
  log("## status --json reach:", JSON.stringify(Object.values(JSON.parse(s.stdout).groups).flat().map((i:any)=>({story:i.story, reach:i.reach?.worktree}))));
  log("siblings:", readdirSync(a.dir));
} finally { writeFileSync("/private/tmp/claude-501/-Users-jakubpruszynski-Projects-norn-worktrees-gh-318-unit-worktrees-live-in-the-machine-dir/f436e852-f0c8-4057-bc4a-cad2d3cddfef/scratchpad/qa4/observe3-output.md", out.join("\n")); a.cleanup(); }
