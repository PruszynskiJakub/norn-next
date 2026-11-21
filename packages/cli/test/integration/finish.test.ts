/**
 * How stories end and what is left after, through the CLI alone, every norn call a subprocess of the
 * binary from source: a person closing a story in flight (its run stopped, the unit ended stuck, a
 * round refused, the worktree tidied), tidy keeping what holds unique work, stories on two workflows
 * side by side while one workflow is edited, a round's pin over a shared file, a finished story whose
 * change merges later, a closed item ending a story on a shared store, and a new round of a finished
 * story whose base moved under it.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { agentNotes, awaitNote, type NornOut, norn, personPush, plans, refsUnder, setUp, sh, status, type StoryShown, tickUntil, type UnitShown, type World, world, worktreeOf, writeWorkflow } from "./world.ts";

const KEY = "lt-1";
const SLOW = 300_000;

/** One gate that ends the story either way. */
const GATED = ["name: gated", "start: look", "steps:", "  look:", "    gate: Look, v1.", "    outcomes: { approve: $done, reject: $stuck }", ""].join("\n");
/** GATED as edited mid-story: another prompt, and a second gate after it. */
const GATED_V2 = [
  "name: gated",
  "start: look",
  "steps:",
  "  look:",
  "    gate: Look, v2.",
  "    outcomes: { approve: confirm, reject: $stuck }",
  "  confirm:",
  "    gate: Confirm it.",
  "    outcomes: { approve: $done, reject: $stuck }",
  "",
].join("\n");
/** One agent step that ends the story. */
const SOLO = ["name: solo", "start: build", "steps:", "  build:", "    agent: Build the thing.", "    outcomes: { done: $done }", ""].join("\n");
/** A gate, then the change published, and the story done with it still open. */
const SHIPPED = ["name: shipped", "start: look", "steps:", "  look:", "    gate: Ship it.", "    outcomes: { approve: open-pr, reject: $stuck }", "  open-pr:", "    open-pr:", "    outcomes: { done: $done }", ""].join("\n");
/** A workflow whose one step is a shared file's gate. */
const USES = ["name: uses", "start: look", "steps:", "  look:", "    use: ask", "    outcomes: { approved: $done }", ""].join("\n");
const SHARED_ASK = ["start: q", "steps:", "  q:", "    gate: First text.", "    outcomes: { approve: { exit: approved }, reject: $stuck }", ""].join("\n");
/** A gate, the base update with a resolver on conflict, then the change published. */
const UPDATED = [
  "name: updated",
  "start: look",
  "steps:",
  "  look:",
  "    gate: Start it.",
  "    outcomes: { approve: update, reject: $stuck }",
  "  update:",
  "    update-branch:",
  "    outcomes: { done: open-pr, clean: open-pr, resolved: open-pr, conflict: resolve }",
  "  resolve:",
  "    agent: Merge the base commit the base_side input names into the story branch, resolve, commit the merge.",
  "    inputs: [base_side]",
  "    outcomes: { done: update }",
  "  open-pr:",
  "    open-pr:",
  "    outcomes: { done: $done }",
  "",
].join("\n");

async function person(w: World, ...args: string[]): Promise<NornOut> {
  const r = await norn(w, [...args, "--json"]);
  if (r.code !== 0) throw new Error(`${args.join(" ")}: ${r.stdout}${r.stderr}`);
  return r;
}

const storyOf = async (w: World, key = KEY): Promise<StoryShown | undefined> => (await status(w)).stories.find((s) => s.key === key);
const unitIn = async (w: World, key: string): Promise<UnitShown | undefined> => (await storyOf(w, key))?.units[0];
const alive = async (pid: number): Promise<boolean> => (await Bun.$`kill -0 ${pid}`.nothrow().quiet()).exitCode === 0;
const parkedAt = (step: string) => (u: UnitShown | null) => u?.step === step && u.waiting?.for === "gate";

/** Whether the process is gone within `ms`: a stop signals it, and it may take a moment to exit. */
async function goneWithin(pid: number, ms = 10_000): Promise<boolean> {
  for (const until = Date.now() + ms; Date.now() < until; await Bun.sleep(100)) if (!(await alive(pid))) return true;
  return !(await alive(pid));
}

