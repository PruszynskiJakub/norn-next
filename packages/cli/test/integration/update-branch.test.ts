/**
 * `norn story update-branch` over real git: a story ships its change (forge none) and finishes, the
 * base moves on, and the verb merges it into the story's branch. A base move that conflicts is
 * aborted and refused naming the paths, the branch and the remote left as they were; one that merges
 * clean is pushed and recorded, and the next tick applies the record and finishes the story again.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type NornOut, norn, setUp, sh, tickUntil, type World, world } from "./world.ts";

const KEY = "lt-1";
const BRANCH = `norn/${KEY}`;
const SLOW = 180_000;

const SHIPPED = [
  "name: shipped",
  "start: look",
  "steps:",
  "  look:",
  "    gate: Ship it.",
  "    outcomes: { approve: open-pr, reject: $stuck }",
  "  open-pr:",
  "    open-pr:",
  "    outcomes: { done: $done }",
  "",
].join("\n");

/** The path of the story's worktree, or null when git knows of none. */
async function worktreeOf(w: World): Promise<string | null> {
  const list = await sh(w.root, "git", "worktree", "list", "--porcelain");
  return (
    list
      .split("\n")
      .filter((l) => l.startsWith("worktree "))
      .map((l) => l.slice("worktree ".length))
      .find((p) => p.endsWith(`/worktrees/${KEY}`)) ?? null
  );
}

/** A person's commit to the remote's main from a clone of their own. */
async function pushToMain(w: World, files: Record<string, string>, message: string): Promise<string> {
  const clone = join(w.dir, "person");
  if (!existsSync(clone)) await sh(w.dir, "git", "clone", "-q", w.remote, clone);
  await sh(clone, "git", "pull", "-q", "--ff-only", "origin", "main");
  for (const [name, text] of Object.entries(files)) writeFileSync(join(clone, name), text);
  await sh(clone, "git", "add", "-A");
  await sh(clone, "git", "-c", "user.email=p@p", "-c", "user.name=p", "commit", "-q", "-m", message);
  await sh(clone, "git", "push", "-q", "origin", "main");
  return sh(clone, "git", "rev-parse", "HEAD");
}

