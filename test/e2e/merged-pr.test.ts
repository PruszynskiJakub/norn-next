/**
 * A story whose own PR merged on the remote ends through the merge path, never by reworking it and
 * opening a second PR: a squash merge fetched between syncs holds a stale-routed gate until a sync
 * shows the PR merged, and an `open-pr` step that finds the branch's PR merged opens no other.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { workflowsDir } from "@norn/store";
import type { TickReport } from "../../packages/cli/src/index.ts";
import { createHarness, type Harness, installBundledSkills, issue, sh } from "../support/harness.ts";
import { runStateOf } from "../support/run-state.ts";

// whole flows over real git, several ticks each
setDefaultTimeout(60_000);

// a gate with a `stale` route after open-pr, stale when merely behind: the shape of release.yaml
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
      stale: { to: update, counter: stale_loop }
counters: { stale_loop: { max: 3 }, loop: { max: 3 } }
base: { stale: behind }
`;

const kinds = (r: TickReport) => r.decisions.filter((d) => d.kind !== "noop" && d.rule !== "claim.renew").map((d) => `${d.unit} ${d.rule}${d.ok ? "" : ` FAILED ${d.error}`}`);
const rules = (r: TickReport) => r.decisions.map((d) => `${d.unit} ${d.rule}`);

async function parkedAtReady(): Promise<{ h: Harness; runs: () => string }> {
  const h = await createHarness();
  h.config("provider: gh\nworkflow: rel\nmode: auto\n");
  h.write(join(workflowsDir(h.root), "rel.yaml"), REL);
  installBundledSkills(h.root);
  writeFileSync(join(h.root, "a.txt"), "one\n");
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn init"]);
  h.git(["push", "-q", "origin", "main"]);
  h.remote.issues = [issue(7, "Cut release")];
  const runs = () => runStateOf(join(`${h.root}-worktrees/gh-7-cut-release`, ".agents/specs/gh-7-cut-release"));
  const parked = () => h.state(runs())?.step === "ready" && h.state(runs())?.status === "parked";
  for (let i = 0; i < 20 && !parked(); i++) {
    h.clock.advance(10_000);
    await (i === 0 ? h.tick("--sync") : h.tick());
  }
  expect(h.state(runs())).toMatchObject({ step: "ready", status: "parked" });
  expect(h.remote.prs).toHaveLength(1);
  return { h, runs };
}

/** the person squash-merges the story's PR into main on the remote */
function squashMerge(h: Harness): void {
  const land = join(h.dir, "land");
  const who = ["-c", "user.email=s@example.com", "-c", "user.name=S"];
  sh(h.dir, ["clone", "-q", h.remoteDir, land]);
  sh(land, [...who, "merge", "-q", "--squash", "origin/gh-7-cut-release"]);
  sh(land, [...who, "commit", "-q", "-m", "Cut release (#100)"]);
  sh(land, ["push", "-q", "origin", "main"]);
  const pr = h.remote.prs[0]!;
  pr.state = "merged";
  pr.is_draft = false;
  pr.merged_at = new Date(h.clock.now()).toISOString();
}

describe("a story PR merged on the remote", () => {
  let h: Harness;
  afterAll(() => h?.cleanup());

  test("squash-merged and the base fetched between syncs: the stale gate waits for the sync, which ends the story; no second PR", async () => {
    const s = await parkedAtReady();
    h = s.h;
    squashMerge(h);
    // between syncs something else fetches the base (another story's update, a merged record, a person's git fetch)
    h.git(["fetch", "-q", "origin", "+refs/heads/main:refs/remotes/origin/main"]);
    const between: string[] = [];
    for (let i = 0; i < 4; i++) {
      h.clock.advance(10_000);
      between.push(...rules(await h.tick()));
    }
    expect(between).toContain("gh-7 gate.stale.awaits_sync");
    expect(between).not.toContain("gh-7 gate.stale");
    expect(h.state(s.runs())).toMatchObject({ step: "ready", status: "parked" });
    // the sync shows the PR merged: the merge path ends the story
    h.clock.advance(10_000);
    expect(kinds(await h.tick("--sync"))).toContain("gh-7 remote.pr_merged");
    expect(h.remote.prs.map((p) => `#${p.number} ${p.state}`)).toEqual(["#100 merged"]);
  });
});

describe("open-pr finding the branch's PR merged", () => {
  let h: Harness;
  afterAll(() => h?.cleanup());

  test("opens no second PR and fails the effect; the next sync ends the story", async () => {
    const s = await parkedAtReady();
    h = s.h;
    squashMerge(h);
    // a rejection sends the story back to open-pr before any sync sees the merge
    expect((await h.norn("story", "reject", "gh-7", "--reason", "redo the body")).exit).toBe(0);
    const after: string[] = [];
    for (let i = 0; i < 3; i++) {
      h.clock.advance(10_000);
      after.push(...kinds(await h.tick()));
    }
    expect(after.some((k) => k.startsWith("gh-7 git.open-pr FAILED PR #100 of gh-7-cut-release is already merged"))).toBe(true);
    expect(h.remote.prs).toHaveLength(1);
    h.clock.advance(10_000);
    expect(kinds(await h.tick("--sync"))).toContain("gh-7 remote.pr_merged");
    expect(h.remote.prs.map((p) => `#${p.number} ${p.state}`)).toEqual(["#100 merged"]);
  });
});
