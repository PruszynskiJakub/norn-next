/**
 * The shared refs store between clones of one remote, through the CLI alone. One clone's ticks
 * publish a story's run data only when it changed, keep a finished story's claim and worktree while
 * the remote refuses its last flush, even past the claim's expiry, and publish before they give the
 * claim up; `norn tidy` leaves run data alone. A second clone with its own norn home sees the
 * holder's story but neither reruns nor stops its run, never takes the holder's expired claim, and a
 * norn below the store's version floor is refused while it can still look. With the default local
 * store the remote never gets run data at all.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  agentNotes,
  awaitNote,
  logPushes,
  machineName,
  type NornOut,
  norn,
  otherMachine,
  pushes,
  refsUnder,
  rejectPushes,
  setUp,
  sh,
  type UnitShown,
  unitOf,
  worktreeOf,
  type World,
  world,
} from "./world.ts";

const KEY = "lt-1";
const SLOW = 240_000;
const RUN_REF = `refs/norn/v2/runs/${KEY}`;
const CLAIM_REF = `refs/norn/v2/claims/${KEY}`;
const FLOOR_REF = "refs/norn/v2/floor";
const GATED = ["name: gated", "start: look", "steps:", "  look:", "    gate: Is it right?", "    outcomes: { approve: $done, reject: $stuck }", ""].join("\n");
const HOLD = ["name: hold", "start: build", "steps:", "  build:", "    agent: Build the thing.", "    outcomes: { done: $done }", ""].join("\n");
const ALICE = { USER: "alice" };
const BOB = { USER: "bob" };
const NORN_VERSION = (JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "package.json"), "utf8")) as { version: string }).version;
/** A floor above this norn whatever its version: a fixed one stops being above it once a release bumps to it. */
const NEWER_FLOOR = `${Number(NORN_VERSION.split(".")[0]) + 1}.0.0`;

/** Every rule one tick fired, a failed action marked `!`; the tick's exit. */
async function tickAs(w: World, env: Record<string, string>, rules: string[]): Promise<NornOut> {
  const t = await norn(w, ["tick", "--json"], env);
  rules.push(...((t.body.outcomes ?? []) as { decision: { rule: string }; ok: boolean }[]).map((o) => `${o.decision.rule}${o.ok ? "" : "!"}`));
  return t;
}

async function tickUntil(w: World, env: Record<string, string>, rules: string[], done: (u: UnitShown | null) => boolean): Promise<void> {
  for (let i = 0; i < 40; i++) {
    const t = await tickAs(w, env, rules);
    if (t.code !== 0) throw new Error(`tick exited ${t.code}: ${t.stdout}${t.stderr}`);
    if (done(await unitOf(w, KEY))) return;
    await Bun.sleep(200);
  }
  throw new Error(`no convergence; rules: ${rules.join(", ")}`);
}

/**
 * A claim lifetime short enough for a test to outwait, set before the claim is taken (a claim keeps
 * the lifetime it was taken or renewed with), yet longer than a tick, which renews it every time.
 */
const SHORT_TTL_MS = 5_000;
async function shortClaims(w: World): Promise<void> {
  const set = await norn(w, ["config", "set", "kernel.claim_ttl", `${SHORT_TTL_MS}ms`, "--json"]);
  if (set.code !== 0) throw new Error(`config set: ${set.stdout}${set.stderr}`);
}

/** The commit a ref names on the remote, or "" when it has none. */
const remoteRef = (w: World, ref: string): Promise<string> => sh(w.root, "git", "ls-remote", w.remote, ref).then((l) => l.split(/\s/)[0] ?? "");

/**
 * What a newer norn leaves on the remote once it acted: the floor ref moved to `version`, on top of
 * the floor the store kept, as the store's own raise writes it.
 */
async function forgeFloor(w: World, version: string): Promise<void> {
  const blob = (await Bun.$`git -C ${w.remote} hash-object -w --stdin < ${new Response(JSON.stringify({ version }))}`.text()).trim();
  const tree = (await Bun.$`git -C ${w.remote} mktree < ${new Response(`100644 blob ${blob}\tfloor.json\n`)}`.text()).trim();
  const parent = await remoteRef(w, FLOOR_REF);
  const commit = await sh(w.remote, "git", "-c", "user.email=t@t", "-c", "user.name=t", "commit-tree", tree, ...(parent ? ["-p", parent] : []), "-m", `floor ${version}`);
  await sh(w.remote, "git", "update-ref", FLOOR_REF, commit);
}

