import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { workflowsDir } from "/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-337-a-base-move-under-a-story-costs-a-whole/packages/store/src/index.ts";
import { headsRef } from "/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-337-a-base-move-under-a-story-costs-a-whole/packages/schema/src/index.ts";
import { createHarness, type Harness, installBundledSkills, issue, sh } from "/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-337-a-base-move-under-a-story-costs-a-whole/test/support/harness.ts";
import { runStateOf } from "/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-337-a-base-move-under-a-story-costs-a-whole/test/support/run-state.ts";
setDefaultTimeout(120_000);
const REL = `name: rel
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
      reject: { to: open-pr, counter: loop }
counters: { loop: { max: 3 } }
`;
let h: Harness;
afterAll(() => h?.cleanup());
test("QA: merged-PR cleanup removes refs/norn/heads/<story> on the remote", async () => {
  h = await createHarness();
  h.config("provider: gh\nworkflow: rel\nmode: auto\n");
  h.recordVersion();
  h.write(join(workflowsDir(h.root), "rel.yaml"), REL);
  installBundledSkills(h.root);
  writeFileSync(join(h.root, "a.txt"), "one\n");
  h.git(["add", "-A"]); h.git(["commit", "-q", "-m", "norn init"]); h.git(["push", "-q", "origin", "main"]);
  h.remote.issues = [issue(7, "Cut release")];
  const runs = () => runStateOf(join(h.worktree("gh-7-cut-release"), ".agents/specs/gh-7-cut-release"));
  const parked = () => h.state(runs())?.step === "ready" && h.state(runs())?.status === "parked";
  for (let i = 0; i < 20 && !parked(); i++) { h.clock.advance(10_000); await (i === 0 ? h.tick("--sync") : h.tick()); }
  const ls = (ref: string) => sh(h.dir, ["ls-remote", h.remoteDir, ref]).split(/\s+/)[0] || null;
  const before = ls(headsRef("gh-7"));
  console.log("QA heads ref before merge:", before, "branch:", ls("refs/heads/gh-7-cut-release"));
  expect(before).toBeTruthy();
  const land = join(h.dir, "land"); const who = ["-c", "user.email=s@example.com", "-c", "user.name=S"];
  sh(h.dir, ["clone", "-q", h.remoteDir, land]);
  sh(land, [...who, "merge", "-q", "--squash", "origin/gh-7-cut-release"]);
  sh(land, [...who, "commit", "-q", "-m", "Cut release (#100)"]);
  sh(land, ["push", "-q", "origin", "main"]);
  const pr = h.remote.prs[0]!; pr.state = "merged"; pr.is_draft = false; pr.merged_at = new Date(h.clock.now()).toISOString();
  h.clock.advance(10_000);
  const r = await h.tick("--sync");
  console.log("QA rules:", r.decisions.filter((d) => d.kind !== "noop").map((d) => d.unit + " " + d.rule + (d.ok ? "" : " FAILED " + d.error)).join(" | "));
  const after = ls(headsRef("gh-7"));
  console.log("QA heads ref after cleanup:", after);
  expect(after).toBeNull();
});
