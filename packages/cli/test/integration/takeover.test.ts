/**
 * A story moved between two machines on the refs store, and back, through the CLI alone: two clones
 * of one bare remote, each with its own norn home and user. Alice's machine builds the story (its
 * agent commits) and starts the review; her review agent reports while she holds the claim, but
 * before her next tick publishes it. Bob takes the story over: his tick finds alice's run gone,
 * retries the review in a worktree of his own, which must hold alice's committed work. Alice's
 * machine then shows the run data it never published; her take back carries the story on from the
 * remote's record, and her flushes go through again. Bob's review agent, reporting after the claim
 * moved back, is told so and changes nothing.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { agentNotes, awaitNote, machineOf, type NornOut, norn, otherMachine, plans, sh, TEST_PLUGIN, type World, world } from "./world.ts";

const KEY = "lt-1";
const SLOW = 300_000;
const TAKEOVER = ["name: takeover", "start: build", "steps:", "  build:", "    agent: Build the thing.", "    outcomes: { done: review }", "  review:", "    agent: Review the thing.", "    outcomes: { done: $done }", ""].join("\n");
const ALICE = { USER: "alice" };
const BOB = { USER: "bob" };

interface StoryStatus {
  key: string;
  claim: { holder: string } | null;
  unsynced?: { text: string; next: string };
  units: { id: string; step: string | null; run: { id: string } | null }[];
}

/** One clone on the refs store with the takeover workflow; its machine dir. */
async function setUpRefs(w: World, silentAfter: string): Promise<string> {
  const added = await norn(w, ["plugin", "add", TEST_PLUGIN, "--json"]);
  const init = await norn(w, ["init", "--tracker", "local", "--forge", "none", "--store", "refs", "--executor", "test", "--runner", "headless", "--yes", "--json"]);
  if (init.code !== 0) throw new Error(`init: ${init.stdout}${init.stderr}`);
  mkdirSync(join(w.root, ".agents", "workflows"), { recursive: true });
  writeFileSync(join(w.root, ".agents", "workflows", "takeover.yaml"), TAKEOVER);
  for (const [key, value] of [
    ["packs", "[e2e]"],
    ["kernel.workflow", "takeover"],
    ["kernel.mode", "auto"],
    ["kernel.silent_after", silentAfter],
  ] as const) {
    const set = await norn(w, ["config", "set", key, value, "--json"]);
    if (set.code !== 0) throw new Error(`config set ${key}: ${set.stdout}${set.stderr}`);
  }
  return machineOf(added);
}

async function tickAs(w: World, env: Record<string, string>, rules: string[]): Promise<void> {
  const t = await norn(w, ["tick", "--json"], env);
  if (t.code !== 0) throw new Error(`tick exited ${t.code}: ${t.stdout}${t.stderr}`);
  rules.push(...((t.body.outcomes ?? []) as { decision: { rule: string }; ok: boolean }[]).map((o) => `${o.decision.rule}${o.ok ? "" : "!"}`));
}

async function storyOf(w: World, env: Record<string, string>): Promise<StoryStatus | null> {
  const r = await norn(w, ["status", "--json"], env);
  if (r.code !== 0) throw new Error(`status: ${r.stdout}${r.stderr}`);
  return ((r.body.stories ?? []) as StoryStatus[]).find((s) => s.key === KEY) ?? null;
}

async function tickUntil(w: World, env: Record<string, string>, rules: string[], done: (s: StoryStatus | null) => boolean): Promise<StoryStatus | null> {
  for (let i = 0; i < 40; i++) {
    await tickAs(w, env, rules);
    const s = await storyOf(w, env);
    if (done(s)) return s;
    await Bun.sleep(300);
  }
  throw new Error(`no convergence; rules: ${rules.join(", ")}`);
}

/** The id of the run whose agent noted `what` and is not one of `seen`. */
async function runNoting(w: World, what: string, seen: string[] = []): Promise<string> {
  for (const until = Date.now() + 20_000; Date.now() < until; await Bun.sleep(100)) {
    const found = agentNotes(w).find((n) => n.note === what && !seen.includes(n.run));
    if (found) return found.run;
  }
  throw new Error(`no run noted ${what}`);
}

/** `norn done done` as a step agent runs it, from its worktree under its run's env. */
async function reportAs(w: World, env: Record<string, string>, worktree: string, runId: string): Promise<NornOut> {
  // the hang plan leaves a file the agent never commits; a report with it there is refused for that alone
  rmSync(join(worktree, "wip.txt"), { force: true });
  return norn(w, ["done", "done", "--json"], { ...env, NORN_UNIT: KEY, NORN_RUN_ID: runId }, worktree);
}

