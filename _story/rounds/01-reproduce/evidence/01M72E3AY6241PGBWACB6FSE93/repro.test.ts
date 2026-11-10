// Throwaway repro for gh-294: a round reaches $done, the clean watch exit releases the claim,
// the PR merges afterwards. Expected: a sync records the story done. Observed: story.finished noop.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { workflowsDir } from "<worktree>/packages/store/src/index.ts";
import type { TickReport } from "<worktree>/packages/cli/src/index.ts";
import { createHarness, type Harness, issue, runChecked } from "<worktree>/test/support/harness.ts";
import { runStateOf } from "<worktree>/test/support/run-state.ts";
setDefaultTimeout(60_000);

const SOLO = `name: solo\nstart: implement\nsteps:\n  implement:\n    type: agent\n    skill: norn-implement\n    outcomes: { done: $done }\n`;
let h: Harness;
const wt = () => `${h.root}-worktrees/gh-9-fix-the-bug`;
const runs = () => runStateOf(join(wt(), ".agents/specs/gh-9-fix-the-bug"));
const rules = (r: TickReport) => r.decisions.filter((d) => d.unit === "gh-9").map((d) => `${d.kind} ${d.rule}`);
beforeAll(async () => { h = await createHarness(); });
afterAll(() => h.cleanup());

test("gh-294: PR merged after the round finished and the claim was released → recorded done", async () => {
  expect((await h.norn("init")).exit).toBe(0);
  h.config("provider: gh\nworkflow: solo\nmode: auto\n");
  h.write(join(workflowsDir(h.root), "solo.yaml"), SOLO);
  h.git(["add", "-A"]); h.git(["commit", "-q", "-m", "norn"]); h.git(["push", "-q", "origin", "main"]);
  h.remote.issues = [issue(9, "Fix the bug")];
  await h.tick(); h.clock.advance(1000); await h.tick(); h.clock.advance(1000); await h.tick();
  h.report(runs(), "done", { outcome: "done", handoff: "fixed" });
  h.clock.advance(10_000); await h.tick();
  expect(h.state(runs())).toMatchObject({ step: "$done", status: "done" });
  // watch's clean exit (as on a self-upgrade restart) releases the claim
  const w = await runChecked(["watch", "--interval", "1ms", "--max-ticks", "1"], { ...h.deps, log: () => {} });
  console.log("watch released:", JSON.stringify((w.value as any).released));
  expect(h.git(["ls-remote", "origin", "refs/norn/claims/gh-9"])).toBe("");
  // the PR merges and the issue closes after the round finished
  h.remote.prs = [{ number: 1, url: "u", state: "merged", is_draft: false, head_sha: "", head: "gh-9-fix-the-bug", base_branch: "main", merged_at: h.clock.iso() }];
  h.remote.issues = h.remote.issues.map((i) => ({ ...i, state: "closed" as const }));
  h.clock.advance(60_000);
  const s = (await h.norn("sync")).value as TickReport;
  console.log("sync decisions gh-9:", JSON.stringify(s.decisions.filter((d) => d.unit === "gh-9")));
  console.log("worktree spec status:", readFileSync(join(wt(), ".agents/specs/gh-9-fix-the-bug/spec.md"), "utf8").match(/^status: .*/m)?.[0]);
  h.clock.advance(60_000);
  const t = await h.tick();
  console.log("next tick gh-9:", JSON.stringify(rules(t)));
  const st = await h.norn("status");
  console.log("status:\n" + st.stdout);
  expect(rules(s)).toContain("cleanup_merged_story remote.pr_merged");
  expect(existsSync(wt())).toBe(false);
});
