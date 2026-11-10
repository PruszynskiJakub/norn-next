import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { workflowsDir } from "/Users/jakubpruszynski/Projects/norn-worktrees/gh-319-squash-merging-a-release-pr-before-a/packages/store/src/index.ts";
import type { TickReport } from "/Users/jakubpruszynski/Projects/norn-worktrees/gh-319-squash-merging-a-release-pr-before-a/packages/cli/src/index.ts";
import { createHarness, type Harness, installBundledSkills, issue, sh } from "/Users/jakubpruszynski/Projects/norn-worktrees/gh-319-squash-merging-a-release-pr-before-a/test/support/harness.ts";
import { runStateOf } from "/Users/jakubpruszynski/Projects/norn-worktrees/gh-319-squash-merging-a-release-pr-before-a/test/support/run-state.ts";
setDefaultTimeout(60_000);

// ready gate with a stale route after open-pr, base.stale: behind — as release.yaml
const WF = `name: rel
start: update
steps:
  update:
    type: git
    action: update
    outcomes: { done: open-pr, conflict: $stuck }
  open-pr:
    type: git
    action: open-pr
    outcomes: { done: ready }
  ready:
    type: gate
    outcomes:
      approve: $done
      reject: $stuck
      stale: { to: update, counter: stale_loop }
counters: { stale_loop: { max: 3 } }
base: { stale: behind }
`;
const kinds = (r: TickReport) => r.decisions.filter((d) => d.kind !== "noop" && d.rule !== "claim.renew").map((d) => `${d.unit} ${d.rule}${d.ok ? "" : " FAILED " + d.error}`);

let h: Harness;
const wt = () => `${h.root}-worktrees/gh-7-cut-release`;
const runs = () => runStateOf(join(wt(), ".agents/specs/gh-7-cut-release"));
beforeAll(async () => {
  h = await createHarness();
  h.config("provider: gh\nworkflow: rel\nmode: auto\n");
  h.write(join(workflowsDir(h.root), "rel.yaml"), WF);
  installBundledSkills(h.root);
  writeFileSync(join(h.root, "a.txt"), "one\n");
  h.git(["add", "-A"]); h.git(["commit", "-q", "-m", "norn init"]); h.git(["push", "-q", "origin", "main"]);
  h.remote.issues = [issue(7, "Cut release")];
});
afterAll(() => h.cleanup());

test("a squash-merged story PR at a stale-routed gate ends the story, never a second PR", async () => {
  const seen: string[] = [];
  for (let i = 0; i < 20 && !(h.state(runs())?.step === "ready" && h.state(runs())?.status === "parked"); i++) {
    h.clock.advance(10_000); seen.push(...kinds(await (i === 0 ? h.tick("--sync") : h.tick())));
  }
  expect(h.state(runs())).toMatchObject({ step: "ready", status: "parked" });
  expect(h.remote.prs).toHaveLength(1);
  // the person squash-merges PR #100 into main on the remote
  const land = join(h.dir, "land");
  sh(h.dir, ["clone", "-q", h.remoteDir, land]);
  sh(land, ["-c", "user.email=s@example.com", "-c", "user.name=S", ...(process.env.MERGE === "merge" ? ["merge", "-q", "--no-ff", "-m", "Merge #100", "origin/gh-7-cut-release"] : ["merge", "-q", "--squash", "origin/gh-7-cut-release"])]);
  if (process.env.MERGE !== "merge") sh(land, ["-c", "user.email=s@example.com", "-c", "user.name=S", "commit", "-q", "-m", "Cut release (#100)"]);
  sh(land, ["push", "-q", "origin", "main"]);
  const pr = h.remote.prs[0]!; pr.state = "merged"; pr.merged_at = new Date(h.clock.now()).toISOString();
  // between syncs something fetches the base (another story's update, a merged record, a person's git fetch)
  if (process.env.TICK !== "sync") h.git(["fetch", "-q", "origin", "+refs/heads/main:refs/remotes/origin/main"]);
  // non-sync ticks
  const after: string[] = [];
  for (let i = 0; i < 6; i++) { h.clock.advance(10_000); after.push(...kinds(await (process.env.TICK === "sync" && i === 0 ? h.tick("--sync") : h.tick()))); }
  if (process.env.LATER_SYNC) { h.clock.advance(10_000); after.push("--sync--", ...kinds(await h.tick("--sync"))); }
  console.log("[ticks after squash]\n" + after.join("\n"));
  console.log("[state]", JSON.stringify({ step: h.state(runs())?.step, status: h.state(runs())?.status }), "[prs]", h.remote.prs.map((p) => `#${p.number} ${p.state}`).join(", "));
  expect(after).not.toContain("gh-7 gate.stale");
  expect(h.remote.prs).toHaveLength(1);
});