/** The worktrees and local branches git lists, for a before and after. */
async function gitLists(w: World): Promise<{ worktrees: string[]; branches: string[] }> {
  const worktrees = (await sh(w.root, "git", "worktree", "list", "--porcelain"))
    .split("\n")
    .filter((l) => l.startsWith("worktree "))
    .map((l) => l.slice("worktree ".length));
  const branches = (await sh(w.root, "git", "branch", "--list", "--format=%(refname:short)")).split("\n").filter(Boolean);
  return { worktrees, branches };
}

/** Ticks until no tick does anything but wait: every story settled as far as it goes. */
async function settle(w: World, rules: string[], ticks = 3): Promise<void> {
  for (let i = 0; i < ticks; i++) {
    const t = await norn(w, ["tick", "--json"]);
    if (t.code !== 0) throw new Error(`tick exited ${t.code}: ${t.stdout}${t.stderr}`);
    rules.push(...((t.body.outcomes ?? []) as { decision: { rule: string }; ok: boolean }[]).map((o) => `${o.decision.rule}${o.ok ? "" : "!"}`));
  }
}

describe("a person closes a story in flight", () => {
  let w: World;
  const rules: string[] = [];
  let pid = 0;
  let closed: NornOut;
  let ended: UnitShown | null = null;
  let stillAlive = true;
  let round: NornOut;
  let keptTidy: NornOut;
  let tidied: NornOut;
  let listsBefore: { worktrees: string[]; branches: string[] };
  let listsAfter: { worktrees: string[]; branches: string[] };

  beforeAll(async () => {
    w = await world("hang");
    await setUp(w);
    await person(w, "story", "create", "Hang on");
    await tickUntil(w, rules, (u) => u?.run !== null && u?.run !== undefined);
    pid = (await awaitNote(w, "pid")) as number;
    closed = await norn(w, ["story", "close", KEY, "--json"]);
    await tickUntil(w, rules, (u) => u?.ended !== undefined);
    ended = await unitIn(w, KEY) ?? null;
    stillAlive = !(await goneWithin(pid));
    await settle(w, rules, 2);
    round = await norn(w, ["story", "round", KEY, "--workflow", "e2e", "--json"]);
    keptTidy = await norn(w, ["tidy", "--json"]);
    // the hang left an untracked file; the person looks, then throws it away
    const wt = await worktreeOf(w, KEY);
    if (!wt) throw new Error("the closed story has no worktree to look into");
    rmSync(join(wt, "wip.txt"));
    listsBefore = await gitLists(w);
    tidied = await norn(w, ["tidy", "--json"]);
    listsAfter = await gitLists(w);
  }, SLOW);

  test("close says the item closed and names the live run it leaves for the tick to stop", () => {
    expect(closed.code).toBe(0);
    expect(closed.body).toEqual({ key: KEY, closed: true, was_open: true, stopping: [KEY] });
  });

  test("the tick stops the live run, then ends the unit stuck as the item closed; the agent's process is gone", () => {
    const stop = rules.indexOf("story.item_closed.stop");
    expect(stop).toBeGreaterThanOrEqual(0);
    expect(rules.indexOf("story.item_closed")).toBeGreaterThan(stop);
    expect(rules.filter((r) => r.endsWith("!"))).toEqual([]);
    expect(ended).toMatchObject({ ended: "stuck", ended_reason: "the item closed", run: null });
    expect(ended?.waiting?.next).toContain('norn story create "<title>"');
    expect(stillAlive).toBe(false);
  });

  test("a round on the closed story is refused, sending the person to a new story", () => {
    expect(round.code).toBe(3);
    expect(round.body).toMatchObject({ code: "item_closed", do_instead: 'norn story create "<title>" for the new work' });
  });

  test("tidy keeps the worktree while it holds the agent's untracked file, then removes it and the local branch", () => {
    expect(keptTidy.body).toMatchObject({ removed: [], kept: [{ story: KEY, unit: KEY, reason: "its worktree holds uncommitted changes: wip.txt" }] });
    expect(tidied.code).toBe(0);
    expect(tidied.body).toMatchObject({ dry_run: false, removed: [{ story: KEY, unit: KEY, worktree: true, branch: `norn/${KEY}` }], kept: [] });
    expect(listsBefore.worktrees.some((p) => p.endsWith(`/worktrees/${KEY}`))).toBe(true);
    expect(listsBefore.branches).toContain(`norn/${KEY}`);
    expect(listsAfter.worktrees.some((p) => p.endsWith(`/worktrees/${KEY}`))).toBe(false);
    expect(listsAfter.branches).not.toContain(`norn/${KEY}`);
  });
});

