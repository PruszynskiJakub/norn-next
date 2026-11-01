import { test } from "bun:test";
import { join } from "node:path";
import { existsSync, readFileSync, readdirSync, cpSync, writeFileSync, mkdirSync } from "node:fs";
import { setup, issue, storyUnitDir, cmd, log, tree } from "./common.ts";
import { runChecked, sh } from "/Users/jakubpruszynski/Projects/norn-worktrees/gh-71-approving-triage-s-confirm-gate-ends-the/test/support/harness.ts";

test("scenario D", async () => {
  const t = await setup();
  const mk = (n: number, slug: string) => { const spec = `.agents/specs/gh-${n}-${slug}`; const wt = `${t.root}-worktrees/gh-${n}-${slug}`; return { spec, wt, record: join(wt, spec, "runs/_story"), runs: () => storyUnitDir(join(wt, spec)) }; };
  t.remote.issues = [issue(50, "Held one", ["norn", "norn:wf:triage"]), issue(51, "Label fail", ["norn", "norn:wf:triage"])];
  const S: Record<number, ReturnType<typeof mk>> = { 50: mk(50, "held-one"), 51: mk(51, "label-fail") };
  const F = "D-ticks.md";
  const next = async (...fl: string[]) => { t.clock.advance(10_000); const r = await t.tick(...fl); log(F, "tick " + fl.join(" "), r.decisions.filter((d: any) => d.rule !== "noop").map((d: any) => `${d.unit} ${d.rule} ok=${d.ok} ${d.warnings ? JSON.stringify(d.warnings) : ""}`).join("\n")); return r; };
  const st = (n: number) => t.state(S[n].runs()) as any;
  const until = async (pred: () => boolean, max = 10) => { for (let i = 0; i < max && !pred(); i++) await next(); };
  await until(() => [50, 51].every((n) => st(n)?.status === "running"));
  for (const n of [50, 51]) t.report(S[n].runs(), "done", { outcome: "story", handoff: "go" });
  await next();
  for (const n of [50, 51]) await t.norn("story", "approve", `gh-${n}`);
  await next();
  // B18: ana@laptop with the story's branch checked out
  const bRoot = join(t.dir, "colleague"); const bHome = join(t.dir, "bhome"); mkdirSync(bHome);
  sh(t.dir, ["clone", "-q", t.remoteDir, bRoot]);
  const bWt = `${bRoot}-worktrees/gh-50-held-one`;
  sh(bRoot, ["worktree", "add", "-q", "-b", "gh-50-held-one", bWt, "origin/gh-50-held-one"]);
  writeFileSync(join(bWt, ".norn-unit"), `repo=${bRoot}\nstory=gh-50\nslice=\nunit=_story\nspec_dir=${S[50].spec}\n`);
  const deps2 = { ...t.deps, cwd: bRoot, env: { ...t.deps.env, NORN_HOME_DIR: bHome, USER: "ana", NORN_MACHINE: "laptop" } };
  const b = async (...argv: string[]) => { const r = await runChecked(argv, deps2); log("B18.md", "(ana@laptop, story branch checked out) $ norn " + argv.join(" ") + " (exit " + r.exit + ")", r.stdout.replace(new RegExp(t.dir, "g"), "<TMP>")); return r; };
  const mailbox = t.git(["ls-remote", "origin", "refs/norn/inbox/*"]);
  await b("story", "edit", "gh-50", "--workflow", "story");
  await b("story", "edit", "gh-50", "--workflow", "story", "--force", "--json");
  log("B18.md", "mailbox refs unchanged", String(t.git(["ls-remote", "origin", "refs/norn/inbox/*"]) === mailbox));
  await next();
  log("B18.md", "holder's story unchanged", { round: st(50)?.round ?? 1, step: st(50)?.step });
  // B19 negative: edit the label on the remote
  t.remote.issues = t.remote.issues.map((i) => (i.number === 50 ? { ...i, labels: ["norn", "norn:wf:quick"] } : i));
  for (let i = 0; i < 2; i++) await next("--sync");
  log("B19.md", "gh-50 after norn:wf:quick put on the issue by hand (2 syncs)", { round: st(50)?.round ?? 1, workflow: st(50)?.workflow, step: st(50)?.step, labelCalls: t.remote.calls.filter((c) => c.startsWith("label ")) });
  // B20: label failure
  await t.norn("story", "edit", "gh-51", "--workflow", "story");
  t.remote.labelError = new Error("gh: could not connect");
  const r = await next();
  t.remote.labelError = null;
  log("B20.md", "round.start decision", r.decisions.filter((d: any) => d.unit === "gh-51").map((d: any) => ({ rule: d.rule, ok: d.ok, warnings: d.warnings })));
  log("B20.md", "tick JSON output failed count", (r as any).failed);
  log("B20.md", "gh-51 state", { round: st(51)?.round, workflow: st(51)?.workflow, step: st(51)?.step });
  log("B20.md", "issue labels", t.remote.issues.find((i) => i.number === 51)?.labels);
  const traceDir = join(t.home);
  log("B20.md", "trace lines carrying the warning", Bun.spawnSync(["grep", "-rho", "label norn:wf:triage → norn:wf:story not updated[^\"]*", traceDir]).stdout.toString());
  // B36: a flat record merged into main
  const old = join(t.root, ".agents/specs/gh-90-old-one");
  mkdirSync(join(old, "runs/_story"), { recursive: true });
  const r1 = join(S[50].record, "rounds/01-triage");
  for (const name of readdirSync(r1)) cpSync(join(r1, name), join(old, "runs/_story", name), { recursive: true });
  cpSync(join(S[50].record, "handoff.md"), join(old, "runs/_story/handoff.md"));
  const specText = readFileSync(join(S[50].wt, S[50].spec, "spec.md"), "utf8").replace(/gh-50/g, "gh-90").replace(/held-one/g, "old-one").replace(/number: 50/, "number: 90").replace(/status: active/, "status: done");
  writeFileSync(join(old, "spec.md"), specText);
  for (const f of readdirSync(join(old, "runs/_story/receipts"))) { const p = join(old, "runs/_story/receipts", f); writeFileSync(p, readFileSync(p, "utf8").replace(/gh-50/g, "gh-90")); }
  writeFileSync(join(old, "runs/_story/state.json"), readFileSync(join(old, "runs/_story/state.json"), "utf8").replace(/gh-50/g, "gh-90"));
  t.git(["add", "-A"]); t.git(["commit", "-q", "-m", "old story gh-90 merged (flat record)"]); t.git(["push", "-q", "origin", "main"]);
  tree(t, "B36.md", join(old, "runs"), "flat record on main");
  const head = t.git(["rev-parse", "HEAD"]);
  await cmd(t, "B36.md", "run", "list", "gh-90");
  await cmd(t, "B36.md", "run", "view", "gh-90");
  log("B36.md", "main unchanged / tree clean", { head: t.git(["rev-parse", "HEAD"]) === head, remoteMain: t.git(["ls-remote", "origin", "refs/heads/main"]).startsWith(head), status: t.git(["status", "--porcelain"]) || "(clean)" });
  tree(t, "B36.md", join(old, "runs"), "flat record after the commands");
  t.cleanup();
}, 300_000);
