/**
 * The command rename keeps everything else (B69, B70): a unit that went stuck under a norn that printed
 * the old names (its recorded tick says `norn unstick`) continues after the upgrade with no migration,
 * and `norn run view --why` on that old tick replays it as a version mismatch — labelled, the diff only
 * the command string — not as a failure.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TickTrace } from "@norn/schema";
import { repoConfigPath, machineDir as machineDirOf, workflowsDir } from "@norn/store";
import { version } from "../package.json";
import { runCli } from "../src/index.ts";
import { createHarness, type Harness, issue } from "./harness.ts";

setDefaultTimeout(30_000);

const FLOW = `name: flow
start: implement
steps:
  implement:
    type: agent
    skill: norn-implement
    outcomes: { done: { to: review, means: "built" } }
  review:
    type: gate
    prompt: "Look at it"
    outcomes: { approve: $done, reject: { to: implement, counter: loop } }
counters: { loop: { max: 2 } }
`;

const CONFIG = `agents:
  claude: { adapter: claude }
runner: { adapter: headless }
remote: { provider: gh, label: norn }
default_workflow: flow
default_mode: auto
notifiers: []
`;

let h: Harness;
const wt = () => `${h.root}-worktrees/gh-5-pay-invoices`;
const runs = () => join(wt(), ".agents/specs/gh-5-pay-invoices/runs/_story");
const machineDir = () => machineDirOf(h.root);
const tick = async () => {
  h.clock.advance(10_000);
  return h.tick();
};

function recordedTick(tickId: string): TickTrace {
  const lines = readdirSync(machineDir())
    .filter((n) => n.endsWith(".jsonl"))
    .flatMap((f) => readFileSync(join(machineDir(), f), "utf8").split("\n").filter(Boolean));
  return lines.map((l) => JSON.parse(l) as TickTrace).find((ev) => ev.type === "tick" && ev.tick_id === tickId) as TickTrace;
}

/** Rewrite one tick record as the norn before the rename would have left it. */
function asRecordedBefore(tickId: string): void {
  for (const f of readdirSync(machineDir()).filter((n) => n.endsWith(".jsonl"))) {
    const path = join(machineDir(), f);
    const out = readFileSync(path, "utf8")
      .split("\n")
      .map((l) => {
        if (!l) return l;
        const ev = JSON.parse(l) as TickTrace;
        if (ev.type !== "tick" || ev.tick_id !== tickId) return l;
        ev.norn_version = "0.9.0";
        return JSON.stringify(ev).replaceAll("norn run rerun gh-5", "norn unstick gh-5");
      });
    writeFileSync(path, out.join("\n"));
  }
}

beforeAll(async () => {
  h = await createHarness();
  expect((await h.norn("init")).exit).toBe(0);
  h.write(repoConfigPath(h.root), CONFIG);
  h.write(join(workflowsDir(h.root), "flow.yaml"), FLOW);
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn init"]);
  h.git(["push", "-q", "origin", "main"]);
  h.remote.issues = [issue(5, "Pay invoices")];
  for (let i = 0; i < 4; i++) await tick();
  expect(h.state(runs())).toMatchObject({ step: "implement", status: "running" });
});
afterAll(() => h.cleanup());

describe("printed commands renamed, nothing else (B69, B70)", () => {
  test("why on a tick recorded before the rename is a labelled version mismatch, its diff only the command", async () => {
    h.report(runs(), "stuck", { reason: "no database" });
    await tick();
    const stuck = await tick();
    expect(stuck.decisions.find((d) => d.unit === "gh-5")).toMatchObject({ rule: "unit.stuck" });
    expect(recordedTick(stuck.tick_id).decisions).toContainEqual(expect.objectContaining({ rule: "unit.stuck", action: expect.objectContaining({ reason: "stuck: no database — norn run rerun gh-5" }) }));
    asRecordedBefore(stuck.tick_id);
    expect(JSON.stringify(recordedTick(stuck.tick_id).decisions)).toContain("stuck: no database — norn unstick gh-5");

    // straight through runCli: the harness refuses any output naming an old command, and this one quotes the old trace
    const r = await runCli(["run", "view", "gh-5", "--why", "--tick", stuck.tick_id], h.deps);
    expect(r.value).not.toHaveProperty("error");
    expect(r.exit).toBe(1); // O5: a replay that differs exits 1, as before the rename
    expect(r.value).toMatchObject({
      tick_id: stuck.tick_id,
      rule: "unit.stuck",
      replay: { matches: false, rule: "unit.stuck", label: `recorded by norn 0.9.0, replayed by norn ${version}`, action: { reason: "stuck: no database — norn run rerun gh-5" } },
    });
    expect(r.stdout).toContain("recorded by norn 0.9.0");
  });

  test("the unit stuck under the old norn continues after the upgrade with no migration", async () => {
    expect(h.state(runs())).toMatchObject({ step: "implement", status: "stuck" });
    const status = await h.norn("status", "--json");
    expect(status.value).toMatchObject({ groups: { unblock: [expect.objectContaining({ story: "gh-5", command: "norn run rerun gh-5" })] } });
    expect((await h.norn("run", "rerun", "gh-5")).exit).toBe(0);
    await tick();
    await tick();
    expect(h.state(runs())).toMatchObject({ step: "implement", status: "running" });
    h.report(runs(), "done", { outcome: "done", handoff: "built" });
    await tick();
    expect(h.state(runs())).toMatchObject({ step: "review", status: "parked", park: { kind: "gate" } });
    expect((await h.norn("status", "--json")).value).toMatchObject({ groups: { approve: [expect.objectContaining({ story: "gh-5", command: "norn story approve gh-5" })] } });
  });
});
