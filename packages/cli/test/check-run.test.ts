/**
 * gh-77: a check step runs in a detached `norn check-run`, not inside the tick (H6, C5, K1).
 * The tick that starts it returns at once; while the command runs, later ticks run (not `busy`),
 * keep the heartbeat fresh (R5.5) and wait on its run lease (`check.running`); the tick after the
 * process ends applies its `check` receipt. A step timeout still kills it as a `fail` with reason `timeout`.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { listReceipts } from "@norn/store";
import type { TickReport } from "../src/index.ts";
import { createHarness, type Harness, installBundledSkills, issue } from "./harness.ts";

const workflow = (run: string, timeout: string) => `name: slow
start: test
steps:
  test:
    type: check
    run: ${run}
    timeout: ${timeout}
    outcomes: { pass: $done, fail: $stuck }
`;
const CONFIG = `agents:
  claude: { adapter: claude }
runner: { adapter: headless }
remote: { provider: gh, label: norn }
default_workflow: slow
default_mode: auto
notifiers: []
watch_interval: 30s
`;

const acts = (r: TickReport) => r.decisions.filter((d) => d.kind !== "noop" && d.rule !== "claim.renew").map((d) => d.kind);
const rules = (r: TickReport) => r.decisions.map((d) => d.rule);

/** A harness whose one story sits at a check step running `run`. */
async function atCheck(run: string, timeout: string): Promise<{ h: Harness; runsDir: string }> {
  const h = await createHarness();
  h.write(join(h.root, ".agents/norn/config.yaml"), CONFIG);
  h.write(join(h.root, ".agents/norn/workflows/slow.yaml"), workflow(run, timeout));
  installBundledSkills(h.root);
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn init"]);
  h.git(["push", "-q", "origin", "main"]);
  h.remote.issues = [issue(9, "Slow check")];
  for (let i = 0; i < 5; i++) {
    h.clock.advance(10_000);
    if (acts(await h.tick()).includes("start_unit")) {
      const runsDir = join(`${h.root}-worktrees`, "gh-9-slow-check/.agents/specs/gh-9-slow-check/runs/_story");
      return { h, runsDir };
    }
  }
  throw new Error("story did not start");
}

const checks = (runsDir: string) => listReceipts(runsDir).receipts.filter((r) => r.receipt.kind === "check").map((r) => r.receipt);

describe("a long check (gh-77)", () => {
  let h: Harness;
  let runsDir: string;
  beforeAll(async () => ({ h, runsDir } = await atCheck("sleep 3 && echo checked", "1m")));
  afterAll(() => h.cleanup());

  test("the tick that starts it returns at once; ticks and the heartbeat go on while it runs; the receipt lands after", async () => {
    h.clock.advance(10_000);
    const started = await h.norn("tick"); // not h.tick(): that waits for `norn check-run`
    expect(started.exit).toBe(0);
    const r = started.value as TickReport;
    expect(acts(r)).toEqual(["run_check"]);
    expect(r.duration_ms).toBeLessThan(2500); // the command alone takes 3 s

    // the watch loop's next tick, 3 × watch_interval later: not busy, and the heartbeat is up
    h.clock.advance(100_000);
    const during = await h.norn("tick");
    expect(during.exit).toBe(0);
    expect(rules(during.value as TickReport)).toContain("check.running");
    const inbox = (await h.norn("inbox", "--json")).value as { groups: { unblock: Array<{ title: string }>; running: Array<{ title: string }> } };
    expect(inbox.groups.unblock.map((i) => i.title)).not.toContainEqual(expect.stringContaining("no heartbeat"));
    expect(inbox.groups.running.map((i) => i.title)).toContain("test #1 (check running)");
    expect(checks(runsDir)).toEqual([]);

    await h.checksDone();
    expect(checks(runsDir)).toMatchObject([{ outcome: "pass", exit_code: 0, output_tail: "checked", tick_id: r.tick_id }]);
    h.clock.advance(10_000);
    expect(acts(await h.tick())).toEqual(["apply_receipts"]);
    expect(h.state(runsDir)).toMatchObject({ status: "done", last_outcome: { step: "test", outcome: "pass" } });
  }, 20_000);
});

describe("a check past its step timeout (C5)", () => {
  let h: Harness;
  let runsDir: string;
  beforeAll(async () => ({ h, runsDir } = await atCheck("sleep 30", "1s")));
  afterAll(() => h.cleanup());

  test("norn check-run kills it and writes a fail with reason timeout", async () => {
    h.clock.advance(10_000);
    expect(acts(await h.tick())).toEqual(["run_check"]);
    expect(checks(runsDir)).toMatchObject([{ outcome: "fail", exit_code: null, reason: "timeout" }]);
  }, 20_000);
});
