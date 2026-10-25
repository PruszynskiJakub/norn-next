/**
 * The person's side of a story end to end (O1, O2, O5; dogfood audit F5, F21, F25, F28, Q3, Q4):
 * gate items name the report and evidence that led there, gate rulings reach every later brief,
 * the inbox history records when items came and went and who resolved them, `norn why` finds the
 * tick by step / attempt / transition / rule and quotes the reason, and the PR merge is an item.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { type CliResult, runCli } from "../src/index.ts";
import { createHarness, type Harness, issue } from "./harness.ts";

// whole flows over real git, several ticks each: 5 s is too tight on a loaded machine (full suite)
setDefaultTimeout(30_000);

const SHIP = `name: ship
start: work
steps:
  work:
    type: agent
    skill: norn-implement
    outcomes: { done: { to: qa, means: "built" } }
  qa:
    type: agent
    skill: norn-qa
    outcomes:
      pass: { to: open-pr, means: "verified" }
      partial: { to: human-qa, means: "a person must check some criteria; evidence prepared" }
  human-qa:
    type: gate
    prompt: "evidence attached"
    outcomes: { approve: open-pr, reject: { to: work, counter: loop } }
  open-pr:
    type: git
    action: open-pr
    outcomes: { done: ready }
  ready:
    type: gate
    prompt: "PR ready for review?"
    outcomes: { approve: $done }
counters: { loop: { max: 2 } }
`;

const CONFIG = `agents:
  claude: { adapter: claude }
remote: { provider: gh, label: norn }
default_workflow: ship
default_mode: manual
notifiers: []
`;

let h: Harness;
const spec = ".agents/specs/gh-7-count-items";
const wt = () => `${h.root}-worktrees/gh-7-count-items`;
const runs = () => join(wt(), spec, "runs/_story");
const tick = async (...flags: string[]) => {
  h.clock.advance(10_000);
  return h.tick(...flags);
};
const env = () => {
  const e: Record<string, string | undefined> = { ...h.deps.env, NORN_AGENT_PID: String(process.pid) };
  for (const k of ["NORN_AGENT", "NORN_RUN", "NORN_STORY", "NORN_SLICE", "NORN_AGENT_SESSION_ID"]) delete e[k];
  return e;
};
const inWt = (...argv: string[]): Promise<CliResult> => runCli(argv, { ...h.deps, cwd: wt(), env: env() });
type Brief = { markdown: string; run_id: string };
/** an agent run of the cursor step: brief (starts the run), then report; the tick applies it */
async function run(outcome: string, handoff: string, evidence = false): Promise<Brief> {
  const b = (await inWt("brief", "--json")).value as Brief;
  await tick();
  const extra: string[] = [];
  if (evidence) {
    h.write(join(wt(), "qa-out", "ac7-screenshot.md"), "AC7 needs a browser\n");
    extra.push("--evidence", "qa-out");
  }
  const r = await inWt("done", outcome, "--handoff", handoff, ...extra);
  expect(r.value).toMatchObject({ ok: true });
  await tick();
  return b;
}
type Inbox = { groups: Record<string, Array<{ id: string; title: string; detail?: string; command: string; url?: string }>> };
type History = { items: Array<{ id: string; group: string; title: string; appeared_at: string | null; resolved_at: string | null; resolved_by: string | null; url: string | null }>; open: number };

beforeAll(async () => {
  h = await createHarness();
  expect((await h.norn("init")).exit).toBe(0);
  h.write(join(h.root, ".agents/norn/config.yaml"), CONFIG);
  h.write(join(h.root, ".agents/norn/workflows/ship.yaml"), SHIP);
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn"]);
  h.git(["push", "-q", "origin", "main"]);
  h.remote.issues = [issue(7, "Count items")];
  for (let i = 0; i < 6 && h.state(runs())?.step !== "work"; i++) await tick();
  expect(h.state(runs())).toMatchObject({ step: "work", status: "ready" });
});
afterAll(() => h.cleanup());

describe("gate item and rulings (F21, F28)", () => {
  let qaRun: Brief;

  test("the human-qa item names the qa report and its evidence folder, absolute", async () => {
    await run("done", "built");
    qaRun = await run("partial", "AC6 vs B6: spec conflict, counted raw", true);
    expect(h.state(runs())).toMatchObject({ step: "human-qa", status: "parked" });
    const item = ((await h.norn("inbox")).value as Inbox).groups.approve?.[0];
    expect(item?.title).toBe("evidence attached");
    expect(item?.detail).toContain(`qa#1 reported partial: ${runs()}/receipts/`);
    expect(item?.detail).toContain(`evidence: ${runs()}/evidence/${qaRun.run_id}/`);
    expect(item?.detail).toContain('or reject: norn approve gh-7 --reject --reason "…"');
  });

  test("a reject reason is a ruling every later brief of the story carries", async () => {
    const judged = h.git(["rev-parse", "HEAD"], wt());
    const rej = await h.norn("approve", "gh-7", "--reject", "--reason", "AC6 wins over B6: show the raw count");
    expect(rej.exit).toBe(0);
    // C2: the ruling is tied to the head it judged
    expect(rej.value).toMatchObject({ receipt: { kind: "reject", head_sha: judged } });
    await tick();
    expect(h.state(runs())).toMatchObject({ step: "work", attempt: 2 });
    // the brief it sent back quotes it under Rework, not twice
    const back = (await inWt("brief", "--json")).value as Brief;
    expect(back.markdown).toContain("## Rework");
    expect(back.markdown).not.toContain("## Rulings");
    await tick();
    expect((await inWt("done", "done", "--handoff", "raw count")).exit).toBe(0);
    await tick();
    // a later step's brief carries the ruling
    const qa = (await inWt("brief", "--json")).value as Brief;
    expect(qa.markdown).toContain("## Rulings");
    expect(qa.markdown).toContain("- gh-7 human-qa#1 reject by tester@box");
    expect(qa.markdown).toContain(`at head \`${judged}\`:`);
    expect(qa.markdown).toContain("  > AC6 wins over B6: show the raw count");
    await tick();
    expect((await inWt("done", "partial", "--handoff", "AC7 still needs a browser")).exit).toBe(0);
    await tick();
    expect((await h.norn("approve", "gh-7", "--reason", "AC7 checked by hand")).exit).toBe(0);
    await tick();
    expect(h.state(runs())?.step).toBe("open-pr");
  });
});

