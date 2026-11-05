/**
 * gh-195/14 (B27; D11, T7a, R2.3): the old holder's record after someone else holds the story. Taken over
 * without a release from it, the old holder's next tick sets its record aside whole under
 * `<machine dir>/superseded/<story>-<ulid>/`, pushes nothing for it and shows one Check item naming the
 * new holder and its last local receipt, until `norn tidy` deletes it after `trace.retain`. Handed over
 * cleanly (the record pushed before the claim went, B15), its copy is removed quietly, with no item.
 * Two clones of one bare remote (seam S1).
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { claimRef, recordRef, ulid } from "@norn/schema";
import type { Inbox } from "@norn/core";
import { appendReceipt, machineDir, readState, workflowsDir } from "@norn/store";
import type { TickReport } from "../../src/index.ts";
import { createHarness, type Harness, issue, sh } from "../../../../test/support/harness.ts";
import { cloneOf } from "../../../../test/support/clone.ts";
import { runStateOf, storyRunStateOf } from "../../../../test/support/run-state.ts";

setDefaultTimeout(120_000);

const RV = `name: rv
start: implement
steps:
  implement:
    type: agent
    skill: norn-implement
    outcomes: { done: { to: review, means: "built" } }
  review:
    type: agent
    skill: norn-review
    outcomes:
      approve: { to: $done, means: "good" }
      rework: { to: implement, counter: review_loop, means: "fix it" }
counters: { review_loop: { max: 3 } }
`;
const CONFIG = "provider: gh\nworkflow: rv\nmode: auto\n";

let h: Harness;

const state = (dir: string) => {
  const r = readState(dir);
  return r.ok ? r.value : null;
};
const tick = (): Promise<TickReport> => {
  h.clock.advance(10_000);
  return h.tick();
};
async function tickUntil(pred: () => boolean, max = 12) {
  for (let i = 0; i < max && !pred(); i++) await tick();
  expect(pred()).toBe(true);
}
function report(runsDir: string, outcome: string) {
  const st = state(runsDir);
  if (!st) throw new Error(`no state in ${runsDir}`);
  appendReceipt(runsDir, { kind: "done", receipt_id: ulid(h.clock.now()), run_id: st.run?.run_id ?? null, step: st.step, attempt: st.attempt, at: h.clock.iso(), by: "agent", outcome, handoff: `${st.step} ${outcome}` } as never);
}
const remoteRef = (ref: string): string | null => sh(h.dir, ["ls-remote", h.remoteDir, ref]).split(/\s+/)[0] || null;

interface Held {
  key: string;
  spec: string;
  branch: string;
  wt: (root: string) => string;
  runs: (root: string) => string;
}

/** A story clone A runs (rv) — `rounds` review reworks deep, at implement — then A goes silent; returns when its claim expires. */
async function heldThenSilent(n: number, slug: string, rounds: number): Promise<Held> {
  const key = `gh-${n}`;
  const spec = `.agents/specs/${key}-${slug}`;
  const branch = `${key}-${slug}`;
  const wt = (root: string) => `${root}-worktrees/${branch}`;
  const runs = (root: string) => runStateOf(join(wt(root), spec));
  h.remote.issues = [...h.remote.issues, issue(n, slug, ["norn", "norn:wf:rv"])];
  await h.tick("--sync");
  await tickUntil(() => state(runs(h.root))?.status === "running");
  for (let i = 0; i < rounds; i++) {
    report(runs(h.root), "done");
    await tickUntil(() => state(runs(h.root))?.step === "review" && state(runs(h.root))?.status === "running");
    report(runs(h.root), "rework");
    await tickUntil(() => state(runs(h.root))?.step === "implement" && state(runs(h.root))?.status === "running");
  }
  expect(state(runs(h.root))).toMatchObject({ step: "implement", attempt: rounds + 1, counters: { review_loop: rounds } });
  // `local`: A never pushed a record
  expect(remoteRef(recordRef(key))).toBeNull();
  return { key, spec, branch, wt, runs };
}

/** Let A's claim on `key` expire (A stopped ticking). */
function expire(key: string) {
  const blob = JSON.parse(sh(h.root, ["cat-file", "-p", claimRef(key)])) as { expires_at: string };
  h.clock.t = Math.max(h.clock.t, Date.parse(blob.expires_at) + 60_000);
}

function withHarness() {
  beforeAll(async () => {
    h = await createHarness();
    expect((await h.norn("init")).exit).toBe(0);
    h.config(CONFIG);
    h.write(join(workflowsDir(h.root), "rv.yaml"), RV);
    h.git(["add", "-A"]);
    h.git(["commit", "-q", "-m", "norn init"]);
    h.git(["push", "-q", "origin", "main"]);
  });
  afterAll(() => h.cleanup());
}

