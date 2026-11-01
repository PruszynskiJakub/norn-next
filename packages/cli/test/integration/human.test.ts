/**
 * Human verbs and views through the CLI (§15, O1, O2, O5, S7, W9, T8, T9): inbox / status / trace /
 * why read via @norn/view and the trace; story answer / approve / reject / edit and run rerun write receipts
 * the next tick applies; a non-holder clone posts to the mailbox the holder's tick imports.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Receipt } from "@norn/schema";
import { heartbeatFilePath, repoConfigPath, workflowsDir, storyUnitDir, handoffPath } from "@norn/store";
import { type CliResult, type TickReport } from "../../src/index.ts";
import { createHarness, type Harness, issue, sh } from "../../../../test/support/harness.ts";
import { runChecked } from "../../../../test/support/harness.ts";

// whole flows over real git, several ticks each: 5 s is too tight on a loaded machine (full suite)
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

const ALT = `name: alt
start: draft
steps:
  draft:
    type: agent
    skill: norn-implement
    outcomes: { done: { to: $done, means: "drafted" } }
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
const spec5 = ".agents/specs/gh-5-pay-invoices";
const spec6 = ".agents/specs/gh-6-export-report";
const wt5 = () => `${h.root}-worktrees/gh-5-pay-invoices`;
const wt6 = () => `${h.root}-worktrees/gh-6-export-report`;
const runs5 = () => storyUnitDir(join(wt5(), spec5));
const runs6 = () => storyUnitDir(join(wt6(), spec6));
const step = (ms = 10_000) => h.clock.advance(ms);
const tick = async (...flags: string[]) => {
  step();
  return h.tick(...flags);
};
const refused = (r: CliResult, code: string) => {
  expect(r.exit).toBe(3);
  expect(r.value).toMatchObject({ code, do_instead: expect.any(String) });
};
/** §9.3: a claim held by another heartbeat is "busy" (exit 5), the same for every verb. */
const held = (r: CliResult) => {
  expect(r.exit).toBe(5);
  expect(r.value).toMatchObject({ code: "claim_held", do_instead: expect.any(String) });
};
type Verb = { unit: string; receipt: Receipt; delivered: { via: string; claim?: string; n?: number; file?: string; ref?: string; holder?: string } };

beforeAll(async () => {
  h = await createHarness();
  expect((await h.norn("init")).exit).toBe(0);
  h.write(repoConfigPath(h.root), CONFIG);
  h.write(join(workflowsDir(h.root), "gated.yaml"), GATED);
  h.write(join(workflowsDir(h.root), "alt.yaml"), ALT);
  h.write(join(workflowsDir(h.root), "sliced.yaml"), SLICED);
  h.write(join(workflowsDir(h.root), "sliceqa.yaml"), SLICE_QA);
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn init"]);
  h.git(["push", "-q", "origin", "main"]);
  h.remote.issues = [issue(5, "Pay invoices"), issue(6, "Export report")];
});
afterAll(() => h.cleanup());

describe("before start", () => {
  test("intake; story edit --workflow sets frontmatter (W9, B31) and refuses unknown names and --at", async () => {
    await tick();
    refused(await h.norn("story", "edit", "gh-6", "--workflow", "nope"), "unknown_workflow");
    refused(await h.norn("story", "edit", "gh-6", "--workflow", "alt", "--at", "draft"), "not_started");
    const r = await h.norn("story", "edit", "gh-6", "--workflow", "alt");
    expect(r.exit).toBe(0);
    expect(r.value).toMatchObject({ unit: "gh-6", workflow: "alt", previous: "gated", started: false, changed: true });
    expect(h.read(join(wt6(), spec6, "spec.md"))).toContain("workflow: alt");
    expect((await h.norn("story", "answer", "not-a-key", "x")).exit).toBe(2);
  });

  test("claims, start (alt pinned for gh-6), launch", async () => {
    await tick();
    await tick();
    expect(h.state(runs5())).toMatchObject({ workflow: "gated", step: "work" });
    expect(h.state(runs6())).toMatchObject({ workflow: "alt", step: "draft" });
    expect(h.read(join(runs6(), "workflow.yaml"))).toBe(ALT);
    await tick();
    expect(h.state(runs5())?.status).toBe("running");
  });
});

