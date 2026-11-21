/**
 * Deciding a gate from another machine, through the CLI alone: two clones of one remote on the refs
 * store, each with its own norn home. Alice's machine carries a story to a gate and holds its claim;
 * bob's `norn story approve` goes to the story's mailbox, alice's next tick imports it and moves past
 * the gate, and bob's machine then sees the story done from the remote's run data.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { machineName, type NornOut, norn, otherMachine, TEST_PLUGIN, type UnitShown, unitOf, type World, world, writeWorkflow } from "./world.ts";

const KEY = "lt-1";
const SLOW = 240_000;
const GATED = ["name: gated", "start: look", "steps:", "  look:", "    gate: Is it right?", "    outcomes: { approve: $done, reject: $stuck }", ""].join("\n");
const ALICE = { USER: "alice" };
const BOB = { USER: "bob" };

/** One clone set up on the refs store, the gated workflow beside it. */
async function setUpRefs(w: World): Promise<void> {
  await norn(w, ["plugin", "add", TEST_PLUGIN, "--json"]);
  const init = await norn(w, ["init", "--tracker", "local", "--forge", "none", "--store", "refs", "--executor", "test", "--runner", "headless", "--yes", "--json"]);
  if (init.code !== 0) throw new Error(`init: ${init.stdout}${init.stderr}`);
  await writeWorkflow(w, "gated", GATED);
}

async function tickAs(w: World, env: Record<string, string>, rules: string[]): Promise<void> {
  const t = await norn(w, ["tick", "--json"], env);
  if (t.code !== 0) throw new Error(`tick exited ${t.code}: ${t.stdout}${t.stderr}`);
  rules.push(...((t.body.outcomes ?? []) as { decision: { rule: string }; ok: boolean }[]).map((o) => `${o.decision.rule}${o.ok ? "" : "!"}`));
}

async function tickUntil(w: World, env: Record<string, string>, rules: string[], done: (u: UnitShown | null) => boolean): Promise<void> {
  for (let i = 0; i < 30; i++) {
    await tickAs(w, env, rules);
    if (done(await unitOf(w, KEY))) return;
    await Bun.sleep(200);
  }
  throw new Error(`no convergence; rules: ${rules.join(", ")}`);
}

describe("a gate decided on another machine reaches the holder through the mailbox", () => {
  let a: World;
  let b: World;
  let host = "";
  const alice: string[] = [];
  const bob: string[] = [];
  let bobAtGate: UnitShown | null = null;
  let approved: NornOut;
  let resent: NornOut;
  let aliceAfter: UnitShown | null = null;
  let bobAfter: UnitShown | null = null;
  let bobView: NornOut;

  beforeAll(async () => {
    a = await world("work");
    b = await otherMachine(a);
    await setUpRefs(a);
    await setUpRefs(b);
    await norn(a, ["story", "create", "Look into it", "--workflow", "gated", "--json"], ALICE);
    await tickUntil(a, ALICE, alice, (u) => u?.step === "look" && u.parked !== undefined);
    await tickAs(b, BOB, bob);
    bobAtGate = await unitOf(b, KEY);
    approved = await norn(b, ["story", "approve", KEY, "--reason", "looks right", "--json"], BOB);
    resent = await norn(b, ["story", "approve", KEY, "--json"], BOB);
    await tickUntil(a, ALICE, alice, (u) => u?.ended === "done" && alice.includes("claim.release"));
    aliceAfter = await unitOf(a, KEY);
    await tickAs(b, BOB, bob);
    bobAfter = await unitOf(b, KEY);
    bobView = await norn(b, ["story", "view", KEY, "--json"], BOB);
    host = machineName(a);
  }, SLOW);

  test("bob's machine sees alice's story parked at the gate and leaves it to her", () => {
    expect(bobAtGate).toMatchObject({ step: "look", parked: "gate.park" });
    expect(bob[0]).toBe("claim.held_elsewhere");
  });

  test("bob's approve is sent to alice, once however often it is sent", () => {
    expect(approved.code).toBe(0);
    expect(approved.body).toMatchObject({ unit: KEY, step: "look", outcome: "approve", via: "mailbox", holder: `alice@${host}`, replayed: false });
    expect(resent.body).toMatchObject({ via: "mailbox", receipt_id: approved.body.receipt_id, replayed: true });
  });

  test("alice's next tick imports it and moves past the gate; bob's machine then shows the story done", () => {
    expect(alice).toEqual(expect.arrayContaining(["mailbox.import", "receipts.apply", "claim.release"]));
    expect(alice.filter((r) => r.endsWith("!"))).toEqual([]);
    expect(aliceAfter).toMatchObject({ ended: "done" });
    expect(bobAfter).toMatchObject({ ended: "done" });
    expect(bob.filter((r) => r.endsWith("!"))).toEqual([]);
    expect(bobView.body).toMatchObject({ units: [{ id: KEY, ended: "done", pending_receipts: 0 }] });
  });
});