describe("story update-branch over real git", () => {
  let w: World;
  const rules: string[] = [];
  let storyHead = "";
  let remoteBefore = "";
  let conflict: NornOut;
  let headAfterConflict = "";
  let remoteAfterConflict = "";
  let worktreeAfterConflict: string | null = "";
  let claimAfterConflict: unknown;
  let base = "";
  let clean: NornOut;
  let headAfterClean = "";
  let parents: string[] = [];
  let remoteAfterClean = "";
  let view: NornOut;
  let rulesAfterClean: string[] = [];
  let worktreeAtEnd: string | null = "";
  let localAfterFinish = "";

  beforeAll(async () => {
    w = await world("work");
    await setUp(w);
    mkdirSync(join(w.root, ".agents", "workflows"), { recursive: true });
    writeFileSync(join(w.root, ".agents", "workflows", "shipped.yaml"), SHIPPED);
    const set = await norn(w, ["config", "set", "base_ref", "origin/main", "--json"]);
    if (set.code !== 0) throw new Error(`config set base_ref: ${set.stdout}${set.stderr}`);
    await norn(w, ["story", "create", "Ship it", "--workflow", "shipped", "--json"]);
    await tickUntil(w, rules, (u) => u?.step === "look" && u.parked !== undefined);
    // the story's own work, standing in for what an agent would have committed
    const wt = await worktreeOf(w);
    if (!wt) throw new Error("the story has no worktree at its gate");
    writeFileSync(join(wt, "shared.txt"), "story\n");
    await sh(wt, "git", "add", "-A");
    await sh(wt, "git", "commit", "-q", "-m", "story work");
    await norn(w, ["story", "approve", KEY, "--json"]);
    await tickUntil(w, rules, (u) => u?.ended === "done");
    await tickUntil(w, rules, () => rules.includes("claim.release"));
    // the finish deleted the local branch, whose commits the remote holds; the update cuts it again from there
    localAfterFinish = await sh(w.root, "git", "branch", "--list", BRANCH);
    storyHead = await sh(w.root, "git", "rev-parse", `refs/remotes/origin/${BRANCH}`);
    remoteBefore = await sh(w.remote, "git", "rev-parse", BRANCH);

    await pushToMain(w, { "shared.txt": "base\n" }, "base edits the same file");
    conflict = await norn(w, ["story", "update-branch", KEY, "--json"]);
    headAfterConflict = await sh(w.root, "git", "rev-parse", BRANCH);
    remoteAfterConflict = await sh(w.remote, "git", "rev-parse", BRANCH);
    worktreeAfterConflict = await worktreeOf(w);
    claimAfterConflict = (await norn(w, ["story", "view", KEY, "--json"])).body.claim;

    base = await pushToMain(w, { "shared.txt": "story\n", "other.txt": "other\n" }, "base agrees with the story");
    clean = await norn(w, ["story", "update-branch", KEY, "--reason", "the base moved", "--json"]);
    headAfterClean = await sh(w.root, "git", "rev-parse", BRANCH);
    parents = (await sh(w.root, "git", "rev-list", "--parents", "-n", "1", headAfterClean)).split(" ").slice(1);
    remoteAfterClean = await sh(w.remote, "git", "rev-parse", BRANCH);
    view = await norn(w, ["story", "view", KEY, "--json"]);
    const before = rules.length;
    await tickUntil(w, rules, () => rules.slice(before).includes("claim.release"));
    rulesAfterClean = rules.slice(before);
    worktreeAtEnd = await worktreeOf(w);
  }, SLOW);

  test("the story shipped its change and finished, its item open and its claim given up", () => {
    expect(rules).toEqual(expect.arrayContaining(["claim.take", "step.run", "story.finish", "claim.release"]));
    expect(rules.filter((r) => r.endsWith("!"))).toEqual([]);
    expect(remoteBefore).toBe(storyHead);
    expect(localAfterFinish).toBe("");
  });

  test("a conflicting base is aborted and refused with its paths; the branch, the remote and the claim are as they were", () => {
    expect(conflict.code).toBe(3);
    expect(conflict.body).toMatchObject({ code: "conflict", details: { files: ["shared.txt"], base: "origin/main" } });
    expect(String(conflict.body.do_instead)).toContain(`norn story round ${KEY} --workflow`);
    expect(headAfterConflict).toBe(storyHead);
    expect(remoteAfterConflict).toBe(storyHead);
    expect(worktreeAfterConflict).toBeNull();
    expect(claimAfterConflict ?? null).toBeNull();
  });

  test("a clean base is merged with a merge commit, pushed and recorded", () => {
    expect(clean.code).toBe(0);
    expect(clean.body).toMatchObject({ story: KEY, branch: BRANCH, updated: true, base: "origin/main", base_sha: base, merged: true, from: storyHead, head: headAfterClean, pushed: true, claim_taken: true, replayed: false });
    expect(parents).toEqual([storyHead, base]);
    expect(remoteAfterClean).toBe(headAfterClean);
    expect(view.body.branch_updates).toEqual([{ at: expect.any(String), base: "origin/main", base_sha: base, merged: true, head: headAfterClean, pushed: true, by: expect.any(String), reason: "the base moved" }]);
  });

  test("the next tick applies the record and finishes the story again, removing the worktree", () => {
    expect(rulesAfterClean).toEqual(expect.arrayContaining(["claim.take", "receipts.apply", "story.finish", "claim.release"]));
    expect(rulesAfterClean.filter((r) => r.endsWith("!"))).toEqual([]);
    expect(worktreeAtEnd).toBeNull();
  });
});