describe("views (X1)", () => {
  test("story list: the table and its JSON, as status printed them (B15)", async () => {
    const all = await h.norn("story", "list", "--json");
    expect((all.value as { stories: Array<{ key: string }> }).stories.map((s) => s.key)).toEqual(["gh-5", "gh-6"]);
    expect(all.value).toMatchObject({ runs: expect.any(Array), recently_done: expect.any(Array) });
    expect(all.value).not.toHaveProperty("timeline");
    expect(await h.listed("gh-5")).toMatchObject({ key: "gh-5", step: "work", status: "running", workflow: "gated", claim: { state: "mine" } });
    const text = await h.norn("story", "list");
    expect(text.value).toEqual(all.value);
    expect(text.stdout).toContain("gh-5 Pay invoices");
    expect(text.stdout).toContain("gh-6 Export report");
  });

  test("status: running items; the rest empty (B9)", async () => {
    const inbox = (await h.norn("status")).value as { groups: Record<string, Array<{ story: string }>>; pending: number };
    expect(inbox.groups.running?.map((i) => i.story).sort()).toEqual(["gh-5", "gh-6"]);
    expect(inbox.pending).toBe(0);
  });
});

describe("preconditions refuse with do_instead", () => {
  test("approve on a non-gate step, answer when not asking, run rerun when running, unknown unit", async () => {
    const a = await h.norn("story", "approve", "gh-5");
    refused(a, "not_at_gate");
    expect(a.value).toMatchObject({ do_instead: "norn run list gh-5" });
    refused(await h.norn("story", "answer", "gh-5", "EUR"), "not_parked_on_ask");
    refused(await h.norn("run", "rerun", "gh-5"), "running");
    refused(await h.norn("story", "answer", "gh-99", "x"), "unknown_unit");
  });
});

describe("story edit --workflow after start (S7, B32)", () => {
  test("needs --at; --at must exist; switch journals a receipt, re-pins, and the tick enters --at", async () => {
    const needs = await h.norn("story", "edit", "gh-6", "--workflow", "gated");
    expect((needs.value as { do_instead: string }).do_instead).toBe("norn story edit gh-6 --workflow gated --at <work|review>");
    refused(needs, "needs_to");
    refused(await h.norn("story", "edit", "gh-6", "--workflow", "gated", "--at", "nope"), "unknown_step");
    expect((await h.norn("story", "edit", "gh-6", "--at", "review")).exit).toBe(2);
    const r = await h.norn("story", "edit", "gh-6", "--workflow", "gated", "--at", "review");
    expect(r.exit).toBe(0);
    const v = r.value as Verb & { previous: string };
    expect(v.previous).toBe("alt");
    expect(v.receipt).toMatchObject({ kind: "workflow", name: "gated", to: "review", step: "draft", attempt: 1, slice: null, by: "human" });
    expect(h.read(join(runs6(), "workflow.yaml"))).toBe(GATED);
    // the re-pin before the tick is not corruption (S2)
    const st = (await h.listed("gh-6")) as { status: string };
    expect(st.status).not.toBe("corrupt");
    await tick();
    expect(h.state(runs6())).toMatchObject({ workflow: "gated", step: "review", status: "parked", park: { kind: "gate" } });
    const inbox = (await h.norn("status")).value as { groups: Record<string, Array<{ story: string; command: string }>> };
    expect(inbox.groups.approve).toEqual([expect.objectContaining({ story: "gh-6", command: "norn story approve gh-6" })]);
  });
});