describe("why by step, attempt, transition and rule (O5, F5)", () => {
  test("--transition finds the tick that applied the reject and quotes the comment", async () => {
    const r = await h.norn("why", "gh-7", "--transition", "human-qa.reject");
    expect(r.exit).toBe(0);
    expect(r.value).toMatchObject({
      unit: "gh-7",
      rule: expect.stringContaining("receipts"),
      action: "apply_receipts",
      trigger: { source: "receipt", kind: "reject", step: "human-qa", attempt: 1, outcome: "reject", by: "tester@box", reason: "AC6 wins over B6: show the raw count" },
      replay: { matches: true },
      matches: [expect.objectContaining({ trigger: "reject at human-qa#1" })],
    });
  });

  test("--step/--attempt pick the report of that attempt with its handoff in full", async () => {
    const r = await h.norn("why", "gh-7", "--step", "qa", "--attempt", "1");
    expect(r.value).toMatchObject({ trigger: { kind: "done", outcome: "partial", step: "qa", attempt: 1 } });
    expect((r.value as { trigger: { reason: string } }).trigger.reason).toStartWith("AC6 vs B6: spec conflict, counted raw");
    const second = await h.norn("why", "gh-7", "--transition", "qa.partial");
    expect((second.value as { matches: unknown[] }).matches).toHaveLength(2);
    expect(second.value).toMatchObject({ trigger: { attempt: 2, reason: "AC7 still needs a browser" } });
  });

  test("the intake decision is keyed by the story (F5)", async () => {
    const r = await h.norn("why", "gh-7", "--rule", "remote.intake");
    expect(r.exit).toBe(0);
    expect(r.value).toMatchObject({ unit: "gh-7", rule: "remote.intake", action: "intake_story", trigger: { source: "fact", kind: "remote_issue" }, replay: { matches: true } });
    expect((r.value as { trigger: { reason: string } }).trigger.reason).toContain("#7 Count items");
  });

  test("bad filters are usage errors; no match is refused", async () => {
    expect((await h.norn("why", "gh-7", "--transition", "qa")).exit).toBe(2);
    expect((await h.norn("why", "gh-7", "--attempt", "x")).exit).toBe(2);
    const none = await h.norn("why", "gh-7", "--transition", "qa.fail");
    expect(none.exit).toBe(3);
    expect(none.value).toMatchObject({ code: "no_tick" });
  });
});

describe("merge PR item and inbox history (F25, Q3)", () => {
  test("open-pr → ready → approve → $done: the open PR is 'Merge PR #N' with its URL", async () => {
    await tick(); // run_git open-pr
    await tick(); // apply → ready gate
    expect(h.state(runs())).toMatchObject({ step: "ready", status: "parked" });
    expect((await h.norn("approve", "gh-7")).exit).toBe(0);
    await tick();
    expect(h.state(runs())).toMatchObject({ step: "$done", status: "done" });
    await tick("--sync");
    const pr = h.remote.prs[0];
    const hist = (await h.norn("inbox", "--history")).value as History;
    const merge = hist.items.find((i) => i.id === `merge:gh-7:${pr?.number}`);
    expect(merge).toMatchObject({ group: "your_turn", title: `Merge PR #${pr?.number} (still a draft)`, url: pr?.url, resolved_at: null });
  });

  test("--history pairs appeared/resolved with who resolved each item", async () => {
    const hist = (await h.norn("inbox", "--history")).value as History;
    const gates = hist.items.filter((i) => i.group === "approve");
    expect(gates.map((g) => [g.id, g.resolved_by?.replace(/\(\d{4}-/, "(NNNN-")])).toEqual([
      ["approve:gh-7:human-qa#1", "reject by tester@box (NNNN-reject.json)"],
      ["approve:gh-7:human-qa#2", "approve by tester@box (NNNN-approve.json)"],
      ["approve:gh-7:ready#1", "approve by tester@box (NNNN-approve.json)"],
    ]);
    for (const g of gates) expect(Date.parse(g.resolved_at as string)).toBeGreaterThanOrEqual(Date.parse(g.appeared_at as string));
    expect(hist.open).toBeGreaterThanOrEqual(1);
    const text = (await h.norn("inbox", "--history", "--text")).stdout;
    expect(text).toContain("approve   human-qa: evidence attached (reject by tester@box");
    const later = (await h.norn("inbox", "--history", "--since", new Date(h.clock.now() + 60_000).toISOString())).value as History;
    expect(later.items).toEqual([]);
    expect((await h.norn("inbox", "--history", "--since", "soon")).exit).toBe(2);
  });

  test("the PR merge resolves the merge item", async () => {
    const pr = h.remote.prs[0];
    if (pr) Object.assign(pr, { state: "merged", merged_at: new Date(h.clock.now()).toISOString() });
    h.clock.advance(10 * 60_000);
    await tick("--sync");
    const hist = (await h.norn("inbox", "--history")).value as History;
    expect(hist.items.find((i) => i.id === `merge:gh-7:${pr?.number}`)?.resolved_at).not.toBeNull();
  });
});