describe("tidy removes what holds no unique work and keeps the rest, saying why", () => {
  let w: World;
  const rules: string[] = [];
  let dryRun: NornOut;
  let listsBefore: { worktrees: string[]; branches: string[] };
  let listsAfterDry: { worktrees: string[]; branches: string[] };
  let tidied: NornOut;
  let listsAfter: { worktrees: string[]; branches: string[] };
  let again: NornOut;

  beforeAll(async () => {
    w = await world("work");
    await setUp(w, { workflow: "gated", workflows: { gated: GATED } });
    for (const title of ["Clean", "Dirty", "Committed"]) await person(w, "story", "create", title);
    await tickUntil(w, rules, parkedAt("look"), 60_000, "lt-3");
    await tickUntil(w, rules, parkedAt("look"), 60_000, "lt-1");
    for (const key of ["lt-1", "lt-2", "lt-3"]) await person(w, "story", "reject", key, "--reason", "not now");
    await tickUntil(w, rules, (u) => u?.ended === "stuck", 60_000, "lt-3");
    await tickUntil(w, rules, (u) => u?.ended === "stuck", 60_000, "lt-1");
    await settle(w, rules);
    writeFileSync(join((await worktreeOf(w, "lt-2")) as string, "scratch.txt"), "a person's notes\n");
    const committed = (await worktreeOf(w, "lt-3")) as string;
    writeFileSync(join(committed, "kept.txt"), "work of its own\n");
    await sh(committed, "git", "add", "-A");
    await sh(committed, "git", "commit", "-q", "-m", "work no other branch holds");
    listsBefore = await gitLists(w);
    dryRun = await norn(w, ["tidy", "--dry-run", "--json"]);
    listsAfterDry = await gitLists(w);
    tidied = await norn(w, ["tidy"]);
    listsAfter = await gitLists(w);
    again = await norn(w, ["tidy", "--json"]);
  }, SLOW);

  test("every story ended stuck and gave up its claim, keeping its worktree", () => {
    expect(rules.filter((r) => r.endsWith("!"))).toEqual([]);
    expect(listsBefore.worktrees.filter((p) => /\/worktrees\/lt-\d$/.test(p))).toHaveLength(3);
  });

  test("a dry run lists the clean worktree to remove and the others kept with their reasons, and changes nothing", () => {
    expect(dryRun.code).toBe(0);
    expect(dryRun.body).toMatchObject({
      dry_run: true,
      removed: [{ story: "lt-1", unit: "lt-1", worktree: true, branch: "norn/lt-1" }],
      kept: [
        { story: "lt-2", unit: "lt-2", reason: "its worktree holds uncommitted changes: scratch.txt" },
        { story: "lt-3", unit: "lt-3", reason: expect.stringContaining("is on neither the base") },
      ],
    });
    expect(listsAfterDry).toEqual(listsBefore);
  });

  test("the real run removes only the clean worktree and its branch, and says what it kept and why", () => {
    expect(tidied.code).toBe(0);
    expect(tidied.stdout).toContain("Removed:\n\n- lt-1: worktree and branch norn/lt-1");
    expect(tidied.stdout).toContain("Kept:\n\n- lt-2: its worktree holds uncommitted changes: scratch.txt\n- lt-3: ");
    expect(listsAfter.worktrees).toEqual(listsBefore.worktrees.filter((p) => !p.endsWith("/worktrees/lt-1")));
    expect(listsAfter.branches).toEqual(listsBefore.branches.filter((b) => b !== "norn/lt-1"));
    expect(again.body).toMatchObject({ removed: [], kept: [{ story: "lt-2" }, { story: "lt-3" }] });
  });
});

