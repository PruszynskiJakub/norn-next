import { join } from "node:path";
import { workflowsDir } from "/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-345-every-route-back-needs-a-hand-written/packages/store/src/index.ts";
import { createHarness, FakeRunner, hostEnv, sh, issue, runChecked } from "/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-345-every-route-back-needs-a-hand-written/test/support/harness.ts";
import { runStateOf } from "/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-345-every-route-back-needs-a-hand-written/test/support/run-state.ts";
const out: string[] = [];
const log = (t: string, v: unknown) => { out.push("### " + t + "\n" + (typeof v === "string" ? v : JSON.stringify(v, null, 1))); };
const FLOW = `name: build
start: implement
steps:
  implement:
    agent: Build it.
    skills: [norn-implement]
    outcomes: { done: review }
    means: { done: "built" }
  review:
    agent: Review it.
    skills: [norn-review]
    outcomes: { approve: $done, changes_requested: implement }
    means: { approve: "good", changes_requested: "rework" }
`;
const LEGACY = FLOW.replace("name: build", "name: legacy").replace("changes_requested: implement }", "changes_requested: { to: implement, counter: ready_loop } }").concat("counters: { ready_loop: { max: 3 } }\n");
const h = await createHarness();
try {
  await h.norn("init");
  h.config("provider: gh\nworkflow: legacy\nmode: auto\nrecord:\n  policy: remote\n");
  h.recordVersion();
  h.write(join(workflowsDir(h.root), "build.yaml"), FLOW);
  h.write(join(workflowsDir(h.root), "legacy.yaml"), LEGACY);
  const commit = (m: string) => { h.git(["add", "-A"]); h.git(["commit", "-q", "-m", m]); h.git(["push", "-q", "origin", "main"]); };
  commit("wf");
  const OLD = { key: "gh-7", dir: "gh-7-old-unit" }, NEW = { key: "gh-8", dir: "gh-8-new-unit" };
  const runs = (u: any) => runStateOf(join(h.worktree(u.dir), `.agents/specs/${u.dir}`));
  const st = (u: any) => h.state(runs(u));
  const tick = async () => { h.clock.advance(10_000); return h.tick(); };
  const until = async (u: any, ok: (s: any) => boolean) => { for (let i = 0; i < 12 && !(st(u) && ok(st(u))); i++) await tick(); if (!(st(u) && ok(st(u)))) throw new Error("not reached: " + JSON.stringify(st(u))); };
  h.remote.issues = [issue(7, "Old unit")];
  await until(OLD, (s) => s.step === "implement" && s.status === "running");
  // the legacy file now derives its counter instead; the old unit keeps its pin
  h.write(join(workflowsDir(h.root), "legacy.yaml"), FLOW.replace("name: build", "name: legacy"));
  h.config("provider: gh\nworkflow: build\nmode: auto\nrecord:\n  policy: remote\n");
  commit("derive");
  h.remote.issues = [issue(7, "Old unit"), issue(8, "New unit")];
  await h.tick("--sync");
  await until(NEW, (s) => s.step === "implement" && s.status === "running");
  for (let n = 1; n <= 4; n++) {
    h.report(runs(NEW), "done", { outcome: "done", handoff: "built" });
    await until(NEW, (s) => s.step === "review" && s.status === "running");
    h.report(runs(NEW), "done", { outcome: "changes_requested", handoff: "rework" });
    await until(NEW, (s) => s.status !== "running" || (s.step === "implement" && s.attempt === n + 1));
    log(`after send-back ${n}: state`, { step: st(NEW).step, status: st(NEW).status, counters: st(NEW).counters, park: st(NEW).park ?? null });
    if (n === 1) {
      log("norn status (counter 1/3)", (await h.norn("status")).stdout);
      log("norn story list (counter 1/3)", (await h.norn("story", "list")).stdout);
      log("norn story view gh-8 (counter 1/3)", (await h.norn("story", "view", "gh-8")).stdout);
    }
    if (n < 4) await until(NEW, (s) => s.step === "implement" && s.status === "running");
    if (n === 1) {
      const fs0 = await import("node:fs");
      const root = join(h.dir, "repo-b"); sh(h.dir, ["clone", "-q", h.remoteDir, root]); sh(root, ["config", "user.email", "bob@example.com"]); sh(root, ["config", "user.name", "bob"]);
      const home = join(h.dir, "home-b"); fs0.mkdirSync(home);
      const deps: any = { cwd: root, env: { ...hostEnv(), NORN_HOME_DIR: home, USER: "bob", NORN_MACHINE: "repo-b", NORN_HOOK_COMMAND: "norn hook" }, clock: h.clock, ports: { remote: h.remote, runner: new FakeRunner(), notifiers: [] } };
      h.clock.advance(10_000); await runChecked(["tick", "--sync"], deps);
      log("other machine (not holder): norn status", (await runChecked(["status"], deps)).stdout);
      log("other machine (not holder): norn story view gh-8", (await runChecked(["story", "view", "gh-8"], deps)).stdout.split("\n").filter((l: string) => /Story:|counter|\//.test(l)).join("\n"));
    }
    if (st(NEW).status === "running") {
      const b = await runChecked(["brief"], { ...h.deps, cwd: h.worktree(NEW.dir) });
      log(`norn brief at implement after send-back ${n} (Last round lines)`, b.stdout.split("\n").filter((l: string) => /Last round|review\.changes_requested/.test(l)).join("\n") || "(no line naming the counter)");
    }
  }
  log("norn status (exhausted)", (await h.norn("status")).stdout);
  log("pinned workflow of gh-8 (from state dir)", "");
  const unknown = await h.norn("run", "rerun", "gh-8", "--reset", "review_loop", "--json");
  log("rerun --reset review_loop (unknown)", { exit: unknown.exit, value: unknown.value });
  const ok = await h.norn("run", "rerun", "gh-8", "--reset", "review.changes_requested");
  log("rerun --reset review.changes_requested", { exit: ok.exit, stdout: ok.stdout });
  await until(NEW, (s) => s.status === "running");
  log("after rerun: state", { step: st(NEW).step, status: st(NEW).status, counters: st(NEW).counters });
  // old unit: one send-back, then stopped by a person, rerun with its old counter name
  h.report(runs(OLD), "done", { outcome: "done", handoff: "built" });
  await until(OLD, (s) => s.step === "review" && s.status === "running");
  h.report(runs(OLD), "done", { outcome: "changes_requested", handoff: "rework" });
  await until(OLD, (s) => s.step === "implement" && s.attempt === 2);
  log("old unit counters after a send-back", st(OLD).counters);
  h.report(runs(OLD), "stuck", { reason: "stopped by a person" }, "human");
  await until(OLD, (s) => s.status === "stuck");
  const oldr = await h.norn("run", "rerun", "gh-7", "--reset", "ready_loop");
  log("old unit: rerun --reset ready_loop", { exit: oldr.exit, stdout: oldr.stdout });
  await until(OLD, (s) => s.status === "running");
  log("old unit after rerun", { step: st(OLD).step, counters: st(OLD).counters });
  log("doctor (dev build) on this repo: workflow lines", (await h.norn("doctor")).stdout.split("\n").filter((l: string) => /workflow/.test(l)).join("\n"));
  log("run state dir of gh-8", runs(NEW));
  const fs = await import("node:fs");
  const pin = fs.readdirSync(runs(NEW), { recursive: true }).filter((f: any) => String(f).endsWith("workflow.yaml"));
  for (const p of pin) log("pinned " + p, fs.readFileSync(join(runs(NEW), String(p)), "utf8"));
  const rc = fs.readdirSync(runs(NEW), { recursive: true }).filter((f: any) => /receipts\/.*\.json$/.test(String(f)));
  for (const p of rc) { const t = fs.readFileSync(join(runs(NEW), String(p)), "utf8"); if (/review\.changes_requested/.test(t)) log("receipt " + p, t); }
} finally {
  await Bun.write("/private/tmp/claude-501/-Users-jakubpruszynski--norn-repos-norn-b68fe828-worktrees-gh-345-every-route-back-needs-a-hand-written/a123bec2-7f6b-4e73-bbe1-b07081c9342f/scratchpad/qa/../ev/04-run.md", out.join("\n\n"));
  h.cleanup();
}
