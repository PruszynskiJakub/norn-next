/**
 * A story waiting at a merge step, through the cli on real git: approve and reject are refused
 * there, and `norn story update-branch` brings the base in as at a gate.
 */
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { workflowsDir } from "@norn/store";
import { createHarness, type Harness, issue } from "../../../../test/support/harness.ts";
import { runStateOf } from "../../../../test/support/run-state.ts";

setDefaultTimeout(30_000);

const MERGING = `name: merging
start: work
steps:
  work:
    type: agent
    skill: norn-implement
    outcomes: { done: { to: ready, means: "the change is ready to look at" } }
  ready:
    type: gate
    outcomes: { approve: merge, reject: { to: work, counter: loop } }
  merge:
    type: merge
    outcomes: { stale: { to: update, counter: stale_loop } }
  update:
    type: git
    action: update
    outcomes: { done: ready, conflict: $stuck }
counters: { loop: { max: 2 }, stale_loop: { max: 3 } }
`;

let h: Harness;
const SLUG = "gh-1-pay-invoices";
const runs = () => runStateOf(join(h.worktree(SLUG), `.agents/specs/${SLUG}`));
const until = async (done: () => boolean) => {
  for (let i = 0; i < 8 && !done(); i++) {
    h.clock.advance(10_000);
    await h.tick();
  }
  expect(done()).toBe(true);
};

beforeAll(async () => {
  h = await createHarness();
  expect((await h.norn("init")).exit).toBe(0);
  h.config("provider: gh\nworkflow: merging\nmode: auto\n");
  h.write(join(workflowsDir(h.root), "merging.yaml"), MERGING);
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn init"]);
  h.git(["push", "-q", "origin", "main"]);
  h.remote.issues = [issue(1, "Pay invoices")];
  await h.tick("--sync");
  await until(() => h.state(runs())?.status === "running");
  h.report(runs(), "done", { outcome: "done", handoff: "ready" });
  await until(() => h.state(runs())?.park?.kind === "gate");
  expect((await h.norn("story", "approve", "gh-1")).exit).toBe(0);
  await until(() => h.state(runs())?.park?.kind === "merge");
});
afterAll(() => h.cleanup());

test("approve and reject at the merge step are refused; the story stays there", async () => {
  for (const argv of [["story", "approve", "gh-1"], ["story", "reject", "gh-1", "--reason", "x"]]) {
    const r = await h.norn(...argv);
    expect([argv, r.exit]).toEqual([argv, 3]);
    expect(r.value).toMatchObject({ code: "not_at_gate", error: expect.stringContaining("merge is a merge step") });
  }
  expect(h.state(runs())).toMatchObject({ step: "merge", status: "parked" });
});

test("story update-branch sends a story waiting at the merge step back through update", async () => {
  const r = await h.norn("story", "update-branch", "gh-1");
  expect(r.exit).toBe(0);
  expect(r.value).toMatchObject({ receipt: { kind: "update", from: "merge", to: "update" } });
  await until(() => h.state(runs())?.step !== "merge");
  expect(h.state(runs())?.visits.update).toBe(1);
});
