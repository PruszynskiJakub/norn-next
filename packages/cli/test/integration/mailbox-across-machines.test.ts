/**
 * The mailbox between machines once run state stays on the holder's. Clone A
 * holds the stories; clone B, another clone of the same bare remote with its own norn home, user and
 * machine name, answers and approves them. Under `local` B stamps its receipt with the step the last
 * boundary commit led to (`Norn-Next`) and no attempt, and says the holder checks it; under `remote` it
 * stamps step and attempt from the record ref. On A, a receipt that no longer matches is rejected into
 * the trace and shows as a Check item until a later answer or approval is accepted or the story finishes.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RunnerPort } from "@norn/core";
import { mailboxPrefix, type Receipt } from "@norn/schema";
import { readTrace, rejectedReceiptsPath, repoConfigPath, workflowsDir } from "@norn/store";
import { type CliDeps, type CliResult, runningVersion } from "../../src/index.ts";
import { createHarness, FakeRunner, type Harness, hostEnv, issue, runChecked, sh } from "../../../../test/support/harness.ts";
import { runStateOf } from "../../../../test/support/run-state.ts";

setDefaultTimeout(120_000);

const QUAD = `name: quad
start: implement
steps:
  implement:
    type: agent
    skill: norn-implement
    outcomes: { done: { to: review, means: "every criterion has a passing test" } }
  review:
    type: agent
    skill: norn-review
    outcomes:
      approve: { to: ready, means: "no blocking findings" }
      changes_requested: { to: implement, counter: review_loop, means: "blocking findings" }
  ready:
    type: gate
    prompt: "Merge it?"
    outcomes: { approve: $done, reject: { to: implement, counter: review_loop } }
counters: { review_loop: { max: 3 } }
`;
const DUO = `name: duo
start: draft
steps:
  draft:
    type: agent
    skill: norn-implement
    outcomes: { done: { to: implement, means: "drafted" } }
  implement:
    type: agent
    skill: norn-implement
    outcomes: { done: { to: $done, means: "implemented" } }
`;
const CONFIG = "provider: gh\nworkflow: quad\nmode: manual\n";
const teamConfig = (policy: "local" | "remote") => `norn_version: ${runningVersion(h.deps)}\nprovider: gh\nworkflow: quad\nrecord:\n  policy: ${policy}\n`;

interface Clone {
  root: string;
  norn(...argv: string[]): Promise<CliResult>;
}
interface Verb {
  receipt: Receipt;
  delivered: { via: string; ref?: string; holder?: string };
  next: string;
}
type InboxItem = { id: string; story: string; title: string };

let h: Harness;
let B: Clone;

const tick = (...argv: string[]) => {
  h.clock.advance(10_000);
  return h.tick(...argv);
};
const inWt = (cwd: string, ...argv: string[]): Promise<CliResult> => {
  const env: Record<string, string | undefined> = { ...h.deps.env, NORN_AGENT_PID: String(process.pid) };
  for (const k of ["NORN_AGENT", "NORN_RUN", "NORN_STORY", "NORN_SLICE", "NORN_AGENT_SESSION_ID"]) delete env[k];
  return runChecked(argv, { ...h.deps, cwd, env });
};
function cloneOf(name: string, user: string, machine: string): Clone {
  const root = join(h.dir, name);
  sh(h.dir, ["clone", "-q", h.remoteDir, root]);
  sh(root, ["config", "user.email", `${user}@example.com`]);
  sh(root, ["config", "user.name", user]);
  const home = join(h.dir, `home-${name}`);
  mkdirSync(home);
  const deps: CliDeps = {
    cwd: root,
    env: { ...hostEnv(), NORN_HOME_DIR: home, USER: user, NORN_MACHINE: machine, NORN_HOOK_COMMAND: "norn hook" },
    clock: h.clock,
    ports: { remote: h.remote, runner: new FakeRunner() as RunnerPort, notifiers: [] },
  };
  return { root, norn: (...argv) => runChecked(argv, deps) };
}
/** The team switches its record policy: committed and pushed on A, pulled on B. */
function setPolicy(policy: "local" | "remote") {
  h.write(repoConfigPath(h.root), teamConfig(policy));
  h.git(["commit", "-q", "-am", `record.policy ${policy}`]);
  h.git(["push", "-q", "origin", "main"]);
  sh(B.root, ["pull", "-q", "--ff-only", "origin", "main"]);
}

