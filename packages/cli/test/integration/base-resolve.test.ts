/**
 * Base updates, conflicts and their resolution over real git, every norn call a subprocess of the
 * binary from source: a teammate's push to the base merged into the story branch with a merge commit,
 * a conflicting base move under a story waiting at its gate sent to a resolver whose brief names the
 * base commit and the paths, the light path after a base move, a story on another base branch, a
 * conflict that runs out its counter and the merge a rerun resolver must make, a resolver asking
 * mid-merge, a person's push to the story branch never forced over, and an update that finds the
 * worktree busy (a rebase stopped mid-way, uncommitted changes, a merge left in progress) leaving it
 * as it was.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { agentNotes, awaitNote, logPushes, type NornOut, norn, personPush, plans, pushes, reports, setUp, sh, unitOf, type UnitShown, type World, world, worktreeOf } from "./world.ts";

const KEY = "lt-1";
const BRANCH = `norn/${KEY}`;
const SLOW = 300_000;

interface Outcome {
  decision: { rule: string; receipts?: { data: { kind: string; outcome?: string } }[] };
  ok: boolean;
  error?: string;
}

/** A rule as a test reads it: `step.finished(conflict)` names the outcome it recorded. */
function label(o: Outcome): string {
  const finished = (o.decision.receipts ?? []).find((i) => i.data.kind === "step.finished" && i.data.outcome !== undefined);
  return `${o.decision.rule}${finished && o.decision.rule === "step.finished" ? `(${finished.data.outcome})` : ""}${o.ok ? "" : "!"}`;
}

/** Every rule a tick fired, in order. */
class Ticks {
  readonly rules: string[] = [];
  constructor(private readonly w: World) {}

  async once(): Promise<NornOut> {
    const t = await norn(this.w, ["tick", "--json"]);
    this.rules.push(...((t.body.outcomes ?? []) as Outcome[]).map(label));
    if (t.code !== 0) throw new Error(`tick exited ${t.code}: ${t.stdout}${t.stderr}\nrules: ${this.rules.join(", ")}`);
    return t;
  }

  async until(done: (u: UnitShown | null) => boolean, maxMs = 120_000): Promise<UnitShown> {
    for (const until = performance.now() + maxMs; performance.now() < until; ) {
      await this.once();
      const u = await unitOf(this.w, KEY);
      if (u && done(u)) return u;
      await Bun.sleep(200);
    }
    throw new Error(`no convergence; rules: ${this.rules.join(", ")}; unit: ${JSON.stringify(await unitOf(this.w, KEY))}`);
  }

  since(mark: number): string[] {
    return this.rules.slice(mark);
  }
}

const atGate = (step: string) => (u: UnitShown | null) => u?.step === step && u.waiting?.for === "gate";

interface FlowOptions {
  /** the bound of the update's `conflict` route back to the resolver; absent, the derived default */
  conflictMax?: number;
  /** when a story waiting at `ready` counts as stale (default conflict) */
  stale?: "conflict" | "behind";
}

/**
 * A story that waits at `look` before any work, so a test can move the base under it, then builds,
 * updates from its base, publishes the change and waits at `ready`. A base move the workflow counts
 * as stale at `ready` sends it back through `update`.
 */
function baseSync(opts: FlowOptions = {}): string {
  const conflict = opts.conflictMax === undefined ? "resolve" : `{ to: resolve, max: ${opts.conflictMax} }`;
  return [
    "name: base-sync",
    "start: look",
    "steps:",
    "  look:",
    "    gate: Start the work.",
    "    outcomes: { approve: build, reject: $stuck }",
    "  build:",
    "    agent: Build the thing.",
    "    outcomes: { done: update }",
    "  update:",
    "    update-branch:",
    `    outcomes: { done: open-pr, clean: open-pr, resolved: open-pr, conflict: ${conflict} }`,
    "  resolve:",
    "    agent: Merge the base commit the base_side input names into the story branch, resolve, commit the merge.",
    "    inputs: [base_side]",
    "    outcomes: { done: update }",
    "  open-pr:",
    "    open-pr:",
    "    outcomes: { done: ready }",
    "  ready:",
    "    gate: Approve the change.",
    "    outcomes: { approve: merge, reject: build, stale: update, unpushed: open-pr }",
    "  merge:",
    "    await-merge:",
    "    outcomes: { merged: $done, stale: update, unpushed: open-pr }",
    `base: { stale: ${opts.stale ?? "conflict"}, step: update }`,
    "",
  ].join("\n");
}