describe("a clone's flushes of the shared record", () => {
  let a: World;
  const toGate: string[] = [];
  const idle: string[] = [];
  const refused: string[] = [];
  const after: string[] = [];
  let runPushesAtGate = 0;
  let runPushesIdle = 0;
  let claimWhileRefused = "";
  let remoteRunWhileRefused = "";
  let refusedUnit: UnitShown | null = null;
  let worktreeWhileRefused: string | null = null;
  const expiredRefused: string[] = [];
  let claimAfterExpiry = "";
  let localRun = "";
  let releasedAt = "";
  let floorText = "";
  let tidied: NornOut;
  let refsBeforeTidy: { local: string[]; remote: string[] };
  let refsAfterTidy: { local: string[]; remote: string[] };

  beforeAll(async () => {
    a = await world("work");
    logPushes(a);
    await setUp(a, { store: "refs", workflow: "gated", workflows: { gated: GATED } });
    await shortClaims(a);
    await norn(a, ["story", "create", "Look into it", "--json"]);
    await tickUntil(a, {}, toGate, (u) => u?.step === "look" && u.parked !== undefined);
    runPushesAtGate = pushes(a, RUN_REF).length;
    for (let i = 0; i < 2; i++) await tickAs(a, {}, idle);
    runPushesIdle = pushes(a, RUN_REF).length;

    const lift = rejectPushes(a, "refs/norn/v2/runs/");
    await norn(a, ["story", "approve", KEY, "--json"]);
    for (let i = 0; i < 3; i++) await tickAs(a, {}, refused);
    refusedUnit = await unitOf(a, KEY);
    worktreeWhileRefused = await worktreeOf(a, KEY);
    claimWhileRefused = await sh(a.remote, "git", "show", `${CLAIM_REF}:claim.json`);
    remoteRunWhileRefused = await remoteRef(a, RUN_REF);
    // a finished story's claim is never renewed, so it runs out: past it, the story must still not be released over its unpublished record
    for (let i = 0; i < 2; i++) {
      await Bun.sleep(SHORT_TTL_MS + 1_000);
      await tickAs(a, {}, expiredRefused);
      await tickAs(a, {}, expiredRefused);
    }
    claimAfterExpiry = await sh(a.remote, "git", "show", `${CLAIM_REF}:claim.json`);
    lift();
    await tickUntil(a, {}, after, () => after.includes("claim.release"));
    localRun = await sh(a.root, "git", "rev-parse", RUN_REF);
    releasedAt = await remoteRef(a, CLAIM_REF);
    floorText = await sh(a.remote, "git", "show", `${FLOOR_REF}:floor.json`);

    refsBeforeTidy = { local: await refsUnder(a.root), remote: await refsUnder(a.remote) };
    tidied = await norn(a, ["tidy", "--json"]);
    refsAfterTidy = { local: await refsUnder(a.root), remote: await refsUnder(a.remote) };
  }, SLOW);

  test("the first act raises the store's version floor on the remote to this norn", () => {
    expect(JSON.parse(floorText)).toEqual({ version: NORN_VERSION.replace(/[-+].*$/, "") });
  });

  test("a flush pushes the run data only when it changed: ticks over a parked gate push nothing", () => {
    expect(toGate).toContain("store.flush");
    expect(runPushesAtGate).toBeGreaterThan(0);
    expect(idle.filter((r) => r.endsWith("!"))).toEqual([]);
    expect(runPushesIdle).toBe(runPushesAtGate);
  });

  test("a finished story whose last flush the remote refuses keeps its claim, so no other clone reads the stale record as free", () => {
    expect(refusedUnit).toMatchObject({ ended: "done" });
    expect(refused).toContain("store.flush!");
    expect(refused).toContain("claim.release!");
    expect(refused).toContain("story.finish!");
    expect(refused).not.toContain("claim.release");
    expect(JSON.parse(claimWhileRefused)).not.toHaveProperty("released_at");
    expect(remoteRunWhileRefused).not.toBe(localRun);
    expect(worktreeWhileRefused).not.toBeNull();
  });

  test("past the kept claim's expiry a tick takes it back rather than releasing it over the unpublished record", () => {
    expect(expiredRefused).toContain("claim.reacquire");
    expect(expiredRefused).toContain("store.flush!");
    expect(expiredRefused).not.toContain("claim.release");
    expect(JSON.parse(claimAfterExpiry)).not.toHaveProperty("released_at");
  });

  test("once the remote takes pushes again the next tick publishes the record, then gives the claim up", async () => {
    expect(after).toEqual(expect.arrayContaining(["store.flush", "claim.release"]));
    expect(after.filter((r) => r.endsWith("!"))).toEqual([]);
    expect(await remoteRef(a, RUN_REF)).toBe(localRun);
    expect(JSON.parse(await sh(a.remote, "git", "show", `${CLAIM_REF}:claim.json`))).toHaveProperty("released_at");
    const log = pushes(a);
    const published = log.findLastIndex((l) => l.startsWith(`${RUN_REF} `) && l.split(" ")[2] === localRun);
    const released = log.findIndex((l) => l.startsWith(`${CLAIM_REF} `) && l.split(" ")[2] === releasedAt);
    expect(published).toBeGreaterThanOrEqual(0);
    expect(released).toBeGreaterThan(published);
  });

  test("norn tidy never lists or deletes run data refs, here or on the remote", () => {
    expect(tidied.code).toBe(0);
    expect(JSON.stringify(tidied.body)).not.toContain("refs/norn");
    expect(refsBeforeTidy.remote).toEqual(expect.arrayContaining([expect.stringContaining(RUN_REF), expect.stringContaining(FLOOR_REF)]));
    expect(refsAfterTidy).toEqual(refsBeforeTidy);
  });
});