describe("answer (O2, B2)", () => {
  test("parked ask shows in the inbox with the exact command; answer → receipt → delivered to the same session", async () => {
    h.report(runs5(), "ask", { question: "Which currency?" });
    await tick();
    const st = h.state(runs5());
    expect(st).toMatchObject({ status: "parked", park: { kind: "ask", reason: "Which currency?" } });
    const inbox = (await h.norn("status")).value as { groups: Record<string, Array<{ command: string }>> };
    expect(inbox.groups.answer?.[0]?.command).toBe('norn story answer gh-5 "…"');
    // B9: one gate and one ask → the Approve and Answer groups, each item with its age and command
    const text = await h.norn("status");
    expect(text.exit).toBe(0);
    expect(text.stdout).toMatch(/^Answer \(1\) · .*\n  gh-5 +work: Which currency\? · \d+[smhd]\S*\n(?: {6}.*\n)*? {6}\$ norn story answer gh-5 "…"\n/m);
    expect(text.stdout).toMatch(/^Approve \(1\) · .*\n  gh-6 +review: Look at it · \d+[smhd]\S*\n(?: {6}.*\n)*? {6}\$ norn story approve gh-6\n/m);

    const r = await h.norn("story", "answer", "gh-5", "EUR");
    expect(r.exit).toBe(0);
    const v = r.value as Verb;
    expect(v.delivered).toMatchObject({ via: "local", claim: "mine" });
    expect(v.delivered.file).toMatch(/^\.agents\/specs\/gh-5-pay-invoices\/runs\/_story\/rounds\/01-gated\/receipts\/\d{4}-answer\.json$/);
    expect(v.receipt).toMatchObject({ kind: "answer", answer: "EUR", step: "work", attempt: 1, slice: null, ask_receipt_id: st?.park?.receipt_id, run_id: st?.run?.run_id });
    // a second answer for the same ask while the first is unapplied is refused, not silently dropped later
    const dup = await h.norn("story", "answer", "gh-5", "USD");
    refused(dup, "already_recorded");
    expect(dup.value).toMatchObject({ do_instead: "norn tick" });
    await tick();
    expect(h.state(runs5())).toMatchObject({ status: "running", park: null });
    expect(h.runner.sent.at(-1)?.text).toBe("EUR");
  });
});

describe("run rerun (W4, B48, B49)", () => {
  test("unknown step / counter refused; --step + --reset journaled and applied", async () => {
    h.report(runs5(), "stuck", { reason: "no API key" });
    await tick();
    expect(h.state(runs5())).toMatchObject({ status: "stuck" });
    refused(await h.norn("run", "rerun", "gh-5", "--step", "nope"), "unknown_step");
    refused(await h.norn("run", "rerun", "gh-5", "--reset", "bogus"), "unknown_counter");
    const r = await h.norn("run", "rerun", "gh-5", "--step", "work", "--reset", "loop", "--reason", "key added");
    expect(r.exit).toBe(0);
    expect((r.value as Verb).receipt).toMatchObject({ kind: "unstick", to: "work", reset: ["loop"], comment: "key added", step: "work", attempt: 1 });
    refused(await h.norn("run", "rerun", "gh-5"), "already_recorded");
    await tick();
    expect(h.state(runs5())).toMatchObject({ step: "work", attempt: 2, counters: { loop: 0 } });
  });
});

describe("story edit --auto|--manual (MO1, B30)", () => {
  test("both flags, no change flag, or a mode with --workflow are usage errors; nothing is written", async () => {
    for (const flags of [["--auto", "--manual"], [], ["--manual", "--workflow", "alt"]]) {
      const r = await h.norn("story", "edit", "gh-5", ...flags);
      expect([flags, r.exit]).toEqual([flags, 2]);
    }
    expect(h.state(runs5())?.mode).toBe("auto");
  });

  test("--manual writes a mode receipt once; the tick stores it; --auto the reverse", async () => {
    const r = await h.norn("story", "edit", "gh-5", "--manual");
    expect(r.exit).toBe(0);
    expect(r.value).toMatchObject({ unit: "gh-5", changed: true, previous: "auto", mode: "manual", receipt: { kind: "mode", mode: "manual", previous: "auto", slice: null } });
    expect((await h.norn("story", "edit", "gh-5", "--manual")).value).toMatchObject({ changed: false });
    await tick();
    expect(h.state(runs5())?.mode).toBe("manual");
    // the last switch wins, a pending one counts as the current mode
    expect((await h.norn("story", "edit", "gh-5", "--auto")).value).toMatchObject({ changed: true, previous: "manual", mode: "auto" });
    expect((await h.norn("story", "edit", "gh-5", "--manual")).value).toMatchObject({ changed: true, previous: "auto", mode: "manual" });
    await tick();
    expect(h.state(runs5())?.mode).toBe("manual");
  });
});

