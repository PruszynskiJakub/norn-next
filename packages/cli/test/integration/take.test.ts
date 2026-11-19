/**
 * Moving a story between holders through the CLI alone: alice's ticks carry a story to a gate and hold
 * its claim; bob's ticks leave it alone until `norn story take --force` moves the claim to him, then
 * bob's next ticks carry it to done while alice's act on nothing. Both holders share one machine dir
 * and so one local store, as two people on one box, or two machines over a shared claim, would.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { machineName, type NornOut, norn, setUp, type UnitShown, unitOf, type World, world } from "./world.ts";

const KEY = "lt-1";
const SLOW = 180_000;
const GATED = ["name: gated", "start: look", "steps:", "  look:", "    gate: Is it right?", "    outcomes: { approve: $done, reject: $stuck }", ""].join("\n");

const ALICE = { USER: "alice" };
const BOB = { USER: "bob" };

/** Every rule one holder's tick fired, a failed action marked `!`. */
async function tickAs(w: World, env: Record<string, string>, rules: string[]): Promise<void> {
  const t = await norn(w, ["tick", "--json"], env);
  if (t.code !== 0) throw new Error(`tick exited ${t.code}: ${t.stdout}${t.stderr}`);
  rules.push(...((t.body.outcomes ?? []) as { decision: { rule: string }; ok: boolean }[]).map((o) => `${o.decision.rule}${o.ok ? "" : "!"}`));
}

async function tickUntil(w: World, env: Record<string, string>, rules: string[], done: (u: UnitShown | null) => boolean): Promise<void> {
  for (let i = 0; i < 40; i++) {
    await tickAs(w, env, rules);
    if (done(await unitOf(w, KEY))) return;
    await Bun.sleep(200);
  }
  throw new Error(`no convergence; rules: ${rules.join(", ")}`);
}

describe("a story taken over by another holder, through the CLI alone", () => {
  let w: World;
  let host = "";
  const alice: string[] = [];
  const bobBefore: string[] = [];
  const bob: string[] = [];
  const aliceAfter: string[] = [];
  let refused: NornOut;
  let taken: NornOut;
  let again: NornOut;
  let view: NornOut;
  let ended: UnitShown | null = null;

  beforeAll(async () => {
    w = await world("work");
    await setUp(w);
    mkdirSync(join(w.root, ".agents", "workflows"), { recursive: true });
    writeFileSync(join(w.root, ".agents", "workflows", "gated.yaml"), GATED);
    await norn(w, ["story", "create", "Look into it", "--workflow", "gated", "--json"], ALICE);
    await tickUntil(w, ALICE, alice, (u) => u?.step === "look" && u.parked !== undefined);
    await tickAs(w, BOB, bobBefore);
    refused = await norn(w, ["story", "take", KEY, "--json"], BOB);
    taken = await norn(w, ["story", "take", KEY, "--force", "--reason", "alice is away", "--json"], BOB);
    again = await norn(w, ["story", "take", KEY, "--json"], BOB);
    await tickAs(w, ALICE, aliceAfter);
    await norn(w, ["story", "approve", KEY, "--json"], BOB);
    await tickUntil(w, BOB, bob, (u) => u?.ended === "done" && bob.includes("claim.release"));
    await tickAs(w, ALICE, aliceAfter);
    ended = await unitOf(w, KEY);
    view = await norn(w, ["story", "view", KEY, "--json"], BOB);
    host = machineName(w);
  }, SLOW);

  test("while alice holds the story, bob's tick leaves it alone and his take is refused naming her", () => {
    expect(alice).toEqual(expect.arrayContaining(["claim.take", "round.start"]));
    expect(bobBefore.filter((r) => r !== "claim.held_elsewhere")).toEqual([]);
    expect(refused.code).toBe(3);
    expect(refused.body).toMatchObject({ code: "claim_held", details: { holder: `alice@${host}`, expired: false } });
  });

  test("--force moves the claim to bob and puts the takeover on the record; taking it again is a no-op", () => {
    expect(taken.code).toBe(0);
    expect(taken.body).toMatchObject({ story: KEY, holder: `bob@${host}`, taken: true, from: `alice@${host}`, expired: false });
    expect(again.body).toMatchObject({ taken: false, holder: `bob@${host}` });
    expect(view.body.takeovers).toEqual([{ at: expect.any(String), from: `alice@${host}`, to: `bob@${host}`, by: `bob@${host}`, reason: "alice is away" }]);
  });

  test("bob's next ticks carry the story to done and give the claim up; alice's act on nothing", () => {
    expect(bob).toEqual(expect.arrayContaining(["receipts.apply", "story.finish", "claim.release"]));
    expect(bob.filter((r) => r.endsWith("!"))).toEqual([]);
    expect(ended).toMatchObject({ ended: "done" });
    expect(aliceAfter.every((r) => r === "claim.held_elsewhere")).toBe(true);
    expect(aliceAfter).toContain("claim.held_elsewhere");
  });
});
