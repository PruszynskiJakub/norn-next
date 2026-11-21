/**
 * A story's next round through the CLI alone: a triage-like round ends done at its gate, the tick
 * finishes it (worktree removed, item left open, claim given up), and `norn story round` starts the
 * next workflow, which the tick picks up again, making the worktree again from the story's branch.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { type NornOut, norn, setUp, sh, status, type StoryShown, tickUntil, type World, world, writeWorkflow } from "./world.ts";

const KEY = "lt-1";
const SLOW = 180_000;

const TRIAGED = ["name: triaged", "start: look", "steps:", "  look:", "    gate: Recommend what comes next.", "    outcomes: { approve: $done, reject: $stuck }", ""].join("\n");

/** The worktrees git knows of for the story, with their branch. */
async function worktreesOf(w: World): Promise<string[]> {
  const list = await sh(w.root, "git", "worktree", "list", "--porcelain");
  const out: string[] = [];
  let path = "";
  for (const line of list.split("\n")) {
    if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
    if (line.startsWith("branch ") && path.endsWith(`/worktrees/${KEY}`)) out.push(line.slice("branch ".length));
  }
  return out;
}

describe("a story's next round, through the CLI alone", () => {
  let w: World;
  const rules: string[] = [];
  let ended: StoryShown | undefined;
  let worktreesAfterFinish: string[] = [];
  let early: NornOut;
  let unknownStep: NornOut;
  let round: NornOut;
  let again: NornOut;
  let started: StoryShown | undefined;
  let worktreesAfterRound: string[] = [];
  let unfinished: NornOut;

  beforeAll(async () => {
    w = await world("work");
    await setUp(w);
    await writeWorkflow(w, "triaged", TRIAGED);
    await norn(w, ["story", "create", "Look into it", "--workflow", "triaged", "--json"]);
    await tickUntil(w, rules, (u) => u?.step === "look" && u.parked !== undefined);
    early = await norn(w, ["story", "round", KEY, "--workflow", "e2e", "--json"]);
    await norn(w, ["story", "approve", KEY, "--json"]);
    await tickUntil(w, rules, (u) => u?.ended === "done");
    // the tick after the end finishes the story and gives up its claim
    await tickUntil(w, rules, () => rules.includes("claim.release"));
    ended = (await status(w)).stories.find((s) => s.key === KEY);
    worktreesAfterFinish = await worktreesOf(w);
    unknownStep = await norn(w, ["story", "round", KEY, "--workflow", "e2e", "--at", "nowhere", "--json"]);
    round = await norn(w, ["story", "round", KEY, "--workflow", "e2e", "--reason", "triage recommends building it", "--json"]);
    again = await norn(w, ["story", "round", KEY, "--workflow", "e2e", "--reason", "triage recommends building it", "--json"]);
    await tickUntil(w, rules, (u) => u?.step === "build" && u.ended === undefined && rules.includes("agent.start"));
    started = (await status(w)).stories.find((s) => s.key === KEY);
    worktreesAfterRound = await worktreesOf(w);
    unfinished = await norn(w, ["story", "round", KEY, "--workflow", "triaged", "--json"]);
  }, SLOW);

  test("a round under way is refused without --force, naming the flag", () => {
    expect(early.code).toBe(3);
    expect(early.body).toMatchObject({ code: "round_unfinished", do_instead: `norn story round ${KEY} --workflow e2e --force, to end it` });
    expect(unfinished.body).toMatchObject({ code: "round_unfinished" });
  });

  test("the round that ended done is finished: worktree removed, claim given up", () => {
    expect(ended?.units[0]).toMatchObject({ ended: "done" });
    expect(worktreesAfterFinish).toEqual([]);
    expect(rules.filter((r) => r.endsWith("!"))).toEqual([]);
  });

  test("the verb pins the workflow, refuses a step it lacks, and records once however often it is sent", () => {
    expect(unknownStep.body).toMatchObject({ code: "unknown_step", error: "workflow e2e has no step nowhere" });
    expect(round.code).toBe(0);
    expect(round.body).toMatchObject({ story: KEY, workflow: "e2e", at: "build", ended_round: false, replayed: false });
    expect(round.body.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(again.body).toMatchObject({ receipt_id: round.body.receipt_id, replayed: true });
  });

  test("the tick takes the claim again and enters the new workflow's first step, in a worktree made again from the story's branch", () => {
    expect(started?.units[0]).toMatchObject({ step: "build" });
    expect(rules).toEqual(expect.arrayContaining(["claim.take", "round.start", "agent.start"]));
    expect(worktreesAfterRound).toEqual([`refs/heads/norn/${KEY}`]);
  });
});