describe("approve (gate)", () => {
  test("--reject --reason routes back counted; T8: a free claim is acquired for this heartbeat", async () => {
    h.report(runs5(), "done", { outcome: "done", handoff: "done" });
    await tick();
    expect(h.state(runs5())).toMatchObject({ step: "review", status: "parked" });
    const r = await h.norn("story", "reject", "gh-5", "--reason", "needs tests");
    expect((r.value as Verb).receipt).toMatchObject({ kind: "reject", comment: "needs tests", step: "review", attempt: 1 });
    // approve and reject decide the same gate: one decision per step attempt
    refused(await h.norn("story", "approve", "gh-5"), "already_recorded");
    await tick();
    expect(h.state(runs5())).toMatchObject({ step: "work", attempt: 3, counters: { loop: 1 } });
    // O6: the rejection is a milestone in handoff.md, so the next brief's Context carries it
    expect(h.read(handoffPath(runs5()))).toContain("- review#1 reject by tester@box: needs tests");
    expect(r.value).not.toHaveProperty("warning");

    // B26 (B3): a rejection without a reason would leave the agent nothing to fix: a usage error, nothing written
    h.report(runs5(), "done", { outcome: "done", handoff: "with tests" });
    await tick();
    const bare = await h.norn("story", "reject", "gh-5");
    expect(bare.exit).toBe(2);
    expect(bare.value).toMatchObject({ do_instead: expect.stringContaining("pass --reason") });
    expect(h.state(runs5())).toMatchObject({ step: "review", attempt: 2, status: "parked" });
    expect((await h.norn("story", "reject", "gh-5", "--reason", "still no tests")).exit).toBe(0);
    expect(h.read(handoffPath(runs5()))).toContain("- review#2 reject by tester@box: still no tests");
    await tick();
    expect(h.state(runs5())).toMatchObject({ step: "work", attempt: 4, counters: { loop: 2 } });

    // T8: drop gh-6's claim everywhere; approve takes it for this heartbeat
    const hb = JSON.parse(h.read(heartbeatFilePath(h.root))).heartbeat_id;
    h.git(["push", "-q", "origin", ":refs/norn/claims/gh-6"]);
    h.git(["update-ref", "-d", "refs/norn/claims/gh-6"]);
    const a = await h.norn("story", "approve", "gh-6");
    expect(a.exit).toBe(0);
    expect((a.value as Verb).delivered).toMatchObject({ via: "local", claim: "acquired" });
    const blob = JSON.parse(h.git(["cat-file", "-p", h.git(["ls-remote", "origin", "refs/norn/claims/gh-6"]).split("\t")[0] as string]));
    expect(blob).toMatchObject({ holder: "tester@box", heartbeat_id: hb });
    await tick();
    expect(h.state(runs6())).toMatchObject({ step: "$done", status: "done" });
  });
});

