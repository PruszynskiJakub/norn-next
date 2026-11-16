/**
 * A counter derived from its edge, on a running unit: `norn status` and `norn story view` list it
 * under its name with its max, `norn run rerun --reset` takes the name, an unknown one is refused
 * with the counters the unit has, and a unit pinned with a named counter keeps that name after its
 * workflow file drops it.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { RunnerPort } from "@norn/core";
import type { UnitState } from "@norn/schema";
import { workflowsDir } from "@norn/store";
import type { CliDeps, CliResult } from "../../src/index.ts";
import { createHarness, FakeRunner, type Harness, hostEnv, issue, runChecked, sh } from "../../../../test/support/harness.ts";
import { runStateOf } from "../../../../test/support/run-state.ts";

setDefaultTimeout(60_000);

/** review's send-back is left to its default: `review.changes_requested`, max 3. */
const FLOW = `name: flow
start: implement
steps:
  implement:
    agent: Use the \`norn-implement\` skill.
    skills: [norn-implement]
    outcomes: { done: review }
    means: { done: "built" }
  review:
    agent: Use the \`norn-review\` skill.
    skills: [norn-review]
    outcomes: { approve: $done, changes_requested: implement }
    means: { approve: "good", changes_requested: "rework" }
`;
/** The same loop as a workflow written before counters were derived: a named counter of the same max. */
const OLD = FLOW.replace("name: flow", "name: old")
  .replace("changes_requested: implement }", "changes_requested: { to: implement, counter: ready_loop } }")
  .concat("counters: { ready_loop: { max: 3 } }\n");

let h: Harness;
const DERIVED = { key: "gh-5", dir: "gh-5-pay-invoices" };
const NAMED = { key: "gh-6", dir: "gh-6-pay-refunds" };
const runs = (u: { dir: string }) => runStateOf(join(h.worktree(u.dir), `.agents/specs/${u.dir}`));
const state = (u: { dir: string }) => h.state(runs(u));
const tick = async () => {
  h.clock.advance(10_000);
  return h.tick();
};
/** Tick until the unit's state matches, or fail with the state it reached. */
async function until(u: { dir: string }, ok: (st: UnitState) => boolean) {
  for (let i = 0; i < 10 && !(state(u) && ok(state(u)!)); i++) await tick();
  expect(state(u) && ok(state(u)!) ? "reached" : state(u)).toBe("reached");
}
const running = (step: string, attempt: number) => (st: UnitState) => st.step === step && st.attempt === attempt && st.status === "running";
const commit = (msg: string) => {
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", msg]);
  h.git(["push", "-q", "origin", "main"]);
};
const refused = (r: CliResult, code: string) => {
  expect(r.exit).toBe(3);
  expect(r.value).toMatchObject({ code });
  return r.value as { error: string; do_instead: string };
};
/** The line that shows the unit's step and counters. */
const lineOf = (text: string, key: string) => text.split("\n").find((l) => l.includes(`${key} `) && l.includes("[")) ?? "";
/** Another machine that holds neither story: its own clone, norn home, user and machine name. */
function otherMachine(): (...argv: string[]) => Promise<CliResult> {
  const root = join(h.dir, "repo-b");
  sh(h.dir, ["clone", "-q", h.remoteDir, root]);
  sh(root, ["config", "user.email", "bob@example.com"]);
  sh(root, ["config", "user.name", "bob"]);
  const home = join(h.dir, "home-b");
  mkdirSync(home);
  const deps: CliDeps = {
    cwd: root,
    env: { ...hostEnv(), NORN_HOME_DIR: home, USER: "bob", NORN_MACHINE: "repo-b", NORN_HOOK_COMMAND: "norn hook" },
    clock: h.clock,
    ports: { remote: h.remote, runner: new FakeRunner() as RunnerPort, notifiers: [] },
  };
  return (...argv) => runChecked(argv, deps);
}
let B: (...argv: string[]) => Promise<CliResult>;

beforeAll(async () => {
  h = await createHarness();
  expect((await h.norn("init")).exit).toBe(0);
  h.config("provider: gh\nworkflow: old\nmode: auto\nrecord:\n  policy: remote\n");
  h.recordVersion();
  h.write(join(workflowsDir(h.root), "flow.yaml"), FLOW);
  h.write(join(workflowsDir(h.root), "old.yaml"), OLD);
  commit("norn init");
  // the named-counter unit is pinned first, then its workflow file is rewritten to derive the counter
  h.remote.issues = [issue(6, "Pay refunds")];
  await until(NAMED, running("implement", 1));
  h.write(join(workflowsDir(h.root), "old.yaml"), FLOW.replace("name: flow", "name: old"));
  h.config("provider: gh\nworkflow: flow\nmode: auto\nrecord:\n  policy: remote\n");
  commit("old derives its counter now");
  h.remote.issues = [issue(6, "Pay refunds"), issue(5, "Pay invoices")];
  await h.tick("--sync");
  await until(DERIVED, running("implement", 1));
  // one send-back each
  for (const u of [DERIVED, NAMED]) {
    h.report(runs(u), "done", { outcome: "done", handoff: "built" });
    await until(u, running("review", 1));
    h.report(runs(u), "done", { outcome: "changes_requested", handoff: "rework" });
    await until(u, running("implement", 2));
  }
});
afterAll(() => h.cleanup());