const superseded = () => join(machineDir(h.root), "superseded");
const supersededOf = (key: string) => (existsSync(superseded()) ? readdirSync(superseded()).filter((n) => n.startsWith(`${key}-`)) : []);
const checkItems = async (key: string) => ((await h.norn("status", "--json")).value as Inbox).groups.check.filter((i) => i.story === key);
const remoteRefs = () => sh(h.dir, ["ls-remote", h.remoteDir]);
const lastReceipt = (runs: string) => readdirSync(join(runs, "receipts")).sort().at(-1)?.replace(/\.json$/, "") as string;

describe("a takeover without a release supersedes the old holder's record (B27, D11)", () => {
  withHarness();

  test("AC1, AC2: after B takes gh-9 over on expiry, A's next tick sets its record aside, pushes nothing, shows one Check item; tidy keeps it, then deletes it after trace.retain", async () => {
    const s = await heldThenSilent(9, "parser", 1);
    // A's agent reported after A went silent: a receipt no record holds
    report(s.runs(h.root), "done");
    const last = lastReceipt(s.runs(h.root));
    expect(last).toMatch(/^\d{4}-done$/);
    expire(s.key);
    const B = cloneOf(h, "b-ac1", "bob");
    expect((await B.norn("story", "checkout", s.key)).exit).toBe(0);

    const before = remoteRefs();
    const round = relative(storyRunStateOf(join(s.wt(h.root), s.spec)), s.runs(h.root));
    h.clock.advance(10_000);
    const t = await h.tick("--sync");
    expect(t.decisions.filter((d) => d.unit === s.key).map((d) => `${d.rule} ${d.kind}${d.ok ? "" : " FAILED"}`)).toEqual(["record.superseded set_aside_record"]);
    // moved whole: nothing left in runs/, the copy under superseded/<story>-<ulid>/
    expect(existsSync(storyRunStateOf(join(s.wt(h.root), s.spec)))).toBe(false);
    const names = supersededOf(s.key);
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(new RegExp(`^${s.key}-[0-9A-HJKMNP-TV-Z]{26}$`));
    const copy = join(superseded(), names[0] as string);
    expect(existsSync(join(copy, "_story"))).toBe(true);
    expect(readdirSync(join(copy, round, "receipts")).sort().at(-1)).toBe(`${last}.json`);
    // nothing pushed for it: the remote's refs are as they were
    expect(remoteRefs()).toBe(before);
    expect(remoteRef(recordRef(s.key))).toBeNull();

    const title = `your record of ${s.key} was superseded when bob@b-ac1 took it over (last local receipt ${last})`;
    expect(await checkItems(s.key)).toEqual([expect.objectContaining({ id: `superseded:${s.key}:${last}`, group: "check", title })]);
    // the next tick does it no more: one copy, one item
    h.clock.advance(10_000);
    await h.tick("--sync");
    expect(supersededOf(s.key)).toHaveLength(1);
    expect((await checkItems(s.key)).map((i) => i.title)).toEqual([title]);

    // AC2: tidy keeps it within trace.retain, deletes it after, and the item goes with it
    const young = await h.norn("tidy", "--json");
    expect(young.exit).toBe(0);
    expect(young.value).toMatchObject({ removed: { superseded: [] } });
    expect(supersededOf(s.key)).toHaveLength(1);
    h.clock.advance(15 * 24 * 3600_000);
    const dry = await h.norn("tidy", "--dry-run", "--json");
    expect(dry.value).toMatchObject({ would_remove: { superseded: names } });
    expect(supersededOf(s.key)).toHaveLength(1);
    const old = await h.norn("tidy", "--json");
    expect(old.value).toMatchObject({ removed: { superseded: names } });
    expect(supersededOf(s.key)).toEqual([]);
    expect(await checkItems(s.key)).toEqual([]);
  });
});

describe("a clean handoff leaves no superseded copy (B27, D11, B15)", () => {
  withHarness();

  test("AC3: after A's story handoff and B's checkout, A's next tick removes its copy quietly: no runs/, nothing under superseded/, no Check item", async () => {
    const s = await heldThenSilent(10, "handed", 0);
    expect((await h.norn("story", "handoff", s.key)).exit).toBe(0);
    expect(existsSync(storyRunStateOf(join(s.wt(h.root), s.spec)))).toBe(true);
    const B = cloneOf(h, "b-ac3", "bob");
    h.clock.advance(10_000);
    expect((await B.norn("story", "checkout", s.key)).exit).toBe(0);
    // A's copy is the record its handoff pushed (its tree, Norn-Holder A), so nothing of A's is lost
    const before = remoteRefs();
    h.clock.advance(10_000);
    const t = await h.tick("--sync");
    expect(t.decisions.filter((d) => d.unit === s.key).map((d) => `${d.rule} ${d.kind}${d.ok ? "" : " FAILED"}`)).toEqual(["record.released set_aside_record"]);
    expect(existsSync(storyRunStateOf(join(s.wt(h.root), s.spec)))).toBe(false);
    expect(supersededOf(s.key)).toEqual([]);
    expect(existsSync(superseded()) ? readdirSync(superseded()) : []).toEqual([]);
    expect(await checkItems(s.key)).toEqual([]);
    expect(remoteRefs()).toBe(before);
  });
});