describe("mailbox (T9): a second clone while this one holds the claim", () => {
  let b: (...argv: string[]) => Promise<CliResult>;
  let importTick: TickReport;

  test("non-holder approve (with a stale local copy) posts to refs/norn/inbox/<story>/<ulid>; mode refuses", async () => {
    // the colleague checks the story out while gh-5 still works: that local copy goes stale
    const bRoot = join(h.dir, "colleague");
    const bHome = join(h.dir, "colleague-home");
    mkdirSync(bHome);
    sh(h.dir, ["clone", "-q", h.remoteDir, bRoot]);
    const bWt = `${bRoot}-worktrees/gh-5-pay-invoices`;
    sh(bRoot, ["worktree", "add", "-q", "-b", "gh-5-pay-invoices", bWt, "origin/gh-5-pay-invoices"]);
    writeFileSync(join(bWt, ".norn-unit"), `repo=${bRoot}\nstory=gh-5\nslice=\nunit=_story\nspec_dir=${spec5}\n`);
    sh(bWt, ["reset", "-q", "--hard", sh(bWt, ["log", "-1", "--format=%H", "--grep=work.unstick"]).trim()]);
    expect(h.state(storyUnitDir(join(bWt, spec5)))).toMatchObject({ step: "work", park: null });

    h.report(runs5(), "done", { outcome: "done", handoff: "with tests" });
    await tick();
    expect(h.state(runs5())).toMatchObject({ step: "review", attempt: 3, status: "parked" });
    const deps = { ...h.deps, cwd: bRoot, env: { ...h.deps.env, NORN_HOME_DIR: bHome, USER: "colleague", NORN_MACHINE: "laptop" } };
    b = (...argv) => runChecked(argv, deps);

    const r = await b("story", "approve", "gh-5", "--reason", "lgtm");
    expect(r.exit).toBe(0);
    const v = r.value as Verb;
    expect(v.delivered).toMatchObject({ via: "mailbox", holder: "tester@box" });
    expect(v.delivered.ref).toMatch(/^refs\/norn\/inbox\/gh-5\/[0-9A-Z]{26}$/);
    expect(v.receipt).toMatchObject({ kind: "approve", step: "review", attempt: 3, slice: null, who: "colleague@laptop", comment: "lgtm" });
    expect(h.git(["ls-remote", "origin", "refs/norn/inbox/*"])).toContain("refs/norn/inbox/gh-5/");
    // the same decision twice is refused before it reaches the mailbox
    refused(await b("story", "approve", "gh-5"), "already_recorded");
    held(await b("story", "edit", "gh-5", "--auto"));
  });

  test("the holder's tick imports it, deletes the ref, and the next tick applies it", async () => {
    importTick = await tick("--sync");
    expect(importTick.decisions.filter((d) => d.unit === "gh-5").map((d) => d.rule)).toContain("mailbox.import");
    expect(h.git(["ls-remote", "origin", "refs/norn/inbox/*"])).toBe("");
    await tick();
    expect(h.state(runs5())).toMatchObject({ step: "$done", status: "done", last_outcome: { outcome: "approve", source: "human" } });
  });

  test("run view --why replays decide on the recorded snapshot and equals the recorded decision (O5)", async () => {
    const r = await h.norn("run", "view", "gh-5", "--why");
    expect(r.exit).toBe(0);
    expect(r.value).toMatchObject({ unit: "gh-5", replay: { matches: true, all_match: true } });
    const v = r.value as { rule: string; replay: { rule: string } };
    expect(v.replay.rule).toBe(v.rule);
    const at = await h.norn("run", "view", "gh-5", "--why", "--tick", importTick.tick_id);
    expect(at.value).toMatchObject({ tick_id: importTick.tick_id, rule: "mailbox.import", action: "import_mailbox", replay: { matches: true } });
    // a 2016 tick id, its day long gone: older than the trace retained (D10)
    refused(await h.norn("run", "view", "gh-5", "--why", "--tick", "01ARZ3NDEKTSV4RRFFQ69G5FAV"), "tick_pruned");
  });

  test("run list: step rows with who and reasons; --events with every human receipt; --limit; --text", async () => {
    type Row = { step: string; attempt: number; who: Array<{ by: string; name: string }>; events?: Array<{ source: string; kind: string }> };
    const r = (await h.norn("run", "list", "gh-5")).value as { total: number; steps: Row[]; hidden_events: number };
    expect(r.total).toBe(r.steps.length);
    expect(r.steps.every((s) => s.events === undefined)).toBe(true);
    expect(r.steps.flatMap((s) => s.who).some((w) => w.by === "human" && w.name === "colleague@laptop")).toBe(true);
    const ev = (await h.norn("run", "list", "gh-5", "--events")).value as { steps: Row[] };
    const events = ev.steps.flatMap((s) => s.events ?? []);
    const kinds = events.filter((e) => e.source === "receipt").map((e) => e.kind);
    for (const k of ["ask", "answer", "stuck", "unstick", "mode", "reject", "approve"]) expect(kinds).toContain(k);
    expect(events.some((e) => e.source === "tick")).toBe(true);
    expect(events.some((e) => e.kind === "noop")).toBe(false);
    const last = (await h.norn("run", "list", "gh-5", "--limit", "2")).value as { total: number; steps: Row[] };
    expect(last.steps).toHaveLength(2);
    expect(last.total).toBe(r.total);
    expect(last.steps).toEqual(r.steps.slice(-2));
    const text = (await h.norn("run", "list", "gh-5")).stdout;
    expect(text).toContain("STEP");
    expect(text).toContain("human wait");
    expect((await h.norn("run", "list", "gh-5", "--limit", "0")).exit).toBe(2);
    refused(await h.norn("run", "list", "gh-9"), "unknown_unit");
  });

  test("run list: --all shows the no-op ticks; --full keeps reasons whole and lists receipts (AC3)", async () => {
    type Row = { events?: Array<{ source: string; kind: string; summary: string }>; reason: string | null; paths: { receipts: string[] } };
    const r = (await h.norn("run", "list", "gh-5")).value as { steps: Row[]; hidden_events: number };
    expect(r.hidden_events).toBeGreaterThan(0);
    const all = (await h.norn("run", "list", "gh-5", "--all")).value as { steps: Row[]; hidden_events: number };
    expect(all.hidden_events).toBe(0);
    const noise = all.steps.flatMap((s) => s.events ?? []).filter((e) => e.source === "tick" && (e.kind === "noop" || e.summary.startsWith("tick claim.renew ")));
    expect(noise.length).toBe(r.hidden_events);
    const short = (await h.norn("run", "list", "gh-5")).stdout;
    const full = (await h.norn("run", "list", "gh-5", "--full")).stdout;
    const receipts = r.steps.flatMap((s) => s.paths.receipts);
    expect(receipts.length).toBeGreaterThan(0);
    for (const p of receipts) {
      expect(full).toContain(p);
      expect(short).not.toContain(p);
    }
    expect((await h.norn("run", "list", "gh-5", "--full", "--json")).value).toEqual((await h.norn("run", "list", "gh-5", "--json")).value);
  });

  test("run view: a unit's latest run, a run by its id; --json is the data (B44, B6)", async () => {
    type Row = { unit: string; step: string; attempt: number; outcome: string | null; who: Array<{ run_id: string | null }> };
    const steps = ((await h.norn("run", "list", "gh-5", "--json")).value as { steps: Row[] }).steps;
    const latest = steps.at(-1) as Row;
    const r = await h.norn("run", "view", "gh-5");
    expect(r.exit).toBe(0);
    expect(r.value).toMatchObject({ unit: "gh-5", story: "gh-5", step: latest.step, attempt: latest.attempt, outcome: latest.outcome, paths: { receipts: expect.any(Array) } });
    expect(r.stdout).toStartWith(`gh-5 · ${latest.step}#${latest.attempt} (`);
    expect(r.stdout).toMatch(/\nduration +\S+/);
    expect(r.stdout).toContain("\nReceipts\n  /");
    expect(JSON.parse((await h.norn("run", "view", "gh-5", "--json")).stdout)).toEqual(r.value);

    // an older run, by the id of its agent session
    const older = steps.find((s) => s.step === "work" && s.who.some((w) => w.run_id)) as Row;
    const runId = older.who.find((w) => w.run_id)?.run_id as string;
    const byId = await h.norn("run", "view", runId, "--json");
    expect(byId.value).toMatchObject({ unit: "gh-5", run_id: runId, step: "work", attempt: older.attempt });

    refused(await h.norn("run", "view", "01ARZ3NDEKTSV4RRFFQ69G5FAV"), "unknown_run");
    refused(await h.norn("run", "view", "gh-9"), "unknown_unit");
    expect((await h.norn("run", "view")).exit).toBe(2);
    expect((await h.norn("run", "view", "gh-5", "--tick", "01ARZ3NDEKTSV4RRFFQ69G5FAV")).exit).toBe(2); // --tick needs --why
    const noUnit = await h.norn("run", "view", "--why", "--json");
    expect(noUnit.exit).toBe(2); // --why without a unit or --receipt is a usage error, not a refusal
    expect((noUnit.value as { error: string }).error).not.toContain("undefined");
  });
});