describe("stories on two workflows side by side, one workflow edited mid-story", () => {
  let w: World;
  const rules: string[] = [];
  let soloEnded: UnitShown | undefined;
  let gatedWhileSoloRan: UnitShown | undefined;
  let before: UnitShown | undefined;
  let after: UnitShown | undefined;
  let beforeDone: UnitShown | undefined;
  let afterAtConfirm: UnitShown | undefined;
  let afterDone: UnitShown | undefined;

  beforeAll(async () => {
    w = await world("work");
    await setUp(w, { workflows: { gated: GATED, solo: SOLO } });
    await person(w, "story", "create", "Gated first", "--workflow", "gated");
    await person(w, "story", "create", "Solo beside it", "--workflow", "solo");
    await tickUntil(w, rules, (u) => u?.ended === "done", 90_000, "lt-2");
    soloEnded = await unitIn(w, "lt-2");
    gatedWhileSoloRan = await unitIn(w, "lt-1");
    await writeWorkflow(w, "gated", GATED_V2);
    await person(w, "story", "create", "Gated after the edit", "--workflow", "gated");
    await tickUntil(w, rules, parkedAt("look"), 60_000, "lt-3");
    before = await unitIn(w, "lt-1");
    after = await unitIn(w, "lt-3");
    await person(w, "story", "approve", "lt-1");
    await person(w, "story", "approve", "lt-3");
    await tickUntil(w, rules, (u) => u?.ended === "done", 60_000, "lt-1");
    await tickUntil(w, rules, parkedAt("confirm"), 60_000, "lt-3");
    beforeDone = await unitIn(w, "lt-1");
    afterAtConfirm = await unitIn(w, "lt-3");
    await person(w, "story", "approve", "lt-3");
    await tickUntil(w, rules, (u) => u?.ended === "done", 60_000, "lt-3");
    afterDone = await unitIn(w, "lt-3");
  }, SLOW);

  test("the agent story runs to done while the gated story waits at its gate", () => {
    expect(soloEnded).toMatchObject({ workflow: "solo", ended: "done" });
    expect(gatedWhileSoloRan).toMatchObject({ workflow: "gated", step: "look", waiting: { for: "gate", text: "Look, v1." } });
    expect(rules.filter((r) => r.endsWith("!"))).toEqual([]);
  });

  test("the story started before the edit keeps the workflow it pinned; the one started after takes the edit", () => {
    expect(before?.waiting?.text).toBe("Look, v1.");
    expect(after?.waiting?.text).toBe("Look, v2.");
    expect(beforeDone).toMatchObject({ step: "look", ended: "done" });
    expect(afterAtConfirm).toMatchObject({ step: "confirm", waiting: { for: "gate", text: "Confirm it." } });
    expect(afterDone).toMatchObject({ step: "confirm", ended: "done" });
  });
});

describe("a round's pin over a shared file, and the next round", () => {
  let w: World;
  const rules: string[] = [];
  let pinnedText: string | undefined;
  let sharedRound: NornOut;
  let round2: NornOut;
  let nextText: string | undefined;
  let view: NornOut;
  let viewMd: NornOut;

  beforeAll(async () => {
    w = await world("work");
    await setUp(w, { workflow: "uses", workflows: { uses: USES } });
    await writeWorkflow(w, "shared/ask", SHARED_ASK);
    await person(w, "story", "create", "Ask it");
    await tickUntil(w, rules, parkedAt("q"));
    await writeWorkflow(w, "shared/ask", SHARED_ASK.replace("First text.", "Second text."));
    pinnedText = (await unitIn(w, KEY))?.waiting?.text;
    sharedRound = await norn(w, ["story", "round", KEY, "--workflow", "shared/ask", "--json"]);
    await person(w, "story", "approve", KEY);
    await tickUntil(w, rules, (u) => u?.ended === "done");
    await tickUntil(w, rules, () => rules.includes("claim.release"));
    round2 = await person(w, "story", "round", KEY, "--workflow", "uses");
    await tickUntil(w, rules, (u) => parkedAt("q")(u) && u?.ended === undefined);
    nextText = (await unitIn(w, KEY))?.waiting?.text;
    view = await norn(w, ["story", "view", KEY, "--json"]);
    viewMd = await norn(w, ["story", "view", KEY]);
  }, SLOW);

  test("the round under way keeps the shared step's text it pinned, though the file changed", () => {
    expect(pinnedText).toBe("First text.");
  });

  test("a shared file is no workflow a round can name", () => {
    expect(sharedRound.code).toBe(3);
    expect(sharedRound.body).toMatchObject({ code: "unknown_workflow", error: "no workflow shared/ask" });
  });

  test("the next round pins the shared file as it is now", () => {
    expect(round2.body).toMatchObject({ story: KEY, workflow: "uses", at: "q", replayed: false });
    expect(nextText).toBe("Second text.");
    expect(rules.filter((r) => r.endsWith("!"))).toEqual([]);
  });

  test("story view says the story is in its second round", () => {
    expect(view.body).toMatchObject({ key: KEY, round: 2 });
    expect(viewMd.stdout).toContain("\nRound 2, of uses.\n");
  });
});