describe("another clone while one clone holds the story", () => {
  let a: World;
  let b: World;
  let host = "";
  let pid = 0;
  let aliceRun = "";
  const bob: string[] = [];
  let bobStatus: NornOut;
  let bobRerun: NornOut;
  let bobStop: NornOut;
  let aliveAfterVerbs = false;
  let tooOld: NornOut;
  let lookBelowFloor: NornOut;
  let viewBelowFloor: NornOut;
  let offlineTake: NornOut;
  let offlineStatus: NornOut;

  beforeAll(async () => {
    a = await world("hang");
    b = await otherMachine(a);
    await setUp(a, { store: "refs", workflow: "hold", workflows: { hold: HOLD } });
    await setUp(b, { store: "refs", workflow: "hold", workflows: { hold: HOLD } });
    await norn(a, ["story", "create", "Build it", "--json"], ALICE);
    await tickUntil(a, ALICE, [], (u) => u?.step === "build" && u.run != null);
    pid = (await awaitNote(a, "pid")) as number;
    aliceRun = agentNotes(a).find((n) => n.note === "pid")?.run ?? "";
    host = machineName(a);

    await tickAs(b, BOB, bob);
    bobStatus = await norn(b, ["status", "--json"], BOB);
    bobRerun = await norn(b, ["run", "rerun", KEY, "--json"], BOB);
    bobStop = await norn(b, ["run", "stop", KEY, "--json"], BOB);
    aliveAfterVerbs = (await Bun.$`kill -0 ${pid}`.nothrow().quiet()).exitCode === 0;

    await forgeFloor(a, NEWER_FLOOR);
    tooOld = await norn(b, ["tick", "--json"], BOB);
    lookBelowFloor = await norn(b, ["status", "--json"], BOB);
    viewBelowFloor = await norn(b, ["story", "view", KEY, "--json"], BOB);

    await sh(b.root, "git", "remote", "set-url", "origin", join(a.dir, "gone.git"));
    offlineTake = await norn(b, ["story", "take", KEY, "--force", "--json"], BOB);
    offlineStatus = await norn(b, ["status", "--json"], BOB);
  }, SLOW);

  afterAll(async () => {
    if (pid) await Bun.$`kill -9 ${pid}`.nothrow().quiet();
  });

  test("the other clone's tick leaves the story alone, and its status shows the holder's step and run", () => {
    expect(bob.filter((r) => r !== "claim.held_elsewhere")).toEqual([]);
    expect(bob).toContain("claim.held_elsewhere");
    const story = ((bobStatus.body.stories ?? []) as { key: string; claim: { holder: string } | null; units: { step: string | null; run: { id: string } | null }[] }[]).find((s) => s.key === KEY);
    expect(story?.claim?.holder).toBe(`alice@${host}`);
    expect(story?.units[0]?.step).toBe("build");
    expect(story?.units[0]?.run?.id).toBe(aliceRun);
  });

  test("the other clone can neither rerun nor stop the holder's run, and the holder's agent lives on", () => {
    expect(bobRerun.code).toBe(3);
    expect(structuredClone(bobRerun.body)).toMatchObject({ code: "claim_held" });
    expect(bobStop.code).toBe(3);
    expect(structuredClone(bobStop.body)).toMatchObject({ code: "claim_held", error: expect.stringContaining(`alice@${host}`), do_instead: expect.stringContaining(`norn story take ${KEY} --force`) });
    expect(aliveAfterVerbs).toBe(true);
  });

  test("a norn below the store's version floor is refused when it acts, and still shows the story", () => {
    expect(tooOld.code).toBe(3);
    expect(structuredClone(tooOld.body)).toMatchObject({ code: "version_too_old", details: { floor: NEWER_FLOOR }, do_instead: expect.stringContaining(`upgrade norn to ${NEWER_FLOOR}`) });
    expect(lookBelowFloor.code).toBe(0);
    expect(viewBelowFloor.code).toBe(0);
  });

  test("with the remote out of reach an acting command is refused with what to do, notes the unchecked floor, and status still works", () => {
    expect(offlineTake.code).toBe(1);
    expect(structuredClone(offlineTake.body)).toMatchObject({ code: "unavailable", error: expect.stringContaining(`cannot sync the run data of ${KEY}`), do_instead: `norn story take ${KEY} again once the remote is reachable` });
    expect(offlineTake.stderr).toContain("norn version floor not checked");
    expect(offlineStatus.code).toBe(0);
  });
});