describe("a slice gate in its own worktree (X1: views read slice runs from the slice worktree)", () => {
  const spec8 = ".agents/specs/gh-8-split-work";
  const wt8 = () => `${h.root}-worktrees/gh-8-split-work`;
  const sliceWt = () => `${wt8()}--01-part`;
  const storyRuns = () => storyUnitDir(join(wt8(), spec8));
  const sliceRuns = () => join(sliceWt(), spec8, "runs/01-part");
  type InboxItem = { slice: string | null; step: string | null; title: string; command: string };

  test("the slice parks at its gate in the slice worktree; the story worktree copy is stale", async () => {
    h.remote.issues = [...h.remote.issues, issue(8, "Split work", ["norn", "norn:wf:sliced"])];
    await tick("--sync");
    for (let i = 0; i < 6 && h.state(storyRuns())?.status !== "running"; i++) await tick();
    expect(h.state(storyRuns())).toMatchObject({ workflow: "sliced", step: "plan", status: "running" });
    h.write(join(wt8(), spec8, "slices/01-part.md"), "---\nid: gh-8/01\ntitle: First part\nworkflow: sliceqa\ndepends_on: []\nstatus: planned\n---\n\nAcceptance: it works.\n");
    h.report(storyRuns(), "done", { outcome: "done", handoff: "one slice" });
    for (let i = 0; i < 6 && h.state(sliceRuns())?.status !== "parked"; i++) await tick();
    expect(h.state(sliceRuns())).toMatchObject({ slice: "gh-8/01", step: "qa", status: "parked", park: { kind: "gate" } });
    expect(h.state(join(wt8(), spec8, "runs/01-part"))?.status).not.toBe("parked");
  });

  test("story list and status show the gate read from the slice worktree", async () => {
    expect(await h.listed("gh-8/01")).toMatchObject({ key: "gh-8/01", step: "qa", status: "parked", park: { kind: "gate", reason: "Try the slice" } });
    const inbox = (await h.norn("status")).value as { groups: Record<string, InboxItem[]> };
    expect(inbox.groups.approve).toEqual([
      expect.objectContaining({ slice: "gh-8/01", step: "qa", title: "Try the slice", command: "norn story approve gh-8/01" }),
    ]);
  });

  test("run list of the story shows its slices; run view of the slice is its gate (B43, B44)", async () => {
    const list = await h.norn("run", "list", "gh-8");
    expect(list.exit).toBe(0);
    const v = list.value as { units: Array<{ unit: string }>; steps: Array<{ unit: string; step: string }> };
    expect(v.units.map((u) => u.unit)).toEqual(["gh-8", "gh-8/01"]);
    expect(v.steps).toContainEqual(expect.objectContaining({ unit: "gh-8/01", step: "qa" }));
    expect(list.stdout).toContain("\n  gh-8/01 ");
    expect((await h.norn("run", "view", "gh-8/01", "--json")).value).toMatchObject({ unit: "gh-8/01", story: "gh-8", slice: "gh-8/01", step: "qa", type: "gate", open: true, run_id: null });
    const only = (await h.norn("run", "list", "gh-8", "--story-only")).value as typeof v;
    expect(only.units.map((u) => u.unit)).toEqual(["gh-8"]);
    expect(only.steps.every((s) => s.unit === "gh-8")).toBe(true);
  });

  test("in the slice worktree, story edit --auto|--manual acts on the story, --workflow on the slice (B55)", async () => {
    const inSlice = (...argv: string[]) => runChecked(argv, { ...h.deps, cwd: sliceWt() });
    const m = await inSlice("story", "edit", "--manual", "--json");
    expect(m.exit).toBe(0);
    expect(m.value).toMatchObject({ unit: "gh-8", mode: "manual", changed: true, receipt: { kind: "mode", slice: null } });
    expect(readdirSync(join(storyUnitDir(join(wt8(), spec8)), "receipts")).filter((f) => f.endsWith("-mode.json"))).toHaveLength(1);
    const w = await inSlice("story", "edit", "--workflow", "sliceqa", "--json");
    expect(w.exit).toBe(3);
    expect(w.value).toMatchObject({ code: "needs_to", error: expect.stringContaining("gh-8/01"), do_instead: "norn story edit gh-8/01 --workflow sliceqa --at <qa>" });
    // an explicit slice key with a mode flag means the slice's story too
    expect((await h.norn("story", "edit", "gh-8/01", "--auto")).value).toMatchObject({ unit: "gh-8", mode: "auto", previous: "manual" });
    await tick();
    expect(h.state(storyRuns())?.mode).toBe("auto");
  });

  test("run rerun of the story key stands for its one slice waiting at a gate", async () => {
    const r = await h.norn("run", "rerun", "gh-8");
    expect(r.exit).toBe(0);
    expect((r.value as Verb).receipt).toMatchObject({ kind: "unstick", step: "qa", slice: "gh-8/01", attempt: 1 });
    await tick();
    expect(h.state(sliceRuns())).toMatchObject({ step: "qa", attempt: 2, status: "parked", park: { kind: "gate" } });
  });

  test("approve lands in the slice worktree; the next tick finishes the slice and the inbox clears", async () => {
    const r = await h.norn("story", "approve", "gh-8/01");
    expect(r.exit).toBe(0);
    expect((r.value as Verb).receipt).toMatchObject({ kind: "approve", step: "qa", slice: "gh-8/01", by: "human" });
    await tick();
    expect(h.state(sliceRuns())).toMatchObject({ step: "$done", status: "done", last_outcome: { outcome: "approve", source: "human" } });
    const inbox = (await h.norn("status")).value as { groups: Record<string, InboxItem[]> };
    expect(inbox.groups.approve).toEqual([]);
  });
});