describe("a story finished with its change open, merged later", () => {
  let w: World;
  const rules: string[] = [];
  let finished: StoryShown | undefined;
  let worktreeAtFinish: string | null = "";
  let afterMerge: string[] = [];
  let merged: StoryShown | undefined;
  let worktreeAtEnd: string | null = "";
  let quiet: string[] = [];

  beforeAll(async () => {
    w = await world("work");
    await setUp(w, { workflow: "shipped", workflows: { shipped: SHIPPED } });
    await person(w, "story", "create", "Ship it");
    await tickUntil(w, rules, parkedAt("look"));
    const wt = (await worktreeOf(w)) as string;
    writeFileSync(join(wt, "shipped.txt"), "the change\n");
    await sh(wt, "git", "add", "-A");
    await sh(wt, "git", "commit", "-q", "-m", "story work");
    await person(w, "story", "approve", KEY);
    await tickUntil(w, rules, () => rules.includes("claim.release"));
    finished = await storyOf(w);
    worktreeAtFinish = await worktreeOf(w);
    // the person merges the story's branch into the base from their checkout and pushes
    await sh(w.root, "git", "fetch", "-q", "origin");
    await sh(w.root, "git", "merge", "-q", "--no-ff", "-m", "merge the story", `origin/norn/${KEY}`);
    await sh(w.root, "git", "push", "-q", "origin", "main");
    const mark = rules.length;
    await tickUntil(w, rules, () => rules.slice(mark).includes("claim.release"));
    afterMerge = rules.slice(mark);
    merged = await storyOf(w);
    worktreeAtEnd = await worktreeOf(w);
    const quietMark = rules.length;
    await settle(w, rules, 2);
    quiet = rules.slice(quietMark);
  }, SLOW);

  test("the story finished done with its change open and its item open, its claim given up", () => {
    expect(finished).toMatchObject({ change: { state: "open" }, units: [{ ended: "done" }] });
    expect((finished as unknown as { open: boolean }).open).toBe(true);
    expect((finished as unknown as { claim: unknown }).claim).toBeNull();
    expect(worktreeAtFinish).toBeNull();
  });

  test("once the change merges, a tick takes the claim again, closes the item and gives the claim up", () => {
    expect(afterMerge).toEqual(expect.arrayContaining(["claim.take", "story.finish", "claim.release"]));
    expect(afterMerge.filter((r) => r.endsWith("!"))).toEqual([]);
    expect(merged).toMatchObject({ change: { state: "merged" }, units: [{ ended: "done" }] });
    expect((merged as unknown as { open: boolean }).open).toBe(false);
    expect(worktreeAtEnd).toBeNull();
  });

  test("after that the story decides nothing more", () => {
    expect(quiet).toEqual([]);
  });
});

describe("a closed item ends a story with no change, on a shared store", () => {
  let w: World;
  const rules: string[] = [];
  let ended: UnitShown | undefined;
  let remoteRefs: string[] = [];
  let published = "";
  let local = "";

  beforeAll(async () => {
    w = await world("work");
    await setUp(w, { store: "refs", workflow: "gated", workflows: { gated: GATED } });
    await person(w, "story", "create", "Look at it");
    await tickUntil(w, rules, parkedAt("look"));
    await person(w, "story", "close", KEY);
    await tickUntil(w, rules, (u) => u?.ended !== undefined);
    ended = await unitIn(w, KEY);
    await tickUntil(w, rules, () => rules.includes("claim.release"));
    remoteRefs = await refsUnder(w.remote);
    published = await sh(w.remote, "git", "rev-parse", `refs/norn/v2/runs/${KEY}`);
    local = await sh(w.root, "git", "rev-parse", `refs/norn/v2/runs/${KEY}`);
  }, SLOW);

  test("the tick ends the unit stuck as the item closed, with no change ever opened", () => {
    expect(ended).toMatchObject({ step: "look", ended: "stuck", ended_reason: "the item closed" });
    expect(rules).toContain("story.item_closed");
    expect(rules).not.toContain("story.item_closed.stop");
    expect(rules.filter((r) => r.endsWith("!"))).toEqual([]);
  });

  test("the ended record is published to the remote before the claim is given up", () => {
    expect(remoteRefs.some((r) => r.endsWith(`refs/norn/v2/runs/${KEY}`))).toBe(true);
    expect(published).toBe(local);
    expect(rules.lastIndexOf("store.flush")).toBeLessThan(rules.lastIndexOf("claim.release"));
  });
});