/** A quad story held by A at review (implement's boundary pushed), review's session started. */
async function atReview(n: number, slug: string) {
  const spec = `.agents/specs/gh-${n}-${slug}`;
  const wt = h.worktree(`gh-${n}-${slug}`);
  const runs = () => runStateOf(join(wt, spec));
  h.remote.issues = [...h.remote.issues, issue(n, slug)];
  await h.tick("--sync");
  for (let i = 0; i < 10 && h.state(runs())?.step !== "implement"; i++) await tick();
  expect((await inWt(wt, "brief")).exit).toBe(0);
  await tick();
  h.write(join(wt, "src", `gh-${n}.ts`), "export const x = 1;\n");
  expect((await inWt(wt, "done", "done", "--handoff", "implemented")).exit).toBe(0);
  for (let i = 0; i < 10 && h.state(runs())?.step !== "review"; i++) await tick();
  expect((await inWt(wt, "brief")).exit).toBe(0);
  await tick();
  return { key: `gh-${n}`, wt, runs };
}
/** …and review's agent asks; the ask parks it. */
async function askingAtReview(n: number, slug: string) {
  const s = await atReview(n, slug);
  expect((await inWt(s.wt, "ask", "Which option?")).exit).toBe(0);
  await tick();
  expect(h.state(s.runs())).toMatchObject({ step: "review", status: "parked", park: { kind: "ask" } });
  return s;
}
/** …and review approves: the story waits at the ready gate. */
async function atReadyGate(n: number, slug: string) {
  const s = await atReview(n, slug);
  expect((await inWt(s.wt, "done", "approve", "--handoff", "looks good")).exit).toBe(0);
  for (let i = 0; i < 10 && h.state(s.runs())?.park?.kind !== "gate"; i++) await tick();
  expect(h.state(s.runs())).toMatchObject({ step: "ready", status: "parked", park: { kind: "gate" } });
  return s;
}

const mailbox = (story: string) => sh(h.dir, ["ls-remote", h.remoteDir, `${mailboxPrefix(story)}*`]);
/** The receipt a mailbox ref holds on the bare remote. */
const posted = (ref: string): Record<string, unknown> => JSON.parse(sh(h.dir, ["--git-dir", h.remoteDir, "cat-file", "blob", ref]));
const checkItems = async (story: string): Promise<InboxItem[]> => {
  const r = await h.norn("status", "--json");
  expect(r.exit).toBe(0);
  return ((r.value as { groups: Record<string, InboxItem[]> }).groups.check ?? []).filter((i) => i.story === story);
};

beforeAll(async () => {
  h = await createHarness();
  expect((await h.norn("init")).exit).toBe(0);
  h.config(CONFIG);
  h.write(repoConfigPath(h.root), teamConfig("remote"));
  h.write(join(workflowsDir(h.root), "quad.yaml"), QUAD);
  h.write(join(workflowsDir(h.root), "duo.yaml"), DUO);
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn init"]);
  h.git(["push", "-q", "origin", "main"]);
  B = cloneOf("repo-b", "bob", "repo-b");
});
afterAll(() => h.cleanup());