describe("gh-71 B2, B25: approving triage's confirm gate finishes the round, not the story", () => {
  const TRIAGE = `name: triage
start: explore
steps:
  explore:
    type: agent
    skill: norn-qa
    outcomes: { story: { to: confirm, means: "deliver it as a story" }, close: { to: confirm, means: "close it" } }
  confirm:
    type: gate
    prompt: "Confirm the triage"
    outcomes: { approve: $done, reject: { to: explore, counter: loop } }
counters: { loop: { max: 2 } }
`;
  let t: Harness;
  const spec = ".agents/specs/gh-12-triage-me";
  const wt = () => `${t.root}-worktrees/gh-12-triage-me`;
  const runs = () => storyUnitDir(join(wt(), spec));
  const next = () => {
    t.clock.advance(10_000);
    return t.tick();
  };
  beforeAll(async () => {
    t = await createHarness();
    expect((await t.norn("init")).exit).toBe(0);
    t.write(repoConfigPath(t.root), CONFIG.replace("default_workflow: gated", "default_workflow: triage"));
    t.write(join(workflowsDir(t.root), "triage.yaml"), TRIAGE);
    t.git(["add", "-A"]);
    t.git(["commit", "-q", "-m", "norn init"]);
    t.git(["push", "-q", "origin", "main"]);
    t.remote.issues = [issue(12, "Triage me")];
  });
  afterAll(() => t.cleanup());

  test("approve at confirm → $done; spec, worktree and claim kept; the inbox says the round is done", async () => {
    // intake, claim, start, launch explore
    for (let i = 0; i < 6 && t.state(runs())?.status !== "running"; i++) await next();
    expect(t.state(runs())).toMatchObject({ step: "explore", status: "running" });
    t.report(runs(), "done", { outcome: "story", handoff: "deliver it as a story" });
    await next();
    expect(t.state(runs())).toMatchObject({ step: "confirm", status: "parked", park: { kind: "gate" } });
    expect((await t.norn("story", "approve", "gh-12")).exit).toBe(0);
    await next();
    expect(t.state(runs())).toMatchObject({ step: "$done", status: "done" });
    // the story is still active: spec not closed, worktree and claim kept
    expect(t.read(join(wt(), spec, "spec.md"))).toContain("status: active");
    expect(existsSync(wt())).toBe(true);
    expect(t.git(["ls-remote", "origin", "refs/norn/claims/gh-12"])).toContain("refs/norn/claims/gh-12");
    // a forced sync later it is still a finished round, never parked (D5), and it needs the person (B25)
    t.clock.advance(10_000);
    const s = await t.norn("sync");
    expect((s.value as TickReport).decisions.filter((d) => d.unit === "gh-12").map((d) => d.rule)).toContain("story.round_done");
    const inbox = (await t.norn("status", "--json")).value as { pending: number; groups: Record<string, Array<{ title: string; command: string; detail?: string }>> };
    expect(inbox.groups.your_turn).toEqual([expect.objectContaining({ title: "gh-12: triage round done, no PR", command: "norn story edit gh-12 --workflow <name>", detail: "or close the issue" })]);
    expect(inbox.groups.recently_done).toEqual([]);
    expect(inbox.pending).toBeGreaterThanOrEqual(1);
  });
});