describe("another holder's expired claim", () => {
  let a: World;
  let b: World;
  let host = "";
  let bobTick: NornOut;
  let claimAfter: { holder: string; released_at?: string } | null = null;

  beforeAll(async () => {
    a = await world("work");
    b = await otherMachine(a);
    await setUp(a, { store: "refs", workflow: "gated", workflows: { gated: GATED } });
    await setUp(b, { store: "refs", workflow: "gated", workflows: { gated: GATED } });
    await shortClaims(a);
    await norn(a, ["story", "create", "Look into it", "--json"], ALICE);
    await tickUntil(a, ALICE, [], (u) => u?.step === "look" && u.parked !== undefined);
    host = machineName(a);
    // alice's ticks stop, so her claim runs out with no renew
    await Bun.sleep(SHORT_TTL_MS + 1_000);
    bobTick = await norn(b, ["tick", "--json"], BOB);
    claimAfter = JSON.parse(await sh(a.remote, "git", "show", `${CLAIM_REF}:claim.json`));
  }, SLOW);

  test("is never taken by another clone's tick, which names the take a person runs", () => {
    expect(bobTick.code).toBe(0);
    const outcomes = (bobTick.body.outcomes ?? []) as { decision: { rule: string; reason?: string } }[];
    expect(outcomes.map((o) => o.decision.rule)).toEqual(["claim.held_elsewhere"]);
    expect(outcomes[0]?.decision.reason).toContain(`the claim of alice@${host} expired`);
    expect(outcomes[0]?.decision.reason).toContain(`norn story take ${KEY} --force`);
    expect(claimAfter?.holder).toBe(`alice@${host}`);
    expect(claimAfter).not.toHaveProperty("released_at");
  });
});

describe("the default local store", () => {
  let w: World;
  let remoteRefs: string[] = [];

  beforeAll(async () => {
    w = await world("work");
    await setUp(w, { workflow: "gated", workflows: { gated: GATED } });
    await norn(w, ["story", "create", "Look into it", "--json"]);
    const rules: string[] = [];
    await tickUntil(w, {}, rules, (u) => u?.step === "look" && u.parked !== undefined);
    await norn(w, ["story", "approve", KEY, "--json"]);
    await tickUntil(w, {}, rules, (u) => u?.ended === "done" && rules.includes("claim.release"));
    remoteRefs = await refsUnder(w.remote);
  }, SLOW);

  test("leaves the remote without any run data ref", () => {
    expect(remoteRefs).toEqual([]);
  });
});