describe("under remote (B20)", () => {
  test("AC2: B's approval is stamped with the step and attempt of the fetched record ref", async () => {
    const s = await atReadyGate(20, "remote-gate");
    const r = await B.norn("story", "approve", "gh-20", "--json");
    expect(r.exit).toBe(0);
    const v = r.value as Verb;
    expect(v.delivered).toMatchObject({ via: "mailbox", holder: "tester@box" });
    expect(v.receipt).toMatchObject({ kind: "approve", step: "ready", attempt: 1, who: "bob@repo-b" });
    expect(posted(v.delivered.ref as string)).toMatchObject({ kind: "approve", step: "ready", attempt: 1 });
    await tick("--sync");
    await tick();
    expect(h.state(s.runs())).toMatchObject({ step: "$done", status: "done", last_outcome: { outcome: "approve", source: "human" } });
  });

  test("AC2: B's answer is stamped with the step and attempt of the fetched record ref; the holder applies it", async () => {
    const s = await askingAtReview(28, "remote-ask");
    const r = await B.norn("story", "answer", "gh-28", "use option b", "--json");
    expect(r.exit).toBe(0);
    const v = r.value as Verb;
    expect(v.delivered).toMatchObject({ via: "mailbox", holder: "tester@box" });
    expect(v.receipt).toMatchObject({ kind: "answer", step: "review", attempt: 1, answer: "use option b", who: "bob@repo-b" });
    expect(posted(v.delivered.ref as string)).toMatchObject({ kind: "answer", step: "review", attempt: 1 });
    await tick("--sync");
    expect(mailbox("gh-28")).toBe("");
    await tick();
    expect(h.state(s.runs())).toMatchObject({ step: "review", attempt: 1, park: null });
  });
});

describe("under local (B20)", () => {
  beforeAll(() => setPolicy("local"));

  test("AC1: B's answer is stamped with the step the last boundary led to and no attempt; the reply names the holder", async () => {
    const s = await askingAtReview(21, "local-ask");
    const r = await B.norn("story", "answer", "gh-21", "use option b", "--json");
    expect(r.exit).toBe(0);
    const v = r.value as Verb;
    expect(v.delivered).toMatchObject({ via: "mailbox", holder: "tester@box" });
    expect(v.delivered.ref).toStartWith(mailboxPrefix("gh-21"));
    expect(v.receipt).toMatchObject({ kind: "answer", step: "review", answer: "use option b", who: "bob@repo-b" });
    expect(v.receipt).not.toHaveProperty("attempt");
    expect(v.next).toBe("sent to tester@box; the holder checks it against the step it is at (last boundary: implement -> review)");
    const blob = posted(v.delivered.ref as string);
    expect(blob).toMatchObject({ kind: "answer", step: "review" });
    expect(blob).not.toHaveProperty("attempt");

    // the holder matches it by step alone, and keeps it with the attempt it matched
    await tick("--sync");
    expect(mailbox("gh-21")).toBe("");
    await tick();
    expect(h.state(s.runs())).toMatchObject({ step: "review", attempt: 1, park: null });
    const answer = readTrace(h.root, { unit: "gh-21", types: ["reject"] }).events;
    expect(answer).toEqual([]);
  });

  test("AC1: story approve behaves the same", async () => {
    const s = await atReadyGate(22, "local-gate");
    const r = await B.norn("story", "approve", "gh-22", "--reason", "ship it", "--json");
    expect(r.exit).toBe(0);
    const v = r.value as Verb;
    expect(v.receipt).toMatchObject({ kind: "approve", step: "ready", comment: "ship it" });
    expect(v.receipt).not.toHaveProperty("attempt");
    expect(v.next).toBe("sent to tester@box; the holder checks it against the step it is at (last boundary: review -> ready)");
    // the same decision twice is refused before it reaches the mailbox
    const again = await B.norn("story", "approve", "gh-22", "--json");
    expect(again.exit).toBe(3);
    expect(again.value).toMatchObject({ code: "already_recorded", error: expect.stringContaining("approve already recorded for ready (refs/norn/inbox/gh-22/") });
    // a rejection decides the same gate: refused alike, before it reaches the mailbox
    const reject = await B.norn("story", "reject", "gh-22", "--reason", "not yet", "--json");
    expect(reject.value).toMatchObject({ code: "already_recorded", error: expect.stringContaining("approve already recorded for ready (") });
    await tick("--sync");
    await tick();
    expect(h.state(s.runs())).toMatchObject({ step: "$done", status: "done", last_outcome: { outcome: "approve", source: "human" } });
  });
});