/** A gate, then the base update straight away, so whatever the worktree holds at the gate meets the update. */
const BUSY = [
  "name: busy",
  "start: look",
  "steps:",
  "  look:",
  "    gate: Start the update.",
  "    outcomes: { approve: update, reject: $stuck }",
  "  update:",
  "    update-branch:",
  "    outcomes: { done: ready, clean: ready, resolved: ready, conflict: ready }",
  "  ready:",
  "    gate: Approve the change.",
  "    outcomes: { approve: $done, reject: look }",
  "",
].join("\n");

async function setUpStory(w: World, workflow: string, text: string, config: [string, string][] = []): Promise<Ticks> {
  await setUp(w, { workflows: { [workflow]: text }, config });
  const created = await norn(w, ["story", "create", "Build it", "--workflow", workflow, "--json"]);
  if (created.code !== 0) throw new Error(`story create: ${created.stdout}${created.stderr}`);
  return new Ticks(w);
}

async function person(w: World, ...args: string[]): Promise<NornOut> {
  const r = await norn(w, [...args, "--json"]);
  if (r.code !== 0) throw new Error(`${args.join(" ")}: ${r.stdout}${r.stderr}`);
  return r;
}

const approve = (w: World) => person(w, "story", "approve", KEY);

/** The story branch's head on the remote, as `git ls-remote` reads it. */
async function remoteHead(w: World, branch = BRANCH): Promise<string> {
  return (await sh(w.root, "git", "ls-remote", "origin", branch)).split("\t")[0] as string;
}

/** Whether `commit` is in the history of the remote story branch, after a fetch. */
async function onRemoteBranch(w: World, commit: string): Promise<boolean> {
  await sh(w.root, "git", "fetch", "-q", "origin");
  try {
    await sh(w.root, "git", "merge-base", "--is-ancestor", commit, `origin/${BRANCH}`);
    return true;
  } catch {
    return false;
  }
}

/** The story's own commit in its worktree, standing in for work an agent committed at an earlier step. */
async function commitInWorktree(wt: string, files: Record<string, string>, message: string): Promise<string> {
  for (const [name, text] of Object.entries(files)) writeFileSync(join(wt, name), text);
  await sh(wt, "git", "add", "-A");
  await sh(wt, "git", "commit", "-q", "-m", message);
  return sh(wt, "git", "rev-parse", "HEAD");
}

/** `git status --porcelain` of a worktree, tracked paths only, one line per path. */
async function porcelain(wt: string): Promise<string[]> {
  return (await sh(wt, "git", "status", "--porcelain", "--untracked-files=no")).split("\n").filter(Boolean);
}

/** The commit MERGE_HEAD names in a worktree, or null when no merge is in progress. */
async function mergeHead(wt: string): Promise<string | null> {
  try {
    return await sh(wt, "git", "rev-parse", "-q", "--verify", "MERGE_HEAD");
  } catch {
    return null;
  }
}

/** The run whose plan the agent noted as `plan`, first of them. */
function runOfPlan(w: World, plan: string): string | undefined {
  return agentNotes(w).find((n) => n.note === "plan" && n.value === plan)?.run;
}

function noteIn(w: World, run: string | undefined, what: string): unknown {
  return agentNotes(w).find((n) => n.run === run && n.note === what)?.value;
}

