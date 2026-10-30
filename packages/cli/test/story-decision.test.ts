/**
 * `norn story answer|approve|reject|update-branch` (B24–B27): the decisions a person makes on a
 * story, with the targets of B54–B60 — the worktree's unit (a slice worktree's story for
 * `update-branch`, B55), and at a terminal elsewhere only the units the verb applies to (B57, B59).
 * The old `answer`, `approve` and `update` are unknown commands (B5). What each verb writes is
 * covered where the old command's tests were (human.test.ts, base-sync.test.ts, …).
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { CliDeps, CliResult } from "../src/index.ts";
import { createHarness, FakeInteraction, type Harness, issue } from "./harness.ts";
import { runChecked } from "./harness.ts";

setDefaultTimeout(30_000);

const GATED = `name: gated
start: work
steps:
  work:
    type: agent
    skill: norn-implement
    outcomes: { done: { to: review, means: "the change is ready to look at" } }
  review:
    type: gate
    prompt: "Look at it"
    outcomes: { approve: $done, reject: { to: work, counter: loop } }
counters: { loop: { max: 2 } }
`;

const SLICED = `name: sliced
start: plan
steps:
  plan:
    type: agent
    skill: norn-plan
    outcomes: { done: { to: slices, means: "slice files written" } }
  slices:
    type: slices
    outcomes: { done: $done, stuck: $stuck }
`;

const SLICE_QA = `name: sliceqa
start: qa
steps:
  qa:
    type: gate
    prompt: "Try the slice"
    outcomes: { approve: $done, reject: $stuck }
`;

const CONFIG = `agents:
  claude: { adapter: claude }
runner: { adapter: headless }
remote: { provider: gh, label: norn }
default_workflow: gated
default_mode: auto
notifiers: []
`;

let h: Harness;
const SLUGS: Record<number, string> = { 1: "gh-1-pay-invoices", 2: "gh-2-send-receipts", 3: "gh-3-pick-an-api", 4: "gh-4-split-work" };
const wt = (n: number) => `${h.root}-worktrees/${SLUGS[n]}`;
const runs = (n: number) => join(wt(n), `.agents/specs/${SLUGS[n]}/runs/_story`);
const sliceWt = () => `${wt(4)}--01-part`;
const sliceRuns = () => join(sliceWt(), `.agents/specs/${SLUGS[4]}/runs/01-part`);
const receipts = (dir: string) => readdirSync(join(dir, "receipts")).sort();
const tick = async () => {
  h.clock.advance(10_000);
  return h.tick();
};
const until = async (done: () => boolean) => {
  for (let i = 0; i < 8 && !done(); i++) await tick();
  expect(done()).toBe(true);
};
/** `norn …` with these deps over the harness's */
const norn = (deps: Partial<CliDeps>, ...argv: string[]): Promise<CliResult> => runChecked(argv, { ...h.deps, ...deps });

beforeAll(async () => {
  h = await createHarness();
  expect((await h.norn("init")).exit).toBe(0);
  h.write(join(h.root, ".agents/norn/config.yaml"), CONFIG);
  h.write(join(h.root, ".agents/norn/workflows/gated.yaml"), GATED);
  h.write(join(h.root, ".agents/norn/workflows/sliced.yaml"), SLICED);
  h.write(join(h.root, ".agents/norn/workflows/sliceqa.yaml"), SLICE_QA);
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn init"]);
  h.git(["push", "-q", "origin", "main"]);
  h.remote.issues = [issue(1, "Pay invoices"), issue(2, "Send receipts"), issue(3, "Pick an API"), issue(4, "Split work", ["norn", "norn:wf:sliced"])];
  await h.tick("--sync");
  // two agents at a time (max_agents): gh-1 and gh-2 first
  await until(() => [1, 2].every((n) => h.state(runs(n))?.status === "running"));
});
afterAll(() => h.cleanup());

describe("nothing applies", () => {
  test("approve and reject: refused 'Nothing waits at a gate'; answer: nothing parked on a question (B59)", async () => {
    for (const [argv, error] of [
      [["story", "approve"], "Nothing waits at a gate"],
      [["story", "reject", "--reason", "x"], "Nothing waits at a gate"],
      [["story", "answer", "x"], "Nothing waits for an answer"],
    ] as const) {
      const term = new FakeInteraction();
      const r = await norn({ interaction: term }, ...argv);
      expect([argv, r.exit]).toEqual([argv, 3]);
      expect(r.value).toMatchObject({ code: "no_target", error });
      expect(term.picks).toEqual([]);
    }
  });
});