describe("under local, what needs the holder's run state (B20, F1, F2)", () => {
  let gh25: Awaited<ReturnType<typeof atReadyGate>>;

  test("a verb that cannot go through the mailbox keeps its refusal on a non-holder: no step-only receipt", async () => {
    gh25 = await atReadyGate(25, "not-here");
    const before = mailbox("gh-25");
    const refusals: Array<[string[], string]> = [
      [["story", "update-branch", "gh-25"], "unknown_unit"],
      [["run", "cancel", "gh-25"], "not_holder"],
      [["story", "edit", "gh-25", "--auto"], "unknown_unit"],
      [["story", "edit", "gh-25", "--workflow", "quad"], "unknown_unit"],
    ];
    for (const [argv, code] of refusals) {
      const r = await B.norn(...argv, "--json");
      expect({ argv, exit: r.exit, code: (r.value as { code?: string }).code }).toEqual({ argv, exit: 3, code });
    }
    expect(mailbox("gh-25")).toBe(before);
  });

  test("run rerun --step or --reset from a non-holder is refused: the pinned workflow is on the holder", async () => {
    for (const argv of [["--step", "nosuch"], ["--step", "implement"], ["--reset", "review_loop"]]) {
      const r = await B.norn("run", "rerun", "gh-25", ...argv, "--json");
      expect(r.exit).toBe(3);
      expect(r.value).toMatchObject({ code: "story_not_local", error: expect.stringContaining("pinned workflow is on the machine that holds it") });
    }
    expect(mailbox("gh-25")).toBe("");
  });

  test("a plain run rerun goes step-only through the mailbox; the holder applies it at that step", async () => {
    const r = await B.norn("run", "rerun", "gh-25", "--reason", "try again", "--json");
    expect(r.exit).toBe(0);
    const v = r.value as Verb;
    expect(v.receipt).toMatchObject({ kind: "unstick", step: "ready", comment: "try again" });
    expect(v.receipt).not.toHaveProperty("attempt");
    expect(v.receipt).not.toHaveProperty("to");
    await tick("--sync");
    await tick();
    expect(h.state(gh25.runs())).toMatchObject({ step: "ready", attempt: 2, status: "parked", park: { kind: "gate" } });
    expect(await checkItems("gh-25")).toEqual([]);
  });

  test("R2-F10: a step-only story reject from a non-holder: the holder routes it back", async () => {
    const r = await B.norn("story", "reject", "gh-25", "--reason", "not like this", "--json");
    expect(r.exit).toBe(0);
    const v = r.value as Verb;
    expect(v.receipt).toMatchObject({ kind: "reject", step: "ready", comment: "not like this", who: "bob@repo-b" });
    expect(v.receipt).not.toHaveProperty("attempt");
    await tick("--sync");
    await tick();
    expect(h.state(gh25.runs())).toMatchObject({ step: "implement", counters: { review_loop: 1 } });
  });
});

