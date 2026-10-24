/**
 * Honest QA and notes through the CLI (QV1–QV8, NT1–NT3; SPEC-base-sync-and-qa §7 cases 8, 9, 10):
 * a manual-mode story whose qa step requires a criteria report. `norn done` refuses a report that
 * misses a frontmatter criterion, an outcome the worst verdict contradicts, a missing report; an
 * `unverified` report goes to human-qa, whose inbox item says how to check; notes become Check items
 * that a `ready` reject leaves open and a `ready` approve acknowledges.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CriteriaTrace } from "@norn/schema";
import { readTrace } from "@norn/store";
import { type CliResult, runCli } from "../src/index.ts";
import { createHarness, type Harness, issue } from "./harness.ts";

const QAFLOW = `name: qaflow
start: qa
steps:
  qa:
    type: agent
    skill: qa
    criteria: required
    outcomes:
      pass:       { to: ready, verdict: pass, means: "every criterion observed with evidence" }
      fail:       { to: $stuck, verdict: fail, means: "a criterion fails; repro in findings" }
      partial:    { to: human-qa, verdict: person, means: "criteria only a person can judge, evidence prepared" }
      unverified: { to: human-qa, verdict: unverified, means: "criteria this session could not check; how to check each one is in the report" }
  human-qa:
    type: gate
    outcomes: { approve: ready, reject: { to: qa, counter: qa_loop } }
  ready:
    type: gate
    outcomes: { approve: $done, reject: { to: qa, counter: qa_loop } }
counters: { qa_loop: { max: 3 } }
`;

const CONFIG = `agents:
  claude: { adapter: claude }
remote: { provider: gh, label: norn }
default_workflow: qaflow
default_mode: manual
notifiers: []
`;

let h: Harness;
const spec = ".agents/specs/gh-4-today-view";
const wt = () => `${h.root}-worktrees/gh-4-today-view`;
const runs = () => join(wt(), spec, "runs/_story");
const env = () => {
  const e: Record<string, string | undefined> = { ...h.deps.env, NORN_AGENT_PID: String(process.pid) };
  for (const k of ["NORN_AGENT", "NORN_RUN", "NORN_STORY", "NORN_SLICE", "NORN_AGENT_SESSION_ID"]) delete e[k];
  return e;
};
const inWt = (...argv: string[]): Promise<CliResult> => runCli(argv, { ...h.deps, cwd: wt(), env: env() });
const lastReceipt = (kind: string) => {
  const name = readdirSync(join(runs(), "receipts")).filter((f) => f.endsWith(`-${kind}.json`)).sort().at(-1) as string;
  return JSON.parse(h.read(join(runs(), "receipts", name)));
};
type Item = { id: string; title: string; detail?: string; full?: string; command: string; step: string | null };
const inbox = async () => ((await h.norn("inbox")).value as { groups: Record<string, Item[]> }).groups;
const notes = async () => (await inbox()).check?.filter((i) => i.id.startsWith("note:")) ?? [];

async function tickUntil(pred: () => boolean, label: string, max = 12) {
  for (let i = 0; i < max && !pred(); i++) {
    h.clock.advance(10_000);
    await h.tick();
  }
  if (!pred()) throw new Error(`${label} not reached: ${JSON.stringify(h.state(runs()))}`);
}
const at = (step: string, status: string) => () => h.state(runs())?.step === step && h.state(runs())?.status === status;

/** brief (starts the run), one tick (applies it): the qa step is running and may report */
async function startQa() {
  await tickUntil(at("qa", "ready"), "qa ready");
  expect((await inWt("brief")).exit).toBe(0);
  h.clock.advance(10_000);
  await h.tick();
  expect(h.state(runs())).toMatchObject({ step: "qa", status: "running" });
}

function report(name: string, entries: unknown[]): string {
  const file = join(h.dir, `${name}.json`);
  writeFileSync(file, JSON.stringify(entries));
  return file;
}
const PASS = (id: string) => ({ id, verdict: "pass", evidence: `evidence/${id}.txt` });
const UNVERIFIED = { id: "AC2", verdict: "unverified", reason: "no browser in this session", how: "open /today, add 'buy milk p1', expect red flag" };

