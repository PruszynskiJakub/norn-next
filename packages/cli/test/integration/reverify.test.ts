/**
 * Re-verify on real git: a story waiting at `ready` whose base moves without a conflict runs the
 * workflow's `base.verify` check detached, in a temporary worktree of the merge of the base into
 * the story head, once per (head, base sha). Nothing is pushed and no PR or approval is asked for;
 * green leaves the story waiting, red sends it through `update` with the failure on record.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type CheckOrder, type ReceiptOf, SPECS_DIR } from "@norn/schema";
import { listReceipts, workflowsDir } from "@norn/store";
import type { TickReport } from "../../src/index.ts";
import { createHarness, type Harness, installBundledSkills, issue, sh } from "../../../../test/support/harness.ts";
import { runStateOf } from "../../../../test/support/run-state.ts";

setDefaultTimeout(30_000);

const HELD = `name: held
start: ready
steps:
  ready:
    type: gate
    outcomes:
      approve: $done
      reject: $stuck
      stale: { to: update, counter: stale_loop }
  update:
    type: git
    action: update
    outcomes: { done: test, conflict: $stuck }
  test:
    type: check
    run: 'pwd > "$NORN_HOME/verify-cwd"; ls; if [ -e breaks.txt ]; then echo "breaks.txt is on the base"; exit 1; fi'
    timeout: 1m
    outcomes: { pass: ready, fail: $stuck }
counters: { stale_loop: { max: 3 } }
base: { stale: conflict, verify: test }
`;

/** A commit on the base, from a clone, then pushed: what another story landed meanwhile. */
function landOnBase(h: Harness, files: Record<string, string>, message: string): string {
  const dir = join(h.dir, `base-${Math.random().toString(36).slice(2)}`);
  sh(h.dir, ["clone", "-q", "-b", "main", h.remoteDir, dir]);
  sh(dir, ["config", "user.email", "s@example.com"]);
  sh(dir, ["config", "user.name", "Sibling"]);
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), text);
  }
  sh(dir, ["add", "-A"]);
  sh(dir, ["commit", "-q", "-m", message]);
  sh(dir, ["push", "-q", "origin", "main"]);
  return sh(dir, ["rev-parse", "HEAD"]);
}

const rules = (r: TickReport) => r.decisions.map((d) => d.rule);

describe("re-verify a story waiting at ready", () => {
  let h: Harness;
  const wt = () => h.worktree("gh-7-add-login-form");
  const runs = () => runStateOf(join(wt(), `${SPECS_DIR}/gh-7-add-login-form`));
  const verifies = () =>
    listReceipts(runs())
      .receipts.map((r) => r.receipt)
      .filter((r): r is ReceiptOf<"check"> => r.kind === "check" && !!r.verify);
  /** every ref on the remote but the base the siblings push to */
  const remoteRefs = () => sh(h.dir, ["ls-remote", h.remoteDir]).split("\n").filter((l) => !/\t(HEAD|refs\/heads\/main)$/.test(l));
  const until = async (pred: () => boolean, label: string, max = 20) => {
    for (let i = 0; i < max && !pred(); i++) {
      h.clock.advance(10_000);
      await h.tick();
    }
    if (!pred()) throw new Error(`${label} not reached: ${JSON.stringify(h.state(runs()))}`);
  };

  beforeAll(async () => {
    h = await createHarness();
    h.config("provider: gh\nworkflow: held\nmode: auto\n");
    h.recordVersion();
    h.write(join(workflowsDir(h.root), "held.yaml"), HELD);
    installBundledSkills(h.root);
    h.git(["add", "-A"]);
    h.git(["commit", "-q", "-m", "norn init"]);
    h.git(["push", "-q", "origin", "main"]);
    h.remote.issues = [issue(7, "Add login form")];
    await h.tick();
    h.clock.advance(10_000);
    await h.tick("--sync");
    await until(() => h.state(runs())?.step === "ready" && h.state(runs())?.status === "parked", "ready");
  });
  afterAll(() => h.cleanup());

  test("a clean base move runs the verify check once on the merged tree in a temporary worktree; green leaves the story waiting, nothing pushed", async () => {
    const head = sh(wt(), ["rev-parse", "HEAD"]);
    const refsBefore = remoteRefs();
    const base = landOnBase(h, { "c.txt": "elsewhere\n" }, "Elsewhere");
    h.clock.advance(10_000);
    const started = await h.norn("tick", "--sync"); // not h.tick(): that waits for `norn check-run`
    expect(rules(started.value as TickReport)).toContain("verify.run");
    const orders = readdirSync(join(h.home, "checks"));
    expect(orders).toHaveLength(1);
    const order = JSON.parse(readFileSync(join(h.home, "checks", orders[0]!), "utf8")) as CheckOrder;
    expect(order.verify).toMatchObject({ head, base });
    expect(order.cwd).not.toBe(wt());
    await h.checksDone();

    // it ran in the merged tree, the base's c.txt there, and the temporary worktree is gone
    const cwd = readFileSync(join(h.root, "verify-cwd"), "utf8").trim();
    expect(cwd).toContain("norn-verify-");
    expect(existsSync(cwd)).toBe(false);
    expect(sh(h.root, ["worktree", "list"])).not.toContain("norn-verify-");
    expect(verifies()).toMatchObject([{ step: "ready", outcome: "pass", verify: { head, base } }]);
    expect(verifies()[0]?.output_tail).toContain("c.txt");

    // applied: still waiting at ready, never ordered again for the same pair; no push, no PR, no approval
    for (let i = 0; i < 3; i++) {
      h.clock.advance(10_000);
      expect(rules(await h.tick())).not.toContain("verify.run");
    }
    expect(h.state(runs())).toMatchObject({ step: "ready", status: "parked", park: { kind: "gate" } });
    expect(verifies()).toHaveLength(1);
    expect(remoteRefs()).toEqual(refsBefore);
    expect(h.remote.prs).toEqual([]);
    expect(listReceipts(runs()).receipts.map((r) => r.receipt.kind)).not.toContain("approve");
  });

  test("a base move the merged tree fails on sends the story through update, the failure on record", async () => {
    const base = landOnBase(h, { "breaks.txt": "renamed under you\n" }, "Rename");
    h.clock.advance(10_000);
    await h.tick("--sync");
    await until(() => verifies().length === 2, "second verify");
    expect(verifies()[1]).toMatchObject({ step: "ready", outcome: "fail", exit_code: 1, verify: { base }, output_tail: expect.stringContaining("breaks.txt is on the base") });
    await until(() => h.state(runs())?.step !== "ready", "stale route");
    expect(h.state(runs())).toMatchObject({ counters: { stale_loop: 1 }, last_outcome: { step: "ready", outcome: "stale" } });
  });
});