describe("a story taken over on the refs store, and taken back", () => {
  let a: World;
  let b: World;
  const host = hostname();
  const alice: string[] = [];
  const bob: string[] = [];
  const aliceBack: string[] = [];
  const bobAfter: string[] = [];
  let built: string;
  let publishedAtReview: string;
  let aliceReport: NornOut;
  let bobTook: NornOut;
  let bobWorktree: string;
  let bobRetried: StoryStatus | null;
  let aliceUnsynced: StoryStatus | null;
  let aliceTookBack: NornOut;
  let aliceAfter: StoryStatus | null;
  let aliceView: NornOut;
  let bobLate: NornOut;
  let bobAfterStatus: StoryStatus | null;
  let runsAtRemote: { alice: string; remote: string };

  beforeAll(async () => {
    a = await world("work");
    b = await otherMachine(a);
    const machineA = await setUpRefs(a, "30m");
    const machineB = await setUpRefs(b, "2s");
    plans(a, { build: "work", review: "hang" });
    plans(b, { review: "hang" });
    await norn(a, ["story", "create", "Build it", "--workflow", "takeover", "--json"], ALICE);
    await tickUntil(a, ALICE, alice, (s) => s?.units[0]?.step === "review" && s.units[0].run !== null);
    const aliceReview = await runNoting(a, "pid");
    await awaitNote(a, "pid");
    built = await sh(a.root, "git", "rev-parse", `refs/heads/norn/${KEY}`);
    publishedAtReview = await sh(a.remote, "git", "rev-parse", `refs/norn/heads/norn/${KEY}`);

    // alice's review agent reports while she still holds the claim; her machine publishes it on its next tick, which never comes
    aliceReport = await reportAs(a, ALICE, join(machineA, "worktrees", KEY), aliceReview);

    bobTook = await norn(b, ["story", "take", KEY, "--force", "--reason", "alice is away", "--json"], BOB);
    bobRetried = await tickUntil(b, BOB, bob, (s) => s?.units[0]?.run !== null && s?.units[0]?.run?.id !== aliceReview);
    const bobReview = await runNoting(a, "pid", [aliceReview]);
    bobWorktree = join(machineB, "worktrees", KEY);

    await tickAs(a, ALICE, aliceBack);
    aliceUnsynced = await storyOf(a, ALICE);
    aliceTookBack = await norn(a, ["story", "take", KEY, "--force", "--reason", "back again", "--json"], ALICE);
    await tickAs(a, ALICE, aliceBack);
    await tickAs(a, ALICE, aliceBack);
    aliceAfter = await storyOf(a, ALICE);
    aliceView = await norn(a, ["story", "view", KEY, "--json"], ALICE);
    runsAtRemote = {
      alice: await sh(a.root, "git", "rev-parse", `refs/norn/v2/runs/${KEY}`),
      remote: await sh(a.remote, "git", "rev-parse", `refs/norn/v2/runs/${KEY}`),
    };

    bobLate = await reportAs(b, BOB, bobWorktree, bobReview);
    await tickAs(b, BOB, bobAfter);
    bobAfterStatus = await storyOf(b, BOB);
  }, SLOW);

  afterAll(async () => {
    for (const n of agentNotes(a ?? ({ notes: "" } as World)).filter((x) => x.note === "pid")) await Bun.$`kill -9 ${n.value as number}`.nothrow().quiet();
  });

  test("each agent step's committed work reaches the remote as a published head, never as a branch", async () => {
    expect(publishedAtReview).toBe(built);
    expect(await sh(a.remote, "git", "for-each-ref", "--format=%(refname)", "refs/heads")).toBe("refs/heads/main");
  });

  test("bob's take moves the claim, and his retried review runs in a worktree that holds alice's commit, not the base", async () => {
    expect(aliceReport.code).toBe(0);
    expect(bobTook.body).toMatchObject({ taken: true, from: `alice@${host}`, holder: `bob@${host}` });
    expect(bob).toContain("agent.died.retry");
    expect(bobRetried?.claim?.holder).toBe(`bob@${host}`);
    expect(existsSync(join(bobWorktree, "feature.txt"))).toBe(true);
    expect(await sh(bobWorktree, "git", "rev-parse", "HEAD")).toBe(built);
  });

  test("alice's machine, no longer the holder, shows the run data it never published with the command that resolves it", () => {
    expect(aliceBack.slice(0, 1)).toEqual(["claim.held_elsewhere"]);
    expect(aliceUnsynced?.unsynced).toEqual({ text: expect.stringContaining(`from before bob@${host} took the claim`), next: `norn story take ${KEY} --force` });
  });

  test("alice's take back carries the story on from the remote's record, keeping her own part under a ref, and her flushes go through", async () => {
    expect(aliceTookBack.code).toBe(0);
    const dropped = aliceTookBack.body.dropped as { commit: string; kept_at: string };
    expect(dropped.kept_at).toBe(`refs/norn/v2/dropped/runs/${KEY}/${dropped.commit}`);
    expect(await sh(a.root, "git", "rev-parse", dropped.kept_at)).toBe(dropped.commit);
    expect(aliceBack).toContain("store.flush");
    expect(aliceBack.filter((r) => r.endsWith("!"))).toEqual([]);
    expect(aliceAfter?.unsynced).toBeUndefined();
    expect(aliceAfter?.claim?.holder).toBe(`alice@${host}`);
    expect(runsAtRemote.alice).toBe(runsAtRemote.remote);
    expect((aliceView.body.takeovers as { from: string; to: string }[]).map((t) => [t.from, t.to])).toEqual([
      [`alice@${host}`, `bob@${host}`],
      [`bob@${host}`, `alice@${host}`],
    ]);
  });

  test("bob's review agent, reporting after the claim moved back, is told so and moves nothing on his machine", () => {
    expect(bobLate.code).toBe(3);
    expect(bobLate.body).toMatchObject({ code: "claim_moved", error: expect.stringContaining(`moved from bob@${host} to alice@${host}`) });
    expect(bobAfter.filter((r) => r.endsWith("!"))).toEqual([]);
    expect(bobAfterStatus?.unsynced).toBeUndefined();
  });
});