beforeAll(async () => {
  h = await createHarness();
  expect((await h.norn("init")).exit).toBe(0);
  h.write(join(h.root, ".agents/norn/config.yaml"), CONFIG);
  h.write(join(h.root, ".agents/norn/workflows/qaflow.yaml"), QAFLOW);
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn init"]);
  h.git(["push", "-q", "origin", "main"]);
  h.remote.issues = [issue(4, "Today view")];
  await tickUntil(at("qa", "ready"), "intake");
  // QV1: story-level criteria in story.md frontmatter (the slice skill's job), committed like agent work
  const file = join(wt(), spec, "story.md");
  h.write(file, h.read(file).replace(/\n---\n/, "\ncriteria:\n  - { id: AC1, verifier: test }\n  - { id: AC2, verifier: agent, needs: [browser] }\n  - { id: AC3, verifier: person }\n---\n"));
  h.git(["add", "-A"], wt());
  h.git(["commit", "-q", "-m", "story criteria", "--trailer", "Norn-Tick: 01JBQ6ZK3E8Y4V5W6X7Y8Z9ABC"], wt());
});
afterAll(() => h.cleanup());

describe("criteria reports and notes through norn done", () => {
  test("refusals: no report, an invalid file, a missing criterion (9), an unknown note criterion", async () => {
    await startQa();
    expect((await inWt("brief")).value).toMatchObject({ markdown: expect.stringContaining('`norn done unverified --criteria <file> --handoff "…"`') });

    const none = await inWt("done", "pass", "--handoff", "all good");
    expect(none.exit).toBe(3);
    expect(none.value).toMatchObject({ code: "criteria_required", do_instead: expect.stringContaining('norn done pass --criteria <file> --handoff "…"') });

    const bad = await inWt("done", "pass", "--handoff", "x", "--criteria", report("bad", [{ id: "AC1", verdict: "pass" }]));
    expect(bad.value).toMatchObject({ code: "invalid_criteria", error: expect.stringContaining("evidence") });

    const missing = await inWt("done", "pass", "--handoff", "x", "--criteria", report("missing", [PASS("AC1"), PASS("AC2")]));
    expect(missing.exit).toBe(3);
    expect(missing.value).toMatchObject({ code: "invalid_criteria", do_instead: expect.stringContaining("AC1, AC2, AC3"), details: { missing: ["AC3"] } });

    const all = report("all", [PASS("AC1"), PASS("AC2"), PASS("AC3")]);
    const note = await inWt("done", "pass", "--handoff", "x", "--criteria", all, "--note", "hm", "--note-criterion", "AC9");
    expect(note.value).toMatchObject({ code: "invalid_criteria", details: { unknown: ["AC9"] } });
    expect((await inWt("done", "pass", "--handoff", "x", "--criteria", all, "--note-criterion", "AC1")).exit).toBe(2);
    expect(readdirSync(join(runs(), "receipts")).filter((f) => f.endsWith("-done.json"))).toEqual([]);
  });

  test("8: pass with an unverified criterion is refused naming unverified; done unverified → human-qa listing how", async () => {
    const file = report("unverified", [PASS("AC1"), UNVERIFIED, { id: "AC3", verdict: "person", how: "compare against Figma frame 12" }]);
    const refused = await inWt("done", "pass", "--handoff", "checked what I could", "--criteria", file);
    expect(refused.exit).toBe(3);
    expect(refused.value).toMatchObject({ code: "outcome_contradicts_verdicts", do_instead: 'norn done unverified --criteria <file> --handoff "…"', details: { worst: "unverified" } });

    const ok = await inWt("done", "unverified", "--handoff", "no browser here", "--criteria", file, "--note", "kept whitespace inside backticks", "--note-criterion", "AC1");
    expect(ok.exit).toBe(0);
    expect(ok.value).toMatchObject({ outcome: "unverified", criteria: { worst: "unverified", coverage: "checked", pass: 1, unverified: 1, person: 1 }, notes: 1 });
    const done = lastReceipt("done");
    expect(done.criteria.map((c: { id: string; verdict: string }) => `${c.id} ${c.verdict}`)).toEqual(["AC1 pass", "AC2 unverified", "AC3 person"]);
    expect(done.notes).toEqual([{ text: "kept whitespace inside backticks", criterion: "AC1" }]);

    // QV8: the trace counts unverified per capability; norn trace sums it
    const ev = readTrace(h.root, { unit: "gh-4", types: ["criteria"] }).events as CriteriaTrace[];
    expect(ev.at(-1)).toMatchObject({ unit: "gh-4", rule: "criteria.checked", outcome: "unverified", verdicts: { pass: 1, fail: 0, person: 1, unverified: 1 }, unverified_needs: { browser: 1 } });
    expect(((await h.norn("trace", "gh-4")).value as { criteria: unknown }).criteria).toEqual({ reports: 1, verdicts: { pass: 1, fail: 0, person: 1, unverified: 1 }, unverified_needs: { browser: 1 }, unchecked_coverage: 0 });

    await tickUntil(at("human-qa", "parked"), "human-qa");
    const g = await inbox();
    const gate = g.approve?.find((i) => i.step === "human-qa");
    expect(gate?.detail).toContain("AC2 unverified (no browser in this session) — how: open /today, add 'buy milk p1', expect red flag");
    expect(gate?.detail).toContain("AC3 person — how: compare against Figma frame 12");
    expect(gate?.full).toBeUndefined(); // L1: the long form only with --details
    const details = ((await h.norn("inbox", "--details")).value as { groups: Record<string, Item[]> }).groups;
    expect(details.approve?.find((i) => i.step === "human-qa")?.full).toContain("Criteria for a person to check:\n- AC2 unverified");

    // NT2: the note is a Check item whose command explains the report
    const [n] = await notes();
    expect(n).toMatchObject({ id: `note:${done.receipt_id}:1`, title: "qa note on gh-4 (AC1): kept whitespace inside backticks", command: `norn why gh-4 --receipt ${done.receipt_id}` });
    const why = await h.norn("why", "gh-4", "--receipt", done.receipt_id);
    expect(why.exit).toBe(0);
    expect(why.value).toMatchObject({ trigger: { kind: "done", outcome: "unverified", reason: expect.stringContaining("Notes for a person:\n1. (AC1) kept whitespace inside backticks") } });
  });

  test("10: reject leaves notes open; a later note joins them; ready.approve acknowledges both", async () => {
    expect((await h.norn("approve", "gh-4", "--reject", "--reason", "AC2 shows no red flag")).exit).toBe(0);
    expect(lastReceipt("reject").acknowledged_notes).toBeUndefined();
    await startQa();
    expect(await notes()).toHaveLength(1);

    const pass = report("pass", [PASS("AC1"), PASS("AC2"), PASS("AC3")]);
    expect((await inWt("done", "pass", "--handoff", "all observed", "--criteria", pass, "--note", "copy says 'Today', spec says 'today'")).exit).toBe(0);
    await tickUntil(at("ready", "parked"), "ready");
    expect((await notes()).map((i) => i.title)).toEqual(["qa note on gh-4 (AC1): kept whitespace inside backticks", "qa note on gh-4: copy says 'Today', spec says 'today'"]);
    const ready = (await inbox()).approve?.find((i) => i.step === "ready");
    expect(ready?.detail).toContain("open notes (approve acknowledges them)");

    expect((await h.norn("approve", "gh-4", "--reject", "--reason", "tighten AC3")).exit).toBe(0);
    await startQa();
    expect(await notes()).toHaveLength(2);

    expect((await inWt("done", "pass", "--handoff", "all observed again", "--criteria", pass)).exit).toBe(0);
    await tickUntil(at("ready", "parked"), "ready again");
    const open = (await notes()).map((i) => i.id);
    expect((await h.norn("approve", "gh-4")).exit).toBe(0);
    expect(lastReceipt("approve").acknowledged_notes).toEqual(open);
    expect(await notes()).toEqual([]);
    await tickUntil(() => h.state(runs())?.status === "done", "$done");
  });
});
