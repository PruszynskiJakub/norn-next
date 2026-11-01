import { test } from "bun:test";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { setup, issue, storyUnitDir, cmd, log } from "./common.ts";
import { sh } from "../../../../../../../Users/jakubpruszynski/Projects/norn-worktrees/gh-71-approving-triage-s-confirm-gate-ends-the/test/support/harness.ts";

test("scenario C", async () => {
  const t = await setup();
  const mk = (n: number, slug: string) => { const spec = `.agents/specs/gh-${n}-${slug}`; const wt = `${t.root}-worktrees/gh-${n}-${slug}`; return { spec, wt, record: join(wt, spec, "runs/_story"), runs: () => storyUnitDir(join(wt, spec)) }; };
  t.remote.issues = [issue(40, "Close me"), issue(41, "Busy closed"), issue(42, "Pr one")];
  const S: Record<number, ReturnType<typeof mk>> = { 40: mk(40, "close-me"), 41: mk(41, "busy-closed"), 42: mk(42, "pr-one") };
  const F = "C-ticks.md";
  const next = async (...fl: string[]) => { t.clock.advance(10_000); const r = await t.tick(...fl); log(F, "tick " + fl.join(" "), r.decisions.filter((d: any) => d.rule !== "noop").map((d: any) => `${d.unit} ${d.rule} ok=${d.ok}`).join("\n")); return r; };
  const st = (n: number) => t.state(S[n].runs()) as any;
  const until = async (pred: () => boolean, max = 10) => { for (let i = 0; i < max && !pred(); i++) await next(); };
  await until(() => [40, 41, 42].every((n) => st(n)?.status === "running"));
  for (const n of [40, 41, 42]) t.report(S[n].runs(), "done", { outcome: n === 40 ? "close" : "story", handoff: "go" });
  await next();
  await t.norn("story", "approve", "gh-40");
  await next();
  log("B22-C.md", "gh-40 before close", { round: st(40)?.round ?? 1, step: st(40)?.step, status: st(40)?.status });
  // B22
  t.remote.issues = t.remote.issues.map((i) => (i.number === 40 || i.number === 41 ? { ...i, state: "closed" } : i));
  for (let i = 0; i < 3; i++) { const r = await next("--sync"); log("B22-C.md", "tick --sync decisions (gh-40, gh-41)", r.decisions.filter((d: any) => ["gh-40", "gh-41"].includes(d.unit)).map((d: any) => `${d.unit} ${d.rule} ok=${d.ok} ${d.detail ?? ""}`)); }
  log("B22-C.md", "after", { worktree: existsSync(S[40].wt), localBranch: t.git(["branch", "--list", "gh-40-close-me"]), remoteBranch: t.git(["ls-remote", "origin", "refs/heads/gh-40-close-me"]), claim: t.git(["ls-remote", "origin", "refs/norn/claims/gh-40"]) });
  try { log("B22-C.md", "spec.md status on pushed branch", sh(t.dir, ["--git-dir", t.remoteDir, "show", "gh-40-close-me:" + S[40].spec + "/spec.md"]).match(/status: \w+/)?.[0]); } catch (e) { log("B22-C.md", "pushed branch", String(e)); }
  await cmd(t, "B22-C.md", "status");
  log("B24-C.md", "gh-41 (unfinished at confirm, issue closed)", { step: st(41)?.step, status: st(41)?.status, park: st(41)?.park });
  await cmd(t, "B24-C.md", "status");
  // B23
  t.remote.issues = t.remote.issues.map((i) => (i.number === 40 ? { ...i, state: "open" } : i));
  await cmd(t, "B23-C.md", "story", "reopen", "gh-40");
  for (let i = 0; i < 3; i++) await next();
  log("B23-C.md", "after reopen", { exists: existsSync(S[40].wt), round: st(40)?.round ?? 1, step: st(40)?.step, status: st(40)?.status });
  await cmd(t, "B23-C.md", "status");
  await cmd(t, "B23-C.md", "story", "edit", "gh-40", "--workflow", "story");
  await next();
  log("B23-C.md", "after edit + tick", { round: st(40)?.round, workflow: st(40)?.workflow, step: st(40)?.step });
  // B27 / B21 on gh-42
  await t.norn("story", "approve", "gh-42"); await next();
  await t.norn("story", "edit", "gh-42", "--workflow", "quick", "--at", "work"); await next();
  await until(() => st(42)?.status === "running");
  t.write(join(S[42].wt, "r2.txt"), "two\n"); t.git(["add", "r2.txt"], S[42].wt); t.git(["commit", "-q", "-m", "round 2"], S[42].wt);
  t.report(S[42].runs(), "done", { outcome: "done", handoff: "changed" });
  await until(() => st(42)?.step === "ready");
  await t.norn("story", "approve", "gh-42"); await next();
  log("B27-C.md", "gh-42 round 2", { round: st(42)?.round, step: st(42)?.step, prs: t.remote.prs.map((p) => `#${p.number} ${p.state} ${p.head}`) });
  await cmd(t, "B27-C.md", "status");
  await next("--sync");
  await cmd(t, "B27-C.md", "status");
  await cmd(t, "B27-C.md", "status", "--json");
  // B21: round 3 then merge after approving
  await t.norn("story", "edit", "gh-42", "--workflow", "quick", "--at", "work"); await next();
  log("B21-C.md", "gh-42", { round: st(42)?.round, step: st(42)?.step });
  await until(() => st(42)?.status === "running");
  t.report(S[42].runs(), "done", { outcome: "done", handoff: "again" });
  await until(() => st(42)?.step === "ready");
  await t.norn("story", "approve", "gh-42"); await next();
  log("B21-C.md", "gh-42 before merge", { round: st(42)?.round, step: st(42)?.step });
  Object.assign(t.remote.prs[0], { state: "merged", merged_at: t.clock.iso() });
  for (let i = 0; i < 2; i++) { const r = await next("--sync"); log("B21-C.md", "tick --sync gh-42", r.decisions.filter((d: any) => d.unit === "gh-42").map((d: any) => d.rule)); }
  log("B21-C.md", "after merge", { worktree: existsSync(S[42].wt), claim: t.git(["ls-remote", "origin", "refs/norn/claims/gh-42"]) });
  await cmd(t, "B21-C.md", "status");
  t.cleanup();
}, 300_000);