describe("a receipt the holder rejects (B21)", () => {
  let gh23: Awaited<ReturnType<typeof askingAtReview>>;
  let gh24: Awaited<ReturnType<typeof askingAtReview>>;
  const title = (key: string, at: string) => `answer from bob@repo-b for ${key} was rejected: ${key} is at ${at} now`;

  test("AC3: an answer stamped for review reaches A after it moved to implement: rejected, traced, and a Check item on A", async () => {
    gh23 = await askingAtReview(23, "moved-on");
    // A moves the cursor by hand: no boundary commit, so B still sees review as the step it is at
    expect((await h.norn("run", "rerun", "gh-23", "--step", "implement")).exit).toBe(0);
    await tick();
    expect(h.state(gh23.runs())).toMatchObject({ step: "implement" });
    const r = await B.norn("story", "answer", "gh-23", "use option b", "--json");
    expect(r.exit).toBe(0);
    expect((r.value as Verb).receipt).toMatchObject({ step: "review" });

    await tick("--sync");
    expect(mailbox("gh-23")).toBe("");
    const rejects = readTrace(h.root, { unit: "gh-23", types: ["reject"] }).events as Array<{ source: string; reason: string }>;
    expect(rejects).toContainEqual(expect.objectContaining({ source: expect.stringContaining(mailboxPrefix("gh-23")), reason: expect.stringContaining("gh-23 is not at review") }));
    expect((await checkItems("gh-23")).map((i) => i.title)).toEqual([title("gh-23", "implement")]);
    expect((await h.norn("status")).stdout).toContain(title("gh-23", "implement"));
    // it stays: nothing accepted since
    await tick();
    expect((await checkItems("gh-23")).map((i) => i.title)).toEqual([title("gh-23", "implement")]);
  });

  test("AC4: a later answer accepted for the story clears it; there is no dismiss command", async () => {
    expect((await inWt(gh23.wt, "brief")).exit).toBe(0);
    await tick();
    expect((await inWt(gh23.wt, "ask", "Which file?")).exit).toBe(0);
    await tick();
    expect(h.state(gh23.runs())).toMatchObject({ step: "implement", park: { kind: "ask" } });
    expect((await h.norn("story", "answer", "gh-23", "src/a.ts")).exit).toBe(0);
    await tick();
    expect(h.state(gh23.runs())?.park).toBeNull();
    expect(await checkItems("gh-23")).toEqual([]);
    expect((await h.norn("help", "--json")).stdout).not.toContain("dismiss");
  });

  test("B21: a gate rejection accepted later does not clear it; the item names the step the unit is at now", async () => {
    gh24 = await askingAtReview(24, "gate-reject");
    expect((await h.norn("run", "rerun", "gh-24", "--step", "ready")).exit).toBe(0);
    await tick();
    expect(h.state(gh24.runs())).toMatchObject({ step: "ready", park: { kind: "gate" } });
    expect((await B.norn("story", "answer", "gh-24", "use option b")).exit).toBe(0);
    await tick("--sync");
    expect((await checkItems("gh-24")).map((i) => i.title)).toEqual([title("gh-24", "ready")]);
    expect((await h.norn("story", "reject", "gh-24", "--reason", "redo it")).exit).toBe(0);
    await tick();
    expect(h.state(gh24.runs())).toMatchObject({ step: "implement" });
    expect((await checkItems("gh-24")).map((i) => i.title)).toEqual([title("gh-24", "implement")]);
  });

  test("AC4: the story finishing clears it, with no answer or approval accepted since", async () => {
    const spec = ".agents/specs/gh-27-finish-alone";
    const wt = h.worktree("gh-27-finish-alone");
    const runs = () => runStateOf(join(wt, spec));
    h.remote.issues = [...h.remote.issues, issue(27, "finish-alone", ["norn", "norn:wf:duo"])];
    await h.tick("--sync");
    const finishStep = async (step: string) => {
      for (let i = 0; i < 10 && h.state(runs())?.step !== step; i++) await tick();
      expect((await inWt(wt, "brief")).exit).toBe(0);
      await tick();
      h.write(join(wt, "src", `gh-27-${step}.ts`), "export const x = 1;\n");
      expect((await inWt(wt, "done", "done", "--handoff", step)).exit).toBe(0);
    };
    await finishStep("draft");
    for (let i = 0; i < 10 && h.state(runs())?.step !== "implement"; i++) await tick();
    expect((await inWt(wt, "brief")).exit).toBe(0);
    await tick();
    expect((await inWt(wt, "ask", "Which option?")).exit).toBe(0);
    await tick();
    expect(h.state(runs())).toMatchObject({ step: "implement", park: { kind: "ask" } });
    // the cursor moves by hand: B still sees implement as the step it is at
    expect((await h.norn("run", "rerun", "gh-27", "--step", "draft")).exit).toBe(0);
    await tick();
    expect((await B.norn("story", "answer", "gh-27", "use option b")).exit).toBe(0);
    await tick("--sync");
    expect((await checkItems("gh-27")).map((i) => i.title)).toEqual([title("gh-27", "draft")]);
    // no answer or approval from here on: draft and implement end with their agents' outcomes
    await finishStep("draft");
    await finishStep("implement");
    for (let i = 0; i < 10 && h.state(runs())?.status !== "done"; i++) await tick();
    expect(h.state(runs())).toMatchObject({ step: "$done", status: "done" });
    expect(await checkItems("gh-27")).toEqual([]);
  });

  test("F4: the rejection is kept before the mailbox ref goes: a failed keep leaves the ref for the next tick", async () => {
    const s26 = await askingAtReview(26, "kept-first");
    expect((await h.norn("run", "rerun", "gh-26", "--step", "implement")).exit).toBe(0);
    await tick();
    expect((await B.norn("story", "answer", "gh-26", "use option b")).exit).toBe(0);
    // rejected.json cannot be written this tick: a folder (not empty) stands where the file goes
    const file = rejectedReceiptsPath(h.root);
    const aside = `${file}.aside`;
    renameSync(file, aside);
    mkdirSync(file);
    writeFileSync(join(file, "x"), "");
    try {
      await tick("--sync");
      expect(mailbox("gh-26")).toContain(mailboxPrefix("gh-26"));
    } finally {
      rmSync(file, { recursive: true });
      renameSync(aside, file);
    }
    await tick("--sync");
    expect(mailbox("gh-26")).toBe("");
    expect((await checkItems("gh-26")).map((i) => i.title)).toEqual([title("gh-26", "implement")]);
    expect(h.state(s26.runs())).toMatchObject({ step: "implement" });
    // the unit moves on without an answer or approval: the item stays and names the step it is at now
    expect((await inWt(s26.wt, "brief")).exit).toBe(0);
    await tick();
    expect((await inWt(s26.wt, "done", "done", "--handoff", "implemented again")).exit).toBe(0);
    for (let i = 0; i < 10 && h.state(s26.runs())?.step !== "review"; i++) await tick();
    expect((await checkItems("gh-26")).map((i) => i.title)).toEqual([title("gh-26", "review")]);
  });

  test("F3: norn tidy drops cleared rejected receipts older than trace.retain; an open one stays", async () => {
    type Kept = { story: string; receipt_id: string };
    const kept = () => (JSON.parse(h.read(rejectedReceiptsPath(h.root))).receipts as Kept[]).map((r) => r.story).sort();
    const idOf = (story: string) => (JSON.parse(h.read(rejectedReceiptsPath(h.root))).receipts as Kept[]).filter((r) => r.story === story).map((r) => r.receipt_id);
    expect(kept()).toEqual(["gh-23", "gh-24", "gh-26", "gh-27"]);
    // gh-23 was cleared by a later answer, gh-27 finished; gh-24 and gh-26 still show
    const cleared = [...idOf("gh-23"), ...idOf("gh-27")].sort();
    const young = await h.norn("tidy", "--json");
    expect(young.value).toMatchObject({ removed: { rejected_receipts: [] } });
    h.clock.advance(15 * 86_400_000);
    const dry = (await h.norn("tidy", "--dry-run", "--json")).value as { would_remove: { rejected_receipts: string[] } };
    expect([...dry.would_remove.rejected_receipts].sort()).toEqual(cleared);
    expect(kept()).toEqual(["gh-23", "gh-24", "gh-26", "gh-27"]);
    const r = (await h.norn("tidy", "--json")).value as { removed: { rejected_receipts: string[] } };
    expect([...r.removed.rejected_receipts].sort()).toEqual(cleared);
    expect(kept()).toEqual(["gh-24", "gh-26"]);
    // fifteen days on, the claims are renewed by the next tick; the open items still show
    await tick("--sync");
    expect((await checkItems("gh-26")).map((i) => i.title)).toEqual([title("gh-26", "review")]);
    expect((await checkItems("gh-24")).map((i) => i.title)).toEqual([title("gh-24", "implement")]);
  });
});