/** The step and attempt a brief's title names: `# norn brief — <unit> · <step> #<attempt>`. */
function visitOf(brief: unknown): string | undefined {
  return (brief as { text?: string } | undefined)?.text?.match(/· (\S+ #\d+)/)?.[1];
}

describe("a base that moves under a story, over real git", () => {
  let w: World;
  let ticks: Ticks;
  let sibling = "";
  let mergeParents: string[] = [];
  let headAfterOpen = "";
  let remoteAfterOpen = "";
  let conflicting = "";
  let rulesFromStale: string[] = [];
  let worktreeHeadAtReady = "";
  let remoteAtReady = "";
  let personCommit = "";
  let worktreeHeadAfterPush = "";
  let remoteAfterPush = "";

  beforeAll(async () => {
    w = await world("work");
    plans(w, { resolve: "resolve" });
    ticks = await setUpStory(w, "base-sync", baseSync());
    logPushes(w);
    await ticks.until(atGate("look"));
    sibling = await personPush(w, "main", { "sibling.txt": "a teammate's work\n" }, "sibling: unrelated work");
    await approve(w);
    await ticks.until(atGate("ready"));
    const wt = (await worktreeOf(w)) as string;
    mergeParents = (await sh(wt, "git", "log", "--merges", "-1", "--format=%P")).split(" ");
    headAfterOpen = await sh(wt, "git", "rev-parse", "HEAD");
    remoteAfterOpen = await remoteHead(w);

    conflicting = await personPush(w, "main", { "feature.txt": "the base's own feature\n" }, "base: a feature of its own");
    let mark = ticks.rules.length;
    await ticks.until((u) => atGate("ready")(u) && ticks.since(mark).includes("gate.park"));
    rulesFromStale = ticks.since(mark);
    worktreeHeadAtReady = await sh(wt, "git", "rev-parse", "HEAD");
    remoteAtReady = await remoteHead(w);

    // a person's commit straight to the story branch, then a rework that pushes again
    personCommit = await personPush(w, BRANCH, { "person.txt": "a person's fix\n" }, "person: a fix on the story branch");
    await person(w, "story", "reject", KEY, "--reason", "build it again");
    mark = ticks.rules.length;
    await ticks.until((u) => atGate("ready")(u) && ticks.since(mark).includes("gate.park"));
    worktreeHeadAfterPush = await sh(wt, "git", "rev-parse", "HEAD");
    remoteAfterPush = await remoteHead(w);
  }, SLOW);

  test("a sibling push before the update gives one merge commit whose second parent is the sibling, and the remote branch is the worktree's HEAD after open-pr", async () => {
    expect(mergeParents).toHaveLength(2);
    expect(mergeParents[1]).toBe(sibling);
    expect(remoteAfterOpen).toBe(headAfterOpen);
    expect(await onRemoteBranch(w, sibling)).toBe(true);
  });

  test("a conflicting base move at ready goes stale, the update conflicts and the resolver starts, in that order", () => {
    const order = ["gate.stale", "step.finished(conflict)", "agent.start"].map((r) => rulesFromStale.indexOf(r));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(rulesFromStale.filter((r) => r.endsWith("!"))).toEqual([]);
  });

  test("the resolver's brief names the base commit to merge and the conflicting path, in its base_side input", () => {
    const brief = noteIn(w, runOfPlan(w, "resolve"), "brief") as { code: number; text: string };
    expect(brief.code).toBe(0);
    expect(brief.text).toContain(`git merge ${conflicting}`);
    expect(brief.text).toContain("- `feature.txt`:");
    expect(brief.text).toContain("`update #2` update-branch ended `conflict`");
  });

  test("after the resolver merged, the update takes the light path (resolved), and the story is back at ready with the merge pushed", async () => {
    expect(rulesFromStale).toContain("step.finished(resolved)");
    expect(rulesFromStale.filter((r) => r === "agent.start")).toHaveLength(1);
    expect(remoteAtReady).toBe(worktreeHeadAtReady);
    expect(await onRemoteBranch(w, conflicting)).toBe(true);
  });

  test("a person's push to the story branch is merged in at the next push and never forced over", async () => {
    expect(remoteAfterPush).toBe(worktreeHeadAfterPush);
    expect(await onRemoteBranch(w, personCommit)).toBe(true);
    const story = pushes(w, `refs/heads/${BRANCH}`);
    expect(story.length).toBeGreaterThanOrEqual(3);
    expect(story.filter((l) => l.endsWith(" forced"))).toEqual([]);
  });
});

describe("a story on another base branch, and the light path after a clean base move", () => {
  let w: World;
  let ticks: Ticks;
  let onMain = "";
  let onDevelop = "";
  let cutFrom = "";
  let rulesAfterMain: string[] = [];
  let rulesFromStale: string[] = [];
  let change: Record<string, unknown> = {};

  beforeAll(async () => {
    w = await world("work");
    await sh(w.root, "git", "push", "-q", "origin", "main:develop");
    const developAtStart = await personPush(w, "develop", { "develop.txt": "develop's own work\n" }, "develop: its own work");
    ticks = await setUpStory(w, "base-sync", baseSync({ stale: "behind" }), [["base", "develop"]]);
    await ticks.until(atGate("look"));
    const wt = (await worktreeOf(w)) as string;
    cutFrom = (await sh(wt, "git", "merge-base", "HEAD", developAtStart)) === developAtStart ? developAtStart : "";
    await approve(w);
    await ticks.until(atGate("ready"));

    onMain = await personPush(w, "main", { "main.txt": "main moves\n" }, "main: moves on");
    let mark = ticks.rules.length;
    for (let i = 0; i < 3; i++) await ticks.once();
    rulesAfterMain = ticks.since(mark);

    onDevelop = await personPush(w, "develop", { "develop2.txt": "develop moves\n" }, "develop: moves on");
    mark = ticks.rules.length;
    await ticks.until((u) => atGate("ready")(u) && ticks.since(mark).includes("gate.park"));
    rulesFromStale = ticks.since(mark);
    const changes = readdirSync(w.home, { recursive: true, encoding: "utf8" }).filter((p) => /(^|\/)changes\/1\.json$/.test(p));
    change = changes[0] ? (JSON.parse(readFileSync(join(w.home, changes[0]), "utf8")) as Record<string, unknown>) : {};
  }, SLOW);

  test("the story branches from develop, and a move of main never makes it stale", () => {
    expect(cutFrom).not.toBe("");
    expect(rulesAfterMain).not.toContain("gate.stale");
    expect(rulesAfterMain.filter((r) => r.endsWith("!"))).toEqual([]);
  });

  test("a clean move of develop takes the light path (clean): the update merges develop and never main, with no build restart", async () => {
    expect(rulesFromStale).toContain("gate.stale");
    expect(rulesFromStale).toContain("step.finished(clean)");
    expect(rulesFromStale).not.toContain("agent.start");
    expect(await onRemoteBranch(w, onDevelop)).toBe(true);
    expect(await onRemoteBranch(w, onMain)).toBe(false);
  });

  test("the change targets develop", () => {
    expect(change).toMatchObject({ base_branch: "develop", head_branch: BRANCH });
  });
});

describe("an update conflict that uses up its counter, then a rerun at resolve", () => {
  let w: World;
  let ticks: Ticks;
  let stuck: UnitShown;
  let reset = "";
  let rerun: NornOut;
  let refused: unknown;

  beforeAll(async () => {
    w = await world("work");
    plans(w, { "resolve#1": "resolve", resolve: "report" });
    reports(w, { resolve: { tries: [["done", "done"]] } });
    ticks = await setUpStory(w, "base-sync", baseSync({ conflictMax: 1 }));
    await ticks.until(atGate("look"));
    await personPush(w, "main", { "feature.txt": "the base's own feature\n" }, "base: a feature of its own");
    // the base moves again just as the resolver finishes, so the next update conflicts once more
    const clone = join(w.dir, "person");
    writeFileSync(
      join(w.flags, "before-report.sh"),
      [
        "set -e",
        `cd '${clone}'`,
        "git fetch -q origin",
        "git checkout -q -B main origin/main",
        "printf 'the base, once more\\n' > feature.txt",
        "git add -A",
        "git -c user.email=p@p -c user.name=p commit -q -m 'base: once more'",
        "git push -q origin HEAD:main",
        "",
      ].join("\n"),
    );
    await approve(w);
    stuck = await ticks.until((u) => u?.ended === "stuck");
    reset = stuck.waiting?.next?.match(/--reset (\S+)/)?.[1] ?? "";
    rerun = await norn(w, ["run", "rerun", KEY, "--step", "resolve", "--reset", reset, "--reason", "resolve it by hand", "--json"]);
    const mark = ticks.rules.length;
    await ticks.until(() => ticks.since(mark).includes("agent.start"));
    refused = await awaitNote(w, "try.1", 30_000);
  }, SLOW);

  test("the second conflict runs out the counter and ends the unit stuck, naming the reset", () => {
    expect(existsSync(join(w.flags, "before-report.sh"))).toBe(false);
    expect(ticks.rules.filter((r) => r === "step.finished(conflict)")).toHaveLength(2);
    expect(stuck).toMatchObject({ step: "update", ended: "stuck" });
    expect(reset).toBe("update.conflict");
  });

  test("a rerun at resolve with the counter reset starts the resolver again", () => {
    expect(rerun.code).toBe(0);
  });

  test("a done without the merge is refused with merge_unfinished, exit 3", () => {
    expect(refused).toMatchObject({ code: 3, body: { code: "merge_unfinished" } });
  });
});

describe("a resolver that asks with the merge in progress", () => {
  let w: World;
  let ticks: Ticks;
  let wt = "";
  let base = "";
  let asked: UnitShown;
  let atAsk: { merge_head: string | null; porcelain: string } | undefined;
  let mergeHeadAtAsk: string | null = null;
  let porcelainAtAsk: string[] = [];
  let atAnswer: { merge_head: string | null; porcelain: string } | undefined;
  let visits: (string | undefined)[] = [];
  let back: UnitShown;

  beforeAll(async () => {
    w = await world("work");
    plans(w, { resolve: "resolve-ask" });
    // both sides then edit files the base already had, so git stops on each as modified by both (UU)
    await personPush(w, "main", { "a.txt": "a\n", "b.txt": "b\n" }, "base: a and b");
    await sh(w.root, "git", "pull", "-q", "--ff-only", "origin", "main");
    ticks = await setUpStory(w, "base-sync", baseSync());
    await ticks.until(atGate("look"));
    wt = (await worktreeOf(w)) as string;
    await commitInWorktree(wt, { "a.txt": "the story's a\n", "b.txt": "the story's b\n" }, "story: a and b");
    base = await personPush(w, "main", { "a.txt": "the base's a\n", "b.txt": "the base's b\n" }, "base: a and b of its own");
    await approve(w);
    asked = await ticks.until((u) => u?.waiting?.for === "answer");
    atAsk = noteIn(w, runOfPlan(w, "resolve-ask"), "merge.at-ask") as typeof atAsk;
    mergeHeadAtAsk = await mergeHead(wt);
    porcelainAtAsk = await porcelain(wt);
    await person(w, "story", "answer", KEY, "Keep both sides.");
    back = await ticks.until(atGate("ready"));
    const resolver = runOfPlan(w, "resolve-ask");
    atAnswer = noteIn(w, resolver, "merge.at-answer") as typeof atAnswer;
    visits = agentNotes(w)
      .filter((n) => n.run === resolver && n.note === "brief")
      .map((n) => visitOf(n.value));
  }, SLOW);

  test("the ask parks the resolver with the merge kept: MERGE_HEAD is the base, a.txt unmerged and b.txt staged", () => {
    expect(asked).toMatchObject({ step: "resolve", waiting: { for: "answer", text: "Which side of the conflict should win?" } });
    expect(atAsk).toEqual({ merge_head: base, porcelain: "UU a.txt\nM  b.txt\n" });
    expect(mergeHeadAtAsk).toBe(base);
    expect(porcelainAtAsk).toEqual(["UU a.txt", "M  b.txt"]);
  });

  test("the answer resumes the same attempt on the merge as it was left", () => {
    expect(atAnswer).toEqual(atAsk);
    expect(visits.length).toBeGreaterThanOrEqual(2);
    expect(new Set(visits)).toEqual(new Set(["resolve #1"]));
  });

  test("the resolver's merge is concluded and pushed, and the story is back at ready", async () => {
    expect(back.step).toBe("ready");
    expect(await mergeHead(wt)).toBeNull();
    expect(await onRemoteBranch(w, base)).toBe(true);
  });
});

describe("an update that finds the worktree busy", () => {
  let w: World;
  let ticks: Ticks;
  let wt = "";
  let headAtGate = "";
  let rebaseKept = false;
  let rebaseUnit: UnitShown | null = null;
  let rebaseView: NornOut;
  let dirtyStuck: UnitShown;
  let dirtyHead = "";
  let dirtyStatus: string[] = [];
  let mergingStuck: UnitShown;
  let side = "";
  let mergeHeadAfter: string | null = null;
  let porcelainAfter: string[] = [];

  beforeAll(async () => {
    w = await world("work");
    ticks = await setUpStory(w, "busy", BUSY);
    await ticks.until(atGate("look"));
    wt = (await worktreeOf(w)) as string;
    await commitInWorktree(wt, { "r.txt": "r\n" }, "story: r as it was");
    const story = await commitInWorktree(wt, { "r.txt": "the story's r\n" }, "story: r");
    // a commit beside the story's that edits the same file, for a rebase and a merge to stop on
    await sh(wt, "git", "checkout", "-q", "--detach", "HEAD~1");
    side = await commitInWorktree(wt, { "r.txt": "a side's r\n" }, "side: r");
    await sh(wt, "git", "checkout", "-q", BRANCH);
    headAtGate = await sh(wt, "git", "rev-parse", "HEAD");
    expect(headAtGate).toBe(story);

    // a rebase a person started and left stopped mid-way
    await sh(wt, "git", "rebase", side).catch(() => undefined);
    for (let i = 0; i < 3; i++) await ticks.once();
    rebaseKept = existsSync(await sh(wt, "git", "rev-parse", "--path-format=absolute", "--git-path", "rebase-merge"));
    rebaseUnit = await unitOf(w, KEY);
    await sh(wt, "git", "rebase", "--abort");
    rebaseView = await norn(w, ["story", "view", KEY, "--json"]);

    // uncommitted work the update would carry into its merge
    writeFileSync(join(wt, "r.txt"), "an edit not committed\n");
    writeFileSync(join(wt, "notes.txt"), "a file not added\n");
    await approve(w);
    dirtyStuck = await ticks.until((u) => u?.ended === "stuck");
    dirtyHead = await sh(wt, "git", "rev-parse", "HEAD");
    dirtyStatus = (await sh(wt, "git", "status", "--porcelain")).split("\n").map((l) => l.trim()).filter(Boolean);

    // a merge a resolver left in progress, then an update sent at it
    await sh(wt, "git", "checkout", "--", "r.txt");
    await sh(wt, "rm", "notes.txt");
    await sh(wt, "git", "merge", "--no-ff", "--no-commit", side).catch(() => undefined);
    await person(w, "run", "rerun", KEY, "--step", "update", "--reason", "update again");
    const mark = ticks.rules.length;
    mergingStuck = await ticks.until((u) => u?.ended === "stuck" && ticks.since(mark).length > 0);
    mergeHeadAfter = await mergeHead(wt);
    porcelainAfter = await porcelain(wt);
  }, SLOW);

  test("ticks leave a rebase stopped mid-way alone, and after --abort the unit is at its gate and not corrupt", () => {
    expect(rebaseKept).toBe(true);
    expect(rebaseUnit).toMatchObject({ step: "look", waiting: { for: "gate" } });
    expect(rebaseView.code).toBe(0);
    expect(JSON.stringify(rebaseView.body)).not.toContain("corrupt");
  });

  test("an update on a dirty worktree merges nothing, and the unit ends stuck naming the paths", () => {
    expect(dirtyHead).toBe(headAtGate);
    expect(dirtyStatus).toEqual(["M r.txt", "?? notes.txt"]);
    expect(dirtyStuck).toMatchObject({ step: "update", ended: "stuck" });
    expect(dirtyStuck.ended_reason).toContain(`${wt} has uncommitted changes: notes.txt, r.txt`);
  });

  test("an update never aborts a merge a resolver left in progress", () => {
    expect(mergingStuck).toMatchObject({ step: "update", ended: "stuck" });
    expect(mergingStuck.ended_reason).toContain("merge is in progress");
    expect(mergeHeadAfter).toBe(side);
    expect(porcelainAfter).toEqual(["UU r.txt"]);
  });
});