describe("a derived counter on a running unit", () => {
  test("norn story list on the holder shows `[review.changes_requested 1/3]`, as it shows a named counter", async () => {
    expect(state(DERIVED)?.counters).toEqual({ "review.changes_requested": 1 });
    const text = (await h.norn("story", "list")).stdout;
    expect(text).toMatch(/running implement#2 \S+ \[review\.changes_requested 1\/3\]\n/);
    expect(text).toMatch(/running implement#2 \S+ \[ready_loop 1\/3\]\n/);
  });

  test("on a machine that does not hold it, norn status lists `review.changes_requested 1/3`, the line as long as a named counter's but for the name", async () => {
    B = otherMachine();
    h.clock.advance(10_000);
    expect((await B("tick", "--sync")).exit).toBe(0);
    const text = (await B("status")).stdout;
    const derived = lineOf(text, DERIVED.key);
    const named = lineOf(text, NAMED.key);
    expect(derived).toMatch(/held by tester@box · Step: implement \(attempt 2\) \[review\.changes_requested 1\/3\]/);
    expect(named).toMatch(/held by tester@box · Step: implement \(attempt 2\) \[ready_loop 1\/3\]/);
    // the same line but for the story's key and title and the counter's name
    expect(derived.replace("gh-5       Pay invoices", "").replace("review.changes_requested", "ready_loop")).toBe(named.replace("gh-6       Pay refunds", ""));
  });

  test("on a machine that does not hold it, norn story view lists `review.changes_requested 1/3`", async () => {
    const r = await B("story", "view", DERIVED.key);
    expect(r.exit).toBe(0);
    expect(r.stdout).toContain("review.changes_requested 1/3");
    const v = (await B("story", "view", DERIVED.key, "--json")).value as { record: { units: Array<{ counters: unknown }> } };
    expect(v.record.units[0]?.counters).toEqual([{ name: "review.changes_requested", value: 1, max: 3 }]);
  });

  test("exhausted, it is refused an unknown --reset with the counters it has, and `--reset review.changes_requested` sets it back to 0 and reruns the step", async () => {
    for (let attempt = 2; attempt <= 4; attempt++) {
      h.report(runs(DERIVED), "done", { outcome: "done", handoff: "built" });
      await until(DERIVED, (st) => st.step === "review" && st.status === "running");
      h.report(runs(DERIVED), "done", { outcome: "changes_requested", handoff: "rework" });
      await until(DERIVED, (st) => st.status !== "running" || st.attempt === attempt + 1);
    }
    expect(state(DERIVED)).toMatchObject({
      step: "review",
      status: "stuck",
      counters: { "review.changes_requested": 3 },
      park: { kind: "exhausted", counter: { name: "review.changes_requested", max: 3, outcome: "changes_requested", to: "implement" } },
    });

    const no = refused(await h.norn("run", "rerun", DERIVED.key, "--reset", "review_loop", "--json"), "unknown_counter");
    expect(no.error).toContain("unknown counter(s) review_loop");
    expect(no.do_instead).toBe(`norn run rerun ${DERIVED.key} --reset <review.changes_requested>`);

    const r = await h.norn("run", "rerun", DERIVED.key, "--reset", "review.changes_requested");
    expect(r.exit).toBe(0);
    await until(DERIVED, (st) => st.step === "review" && st.status === "running");
    expect(state(DERIVED)?.counters).toEqual({ "review.changes_requested": 0 });
  });
});

describe("a unit pinned with a named counter before its workflow derived one", () => {
  test("keeps `ready_loop`, and `norn run rerun --reset ready_loop` works", async () => {
    expect(state(NAMED)?.counters).toEqual({ ready_loop: 1 });
    h.report(runs(NAMED), "stuck", { reason: "stopped by a person" }, "human");
    await until(NAMED, (st) => st.status === "stuck");
    refused(await h.norn("run", "rerun", NAMED.key, "--reset", "review.changes_requested", "--json"), "unknown_counter");
    expect((await h.norn("run", "rerun", NAMED.key, "--reset", "ready_loop")).exit).toBe(0);
    await until(NAMED, (st) => st.step === "implement" && st.status === "running" && st.attempt === 3);
    expect(state(NAMED)?.counters).toEqual({ ready_loop: 0 });
  });
});