describe("gh-1 and gh-2 at gates, gh-3 parked on a question, gh-4/01 at its gate in its slice worktree", () => {
  test("setup", async () => {
    h.report(runs(1), "done", { outcome: "done", handoff: "ready" });
    h.report(runs(2), "done", { outcome: "done", handoff: "ready" });
    await until(() => [3, 4].every((n) => h.state(runs(n))?.status === "running"));
    h.report(runs(3), "ask", { question: "Which API?" });
    h.write(join(wt(4), `.agents/specs/${SLUGS[4]}/slices/01-part.md`), "---\nid: gh-4/01\ntitle: First part\nworkflow: sliceqa\ndepends_on: []\nstatus: planned\n---\n\nAcceptance: it works.\n");
    h.report(runs(4), "done", { outcome: "done", handoff: "one slice" });
    await until(() => h.state(sliceRuns())?.status === "parked" && [1, 2].every((n) => h.state(runs(n))?.park?.kind === "gate") && h.state(runs(3))?.park?.kind === "ask");
  });

  test("the old answer, approve and update are unknown commands; nothing is written (B5)", async () => {
    const before = receipts(runs(1));
    for (const argv of [["answer", "gh-3", "v2"], ["approve", "gh-1"], ["approve", "gh-1", "--reject", "--reason", "x"], ["update", "gh-1"]]) {
      const r = await h.norn(...argv);
      expect([argv, r.exit]).toEqual([argv, 2]);
      expect(r.value).toMatchObject({ code: "unknown_command", error: `Unknown command: ${argv[0]}` });
    }
    expect(receipts(runs(1))).toEqual(before);
    expect(receipts(runs(3)).filter((f) => f.endsWith("-answer.json"))).toEqual([]);
  });

  test("in the main checkout at a terminal, approve and reject offer only the units at a gate, answer only the one parked on a question (B57)", async () => {
    for (const [argv, offered] of [
      [["story", "approve"], ["gh-1", "gh-2", "gh-4/01"]],
      [["story", "reject", "--reason", "x"], ["gh-1", "gh-2", "gh-4/01"]],
      [["story", "answer", "x"], ["gh-3"]],
    ] as const) {
      const term = new FakeInteraction();
      term.answers = [null];
      const r = await norn({ interaction: term }, ...argv);
      expect(r.value).toMatchObject({ code: "cancelled" });
      expect([argv, term.picks.map((p) => p.choices.map((c) => c.value).sort())]).toEqual([argv, [[...offered]]]);
    }
    // left the pick-list: nothing written
    expect(receipts(runs(1)).filter((f) => /-(approve|reject)\.json$/.test(f))).toEqual([]);
  });

  test("a script is refused with the candidates (B60)", async () => {
    const r = await h.norn("story", "approve", "--json");
    expect(r.exit).toBe(2);
    for (const k of ["gh-1", "gh-2", "gh-4/01"]) expect((r.value as { do_instead: string }).do_instead).toContain(k);
    expect((r.value as { do_instead: string }).do_instead).not.toContain("gh-3");
  });

  test("story reject without --reason is a usage error: do_instead 'pass --reason', nothing written (B26)", async () => {
    const before = receipts(runs(1));
    const r = await h.norn("story", "reject", "gh-1");
    expect(r.exit).toBe(2);
    expect((r.value as { do_instead: string }).do_instead).toContain("pass --reason");
    expect(receipts(runs(1))).toEqual(before);
  });

  test("story reject --reason writes the reject receipt with that comment; the next tick routes as reject (B26)", async () => {
    const r = await h.norn("story", "reject", "gh-1", "--reason", "misses B4");
    expect(r.exit).toBe(0);
    expect(r.value).toMatchObject({ receipt: { kind: "reject", comment: "misses B4", step: "review", slice: null, by: "human" } });
    await tick();
    expect(h.state(runs(1))).toMatchObject({ step: "work", attempt: 2, counters: { loop: 1 } });
  });

  test("story approve writes the approve receipt; the next tick moves on (B25)", async () => {
    const r = await h.norn("story", "approve", "gh-2");
    expect(r.exit).toBe(0);
    expect(r.value).toMatchObject({ receipt: { kind: "approve", step: "review", slice: null, by: "human" } });
    await tick();
    expect(h.state(runs(2))).toMatchObject({ step: "$done", status: "done" });
  });

  test("story answer delivers the answer into the session, as answer did (B24)", async () => {
    const r = await h.norn("story", "answer", "gh-3", "Use the v2 API");
    expect(r.exit).toBe(0);
    expect(r.value).toMatchObject({ delivered: { via: "local" }, receipt: { kind: "answer", answer: "Use the v2 API", step: "work", by: "human" } });
    await tick();
    expect(h.state(runs(3))).toMatchObject({ status: "running", park: null });
    expect(h.runner.sent.at(-1)?.text).toBe("Use the v2 API");
  });

  test("in the slice worktree, update-branch acts on the story and approve on the slice (B55, B54)", async () => {
    const term = new FakeInteraction();
    const u = await norn({ cwd: sliceWt(), interaction: term }, "story", "update-branch");
    expect(u.exit).toBe(3);
    expect(u.value).toMatchObject({ code: "not_waiting", error: expect.stringMatching(/^gh-4 is not waiting/) });
    const a = await norn({ cwd: sliceWt(), interaction: term }, "story", "approve");
    expect(a.exit).toBe(0);
    expect(a.value).toMatchObject({ receipt: { kind: "approve", step: "qa", slice: "gh-4/01" } });
    expect(term.picks).toEqual([]);
  });
});