describe("a new round of a finished story whose base moved under it", () => {
  let w: World;
  const rules: string[] = [];
  let refused: NornOut;
  let fromStart: NornOut;
  let atUpdate: NornOut;
  let startUnit: UnitShown | undefined;
  let base = "";
  let headsHoldBase: boolean[] = [];
  let resolverRuns = 0;

  beforeAll(async () => {
    w = await world("work");
    plans(w, { resolve: "resolve" });
    await setUp(w, { workflow: "updated", workflows: { updated: UPDATED } });
    for (const title of ["From the start", "At the update"]) await person(w, "story", "create", title);
    for (const key of ["lt-1", "lt-2"]) {
      await tickUntil(w, rules, parkedAt("look"), 60_000, key);
      const wt = (await worktreeOf(w, key)) as string;
      writeFileSync(join(wt, `${key}.txt`), "the story's line\n");
      await sh(wt, "git", "add", "-A");
      await sh(wt, "git", "commit", "-q", "-m", `${key}: its work`);
      await person(w, "story", "approve", key);
    }
    for (const key of ["lt-1", "lt-2"]) await tickUntil(w, rules, (u) => u?.ended === "done", 90_000, key);
    await settle(w, rules);
    base = await personPush(w, "main", { "lt-1.txt": "the base's line\n", "lt-2.txt": "the base's line\n" }, "base: the same files");
    refused = await norn(w, ["story", "update-branch", "lt-1", "--json"]);
    fromStart = await norn(w, ["story", "round", "lt-1", "--workflow", "updated", "--json"]);
    atUpdate = await norn(w, ["story", "round", "lt-2", "--workflow", "updated", "--at", "update", "--json"]);
    await tickUntil(w, rules, parkedAt("look"), 60_000, "lt-1");
    startUnit = await unitIn(w, "lt-1");
    await person(w, "story", "approve", "lt-1");
    for (const key of ["lt-1", "lt-2"]) await tickUntil(w, rules, (u) => u?.ended === "done" && u.step === "open-pr", 120_000, key);
    await sh(w.root, "git", "fetch", "-q", "origin");
    headsHoldBase = await Promise.all(
      ["lt-1", "lt-2"].map(async (key) => (await Bun.$`git -C ${w.root} merge-base --is-ancestor ${base} origin/norn/${key}`.nothrow().quiet()).exitCode === 0),
    );
    resolverRuns = new Set(agentNotes(w).filter((n) => n.note === "plan" && n.value === "resolve").map((n) => n.run)).size;
  }, SLOW);

  test("the branch update is refused over the conflict, naming a round at the update step", () => {
    expect(refused.code).toBe(3);
    expect(refused.body).toMatchObject({ code: "conflict" });
    expect(String(refused.body.do_instead)).toContain("norn story round lt-1 --workflow");
  });

  test("a round of the same workflow with no step named starts at its first step", () => {
    expect(fromStart.code).toBe(0);
    expect(fromStart.body).toMatchObject({ story: "lt-1", workflow: "updated", at: "look", ended_round: false });
    expect(startUnit).toMatchObject({ step: "look", waiting: { for: "gate" } });
  });

  test("a round at the update step goes straight to it", () => {
    expect(atUpdate.code).toBe(0);
    expect(atUpdate.body).toMatchObject({ story: "lt-2", workflow: "updated", at: "update", ended_round: false });
  });

  test("both rounds meet the conflict, the resolver merges the base, and each story publishes a branch holding it", () => {
    expect(rules.filter((r) => r === "round.start").length).toBeGreaterThanOrEqual(4);
    expect(rules.filter((r) => r.endsWith("!"))).toEqual([]);
    expect(resolverRuns).toBe(2);
    expect(headsHoldBase).toEqual([true, true]);
  });
});
