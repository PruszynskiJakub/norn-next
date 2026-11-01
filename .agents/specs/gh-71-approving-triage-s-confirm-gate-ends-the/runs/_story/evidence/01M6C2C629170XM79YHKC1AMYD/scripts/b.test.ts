import { test } from "bun:test";
import { join } from "node:path";
import { existsSync, readFileSync, readdirSync, mkdirSync, cpSync, writeFileSync } from "node:fs";
import { setup, issue, storyUnitDir, cmd, log, tree, R } from "./common.ts";
import { runChecked, sh } from "/Users/jakubpruszynski/Projects/norn-worktrees/gh-71-approving-triage-s-confirm-gate-ends-the/test/support/harness.ts";

test("scenario B", async () => {
  const t = await setup();
  const mk = (n: number, slug: string) => {
    const spec = `.agents/specs/gh-${n}-${slug}`;
    const wt = `${t.root}-worktrees/gh-${n}-${slug}`;
    return { spec, wt, record: join(wt, spec, "runs/_story"), runs: () => storyUnitDir(join(wt, spec)) };
  };
  t.remote.issues = [issue(30, "Stuck one"), issue(31, "Running one"), issue(32, "Sliced one"), issue(33, "PR one"), issue(34, "Close me"), issue(35, "Closed busy"), issue(36, "Flat busy"), issue(37, "Flat done"), issue(38, "Same again")];
  const S = { 30: mk(30, "stuck-one"), 31: mk(31, "running-one"), 32: mk(32, "sliced-one"), 33: mk(33, "pr-one"), 34: mk(34, "close-me"), 35: mk(35, "closed-busy"), 36: mk(36, "flat-busy"), 37: mk(37, "flat-done"), 38: mk(38, "same-again") } as Record<number, ReturnType<typeof mk>>;
  const next = async (f = "B-ticks.md") => { t.clock.advance(10_000); const r = await t.tick(); log(f, "tick", r.decisions.filter((d: any) => d.rule !== "noop").map((d: any) => `${d.unit} ${d.rule} ok=${d.ok} ${d.warnings ? JSON.stringify(d.warnings) : ""}`).join("\n")); return r; };
  const until = async (n: number, pred: () => boolean, max = 8) => { for (let i = 0; i < max && !pred(); i++) await next(); };
  const st = (n: number) => t.state(S[n].runs()) as any;
  const finishTriage = async (n: number) => {
    await until(n, () => st(n)?.status === "running" && st(n)?.step === "explore");
    t.report(S[n].runs(), "done", { outcome: "story", handoff: "go" });
    await next();
    await t.norn("story", "approve", `gh-${n}`);
    await next();
  };
  for (let i = 0; i < 10; i++) await next();
  // ---- B12: agent running explore
  log("B12.md", "gh-31 state", { step: st(31)?.step, status: st(31)?.status });
  await cmd(t, "B12.md", "story", "edit", "gh-31", "--workflow", "story", "--force", "--json");
  log("B12.md", "gh-31 after", { step: st(31)?.step, status: st(31)?.status, round: st(31)?.round ?? 1 });
  // ---- B11 stuck: gh-30 triage → quick round 2, work stuck → force quick --at sync
  t.report(S[30].runs(), "done", { outcome: "story", handoff: "go" }); await next();
  await t.norn("story", "approve", "gh-30"); await next();
  await t.norn("story", "edit", "gh-30", "--workflow", "quick", "--at", "work"); await next();
  await until(30, () => st(30)?.status === "running");
  t.report(S[30].runs(), "done", { outcome: "stuck", handoff: "cannot" }); await next();
  log("B11.md", "gh-30 round 2 state", { round: st(30)?.round, workflow: st(30)?.workflow, step: st(30)?.step, status: st(30)?.status });
  await cmd(t, "B11.md", "story", "edit", "gh-30", "--workflow", "quick", "--force", "--at", "sync");
  await next();
  log("B11.md", "gh-30 after", { round: st(30)?.round, workflow: st(30)?.workflow, step: st(30)?.step, runs: S[30].runs().replace(t.dir, "<TMP>"), round2ended: (t.state(join(S[30].record, "rounds/02-quick")) as any)?.ended });
  // ---- B8: same workflow again
  t.report(S[38].runs(), "done", { outcome: "story", handoff: "go" }); await next();
  await t.norn("story", "approve", "gh-38"); await next();
  await cmd(t, "B8.md", "story", "edit", "gh-38", "--workflow", "triage");
  await next();
  log("B8.md", "gh-38 after", { round: st(38)?.round, workflow: st(38)?.workflow, step: st(38)?.step, counters: st(38)?.counters, runs: S[38].runs().replace(t.dir, "<TMP>") });
  // ---- B33 + B13: gh-32 triage → story round 2 at slices with two slice files
  t.report(S[32].runs(), "done", { outcome: "story", handoff: "go" }); await next();
  await t.norn("story", "approve", "gh-32"); await next();
  const wt32 = S[32].wt;
  t.write(join(wt32, S[32].spec, "slices/01-part.md"), "---\nid: gh-32/01\ntitle: Part\nworkflow: slice\ndepends_on: []\nstatus: planned\n---\n\nAcceptance: works.\n");
  t.git(["add", "-A"], wt32); t.git(["commit", "-q", "-m", "slices"], wt32);
  await cmd(t, "B33.md", "story", "edit", "gh-32", "--workflow", "story", "--at", "slices");
  for (let i = 0; i < 6; i++) await next();
  const sliceDirs = readdirSync(join(wt32, S[32].spec, "runs"));
  log("B33.md", "runs/ folders", sliceDirs);
  const sliceState = (() => { for (const d of readdirSync(t.root + "-worktrees")) { const p = join(t.root + "-worktrees", d, S[32].spec, "runs/01-part"); if (existsSync(join(p, "state.json"))) return t.state(p); } return t.state(join(wt32, S[32].spec, "runs/01-part")); })() as any;
  log("B33.md", "slice 01 state", sliceState && { slice: sliceState.slice, round: sliceState.round, step: sliceState.step, status: sliceState.status });
  await cmd(t, "B13.md", "status");
  await cmd(t, "B13.md", "story", "edit", "gh-32", "--workflow", "quick", "--force", "--json");
  log("B13.md", "gh-32 story state after", { round: st(32)?.round, step: st(32)?.step });
  // ---- B21, B4, B7: gh-33 triage → quick round 2 opens PR → round 3 quick → merged
  t.report(S[33].runs(), "done", { outcome: "story", handoff: "go" }); await next();
  await t.norn("story", "approve", "gh-33"); await next();
  await t.norn("story", "edit", "gh-33", "--workflow", "quick", "--at", "work"); await next();
  await until(33, () => st(33)?.status === "running");
  t.write(join(S[33].wt, "r2.txt"), "two\n"); t.git(["add", "r2.txt"], S[33].wt); t.git(["commit", "-q", "-m", "round 2 work"], S[33].wt);
  t.report(S[33].runs(), "done", { outcome: "done", handoff: "changed" });
  await until(33, () => st(33)?.step === "ready");
  await t.norn("story", "approve", "gh-33"); await next();
  log("B7.md", "gh-33 round 2 finished with PR", { round: st(33)?.round, step: st(33)?.step, prs: t.remote.prs.map((p) => `${p.number} ${p.state} ${p.head}`) });
  await cmd(t, "B27.md", "status");
  await cmd(t, "B7.md", "story", "edit", "gh-33", "--workflow", "quick", "--at", "work");
  await next();
  await until(33, () => st(33)?.status === "running");
  log("B4.md", "round 3 worktree has round 2 file", { exists: existsSync(join(S[33].wt, "r2.txt")), branch: t.git(["rev-parse", "--abbrev-ref", "HEAD"], S[33].wt), round: st(33)?.round, runs: S[33].runs().replace(t.dir, "<TMP>") });
  t.write(join(S[33].wt, "r3.txt"), "three\n"); t.git(["add", "r3.txt"], S[33].wt); t.git(["commit", "-q", "-m", "round 3 work"], S[33].wt);
  t.write(join(S[33].wt, S[33].spec, "pr.md"), "round 3 body\n");
  t.report(S[33].runs(), "done", { outcome: "done", handoff: "changed again" });
  await until(33, () => st(33)?.step === "ready");
  log("B4.md", "remote PR calls", t.remote.calls.filter((c) => c.startsWith("pr+") || c.startsWith("pr~")));
  log("B4.md", "PR body", t.remote.bodies.get(t.remote.prs[0].number) ?? "");
  log("B21.md", "spec status before merge", readFileSync(join(S[33].wt, S[33].spec, "spec.md"), "utf8").match(/status: \w+/)?.[0]);
  Object.assign(t.remote.prs[0], { state: "merged", merged_at: t.clock.iso() });
  t.clock.advance(10 * 60_000);
  const merged = await t.tick("--sync");
  log("B21.md", "merge tick decisions gh-33", merged.decisions.filter((d: any) => d.unit === "gh-33").map((d: any) => d.rule));
  log("B21.md", "worktree gone / claim gone", { worktree: existsSync(S[33].wt), claim: t.git(["ls-remote", "origin", "refs/norn/claims/gh-33"]) });
  // ---- B22, B23: gh-34 finished triage, close issue
  t.report(S[34].runs(), "done", { outcome: "close", handoff: "nothing to do" }); await next();
  await t.norn("story", "approve", "gh-34"); await next();
  await cmd(t, "B26.md", "status", "--json");
  t.remote.issues = t.remote.issues.map((i) => (i.number === 34 ? { ...i, state: "closed" } : i));
  t.clock.advance(10 * 60_000);
  const c = await t.tick("--sync");
  log("B22.md", "sync tick decisions gh-34", c.decisions.filter((d: any) => d.unit === "gh-34").map((d: any) => `${d.rule} ok=${d.ok}`));
  await next();
  log("B22.md", "after", { worktree: existsSync(S[34].wt), localBranch: t.git(["branch", "--list", "gh-34-close-me"]), remoteBranch: t.git(["ls-remote", "origin", "refs/heads/gh-34-close-me"]), claim: t.git(["ls-remote", "origin", "refs/norn/claims/gh-34"]), mailbox: t.git(["ls-remote", "origin", "refs/norn/mailbox/gh-34*"]) });
  const remoteSpec = sh(t.dir, ["--git-dir", t.remoteDir, "show", "gh-34-close-me:" + S[34].spec + "/spec.md"]);
  log("B22.md", "spec.md on pushed branch", remoteSpec.match(/status: \w+/)?.[0] ?? "?");
  log("B22.md", "record on pushed branch", sh(t.dir, ["--git-dir", t.remoteDir, "ls-tree", "-r", "--name-only", "gh-34-close-me", S[34].spec + "/runs"]));
  await cmd(t, "B22.md", "status");
  t.remote.issues = t.remote.issues.map((i) => (i.number === 34 ? { ...i, state: "open" } : i));
  await cmd(t, "B23.md", "story", "reopen", "gh-34", "--json");
  for (let i = 0; i < 3; i++) await next();
  log("B23.md", "after reopen", { exists: existsSync(S[34].wt), round: st(34)?.round ?? 1, step: st(34)?.step, status: st(34)?.status });
  await cmd(t, "B23.md", "status");
  await cmd(t, "B23.md", "story", "edit", "gh-34", "--workflow", "story");
  await next();
  log("B23.md", "after edit+tick", { round: st(34)?.round, workflow: st(34)?.workflow, step: st(34)?.step });
  // ---- B24: gh-35 round unfinished (at confirm), issue closed
  t.report(S[35].runs(), "done", { outcome: "story", handoff: "go" }); await next();
  t.remote.issues = t.remote.issues.map((i) => (i.number === 35 ? { ...i, state: "closed" } : i));
  t.clock.advance(10 * 60_000);
  await t.tick("--sync"); await next();
  log("B24.md", "gh-35", { step: st(35)?.step, status: st(35)?.status, park: st(35)?.park, worktree: existsSync(S[35].wt) });
  await cmd(t, "B24.md", "status");
  // ---- B34: gh-36 unfinished round 1, flatten
  const flatten = (n: number, msg: string) => { const r1 = join(S[n].record, "rounds/01-triage"); for (const name of readdirSync(r1)) t.git(["mv", join(r1, name), join(S[n].record, name)], S[n].wt); t.git(["commit", "-q", "-m", msg], S[n].wt); };
  t.report(S[36].runs(), "done", { outcome: "story", handoff: "go" }); await next();
  await t.norn("story", "reject", "gh-36", "--reason", "again"); await next();
  const before36 = st(36);
  flatten(36, "older norn: flat");
  tree(t, "B34.md", S[36].record, "flat record (as an older norn)");
  const commits = Number(t.git(["rev-list", "--count", "HEAD"], S[36].wt));
  const m = await next();
  log("B34.md", "tick", m.decisions.filter((d: any) => d.unit === "gh-36").map((d: any) => d.rule));
  tree(t, "B34.md", S[36].record, "after the tick");
  log("B34.md", "commits", { added: Number(t.git(["rev-list", "--count", "HEAD"], S[36].wt)) - commits, log: t.git(["log", "-3", "--format=%s", "--stat"], S[36].wt), pushed: t.git(["rev-parse", "HEAD"], S[36].wt) === t.git(["ls-remote", "origin", "refs/heads/gh-36-flat-busy"]).split("\t")[0] });
  log("B34.md", "state before/after", { before: { step: before36.step, counters: before36.counters, attempt: before36.attempt }, after: { round: st(36)?.round ?? 1, step: st(36)?.step, counters: st(36)?.counters, attempt: st(36)?.attempt, status: st(36)?.status } });
  // ---- B35: gh-37 finished, flatten
  t.report(S[37].runs(), "done", { outcome: "story", handoff: "go" }); await next();
  await t.norn("story", "approve", "gh-37"); await next();
  flatten(37, "older norn: flat done");
  await next(); await next();
  await cmd(t, "B35.md", "status");
  await cmd(t, "B35.md", "story", "edit", "gh-37", "--workflow", "story");
  await next();
  log("B35.md", "after", { round: st(37)?.round, workflow: st(37)?.workflow, step: st(37)?.step, runs: S[37].runs().replace(t.dir, "<TMP>") });
  // ---- B20: label failure on gh-37 round 3
  // ---- B18: second clone
  const clone = join(t.dir, "clone2"); const home2 = join(t.dir, "home2"); mkdirSync(home2);
  sh(t.dir, ["clone", "-q", t.remoteDir, clone]); sh(clone, ["config", "user.email", "a@x"]); sh(clone, ["config", "user.name", "Ana"]);
  const deps2 = { ...t.deps, cwd: clone, env: { ...t.deps.env, NORN_HOME_DIR: home2, USER: "ana", NORN_MACHINE: "laptop" } };
  const b = async (...argv: string[]) => { const r = await runChecked(argv, deps2); log("B18.md", "(ana@laptop) $ norn " + argv.join(" ") + " (exit " + r.exit + ")", r.stdout.replace(new RegExp(t.dir, "g"), "<TMP>")); return r; };
  await b("story", "edit", "gh-38", "--workflow", "story");
  await b("story", "edit", "gh-38", "--workflow", "story", "--force", "--json");
  t.cleanup();
}, 300_000);
