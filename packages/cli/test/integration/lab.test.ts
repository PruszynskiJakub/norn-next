/**
 * `norn lab` end to end: the lab builds a throwaway repo under its own TMPDIR, and its story plays the
 * eight beats with the bundled stand-in agent, the person's commands run as a person runs them.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sh } from "./world.ts";
import { calledBeyondVersion, inLab, KEY, type Lab, type LabSeen, machine, norn, nornLab, type Out, type Play, parkedOn, receipts, SLOW, snapshot, type StorySeen, story, tickUntil, type UnitSeen } from "./lab-world.ts";

describe("norn lab plays its story through eight beats", () => {
  let l: Lab;
  const play: Play = { rules: [], seen: [] };
  let personBefore: Record<string, string>;
  let siblingBefore: { files: Record<string, string>; head: string; status: string };
  let built: LabSeen;
  let app: { greet: string; test: string };
  let config: Record<string, Out>;
  let taken: { story: StorySeen | undefined; worktrees: string; branches: string };
  let asked: UnitSeen;
  let resumed: LabSeen;
  let answered: Out;
  let atGate: { unit: UnitSeen; story: StorySeen | undefined; lab: LabSeen; remote: string };
  let rejected: Out;
  let backAtGate: UnitSeen;
  let approved: Out;
  let toMerge: LabSeen;
  let ended: { story: StorySeen | undefined; lab: LabSeen; log: string };

  beforeAll(async () => {
    l = await machine();
    personBefore = snapshot(l.personHome);
    siblingBefore = { files: snapshot(join(l.sibling)), head: await sh(l.sibling, "git", "rev-parse", "HEAD"), status: await sh(l.sibling, "git", "status", "--porcelain") };
    built = await nornLab(l);
    // read before the play merges the story's change into the lab's repo
    app = { greet: readFileSync(join(l.repo, "greet.sh"), "utf8"), test: readFileSync(join(l.repo, "test.sh"), "utf8") };
    config = Object.fromEntries(
      await Promise.all(["tracker.use", "forge.use", "store.use", "checks.test", "executors.lab", "kernel.mode", "kernel.workflow"].map(async (k) => [k, await norn(l, "config", "get", k, "--json")] as const)),
    );
    // beat 1: taken in
    await tickUntil(l, play, (u) => u?.step === "implement");
    taken = { story: await story(l), worktrees: await sh(l.repo, "git", "worktree", "list"), branches: await sh(l.repo, "git", "branch", "--list", "norn/*") };
    // beats 2 and 3: a failing check, then a question
    asked = await tickUntil(l, play, parkedOn("answer"));
    resumed = await nornLab(l);
    answered = await norn(l, "story", "answer", KEY, "Keep the comma.");
    // beats 4 to 7: the review loop, the dead agent, the pull request, the gate
    const gate = await tickUntil(l, play, parkedOn("gate"));
    atGate = { unit: gate, story: await story(l), lab: await nornLab(l), remote: await sh(l.repo, "git", "ls-remote", "--heads", "origin", `norn/${KEY}`) };
    rejected = await norn(l, "story", "reject", KEY, "--reason", "Name the greeting in the README too.", "--json");
    backAtGate = await tickUntil(l, play, (u) => parkedOn("gate")(u) && (u?.counters["land.rejected"]?.value ?? 0) === 1);
    approved = await norn(l, "story", "approve", KEY, "--json");
    await tickUntil(l, play, (u) => u?.step === "merge");
    toMerge = await nornLab(l);
    // beat 8: the person merges with git
    const merge = await inLab(l, ["sh", "-c", toMerge.next ?? "false"]);
    if (merge.code !== 0) throw new Error(`the merge the lab names failed: ${merge.stdout}${merge.stderr}`);
    // the claim is given up on a tick after the one that ends the unit, as watch and the tour tick on
    await tickUntil(l, play, (u, s) => u?.ended !== undefined && s?.claim === null);
    ended = { story: await story(l), lab: await nornLab(l), log: await sh(l.repo, "git", "log", "--format=%s", "main") };
  }, SLOW);

  test("AC1: norn lab builds a git repo with the toy app and its test, a bare remote and its own norn home, set up for the lab, with a quick story", async () => {
    expect(built).toMatchObject({ built: true, story: KEY, root: l.root, repo: l.repo, home: l.home, beat: { n: 1, of: 8 } });
    expect(app.greet).toContain('echo "hello"');
    expect(app.test).toContain("want=");
    expect(await sh(built.remote, "git", "rev-parse", "--is-bare-repository")).toBe("true");
    expect(await sh(l.repo, "git", "remote", "get-url", "origin")).toBe(built.remote);
    expect(existsSync(join(l.home, "repos"))).toBe(true);
    expect(Object.fromEntries(Object.entries(config).map(([k, r]) => [k, r.body.value]))).toEqual({
      "tracker.use": "local",
      "forge.use": "none",
      "store.use": "local",
      "checks.test": "sh test.sh",
      "executors.lab": { harness: "lab", runner: "headless" },
      "kernel.mode": "auto",
      "kernel.workflow": "quick",
    });
  });

  test("AC2: beat 1 takes the story in, with its branch, its worktree and its claim", () => {
    expect(taken.story?.claim).not.toBeNull();
    expect(taken.story?.units[0]).toMatchObject({ id: KEY, step: "implement" });
    expect(taken.branches).toContain(`norn/${KEY}`);
    expect(taken.worktrees).toContain(`${l.home}/`);
    expect(taken.worktrees).toContain(`[norn/${KEY}]`);
  });

  test("AC3: beat 2 fails the check on a wrong greeting and loops back to implement, the check counter at 1", () => {
    const steps = play.seen.map((u) => u.step);
    const failed = play.seen.findIndex((u) => (u.counters["check.fail"]?.value ?? 0) === 1);
    expect(failed).toBeGreaterThan(-1);
    expect(steps.slice(0, failed + 1)).toContain("check");
    expect(play.seen[failed]?.step).toBe("implement");
    expect(play.rules).toContain("check.finished");
  });

  test("AC4: beat 3 parks on implement's question as needs-you; after norn story answer, implement goes on", () => {
    expect(asked).toMatchObject({ step: "implement", parked: "agent.asked", waiting: { for: "answer", next: `norn story answer ${KEY} "<answer>"` }, counters: { "check.fail": { value: 1 } } });
    expect(asked.waiting?.text).toContain("comma");
    expect(answered.code).toBe(0);
    const after = play.seen.slice(play.seen.indexOf(asked) + 1);
    expect(after.find((u) => u.step !== "implement")?.step).toBe("check");
  });

  test("AC5: beat 4's review returns changes_requested with findings, implement reworks, and review then approves", () => {
    const reported = receipts(l).filter((r) => r.kind === "run.reported" && r.outcome !== undefined);
    const outcomes = reported.map((r) => r.outcome);
    const asked4 = outcomes.indexOf("changes_requested");
    expect(asked4).toBeGreaterThan(-1);
    expect(reported[asked4]?.findings?.map((f) => f.title)).toEqual(["greet.sh does not say what it prints"]);
    expect(outcomes.slice(asked4 + 1)).toEqual(expect.arrayContaining(["done", "approve"]));
    expect(atGate.unit.counters["review.changes_requested"]?.value).toBe(1);
  });

  test("AC6: beat 5's agent dies mid-describe; a later tick retries it, and the fresh session finishes the step", () => {
    expect(play.rules).toContain("agent.died.retry");
    expect(play.rules.filter((r) => r.startsWith("agent.died.") && r !== "agent.died.retry")).toEqual([]);
    const describe = play.seen.findIndex((u) => u.step === "describe");
    expect(play.seen.slice(describe).some((u) => u.step === "open-pr" || u.step === "checks" || u.step === "ready")).toBe(true);
  });

  test("AC7: beat 6 opens the pull request on forge none", () => {
    expect(atGate.story?.change).toMatchObject({ id: 1, state: "open" });
    expect(atGate.remote).toContain(`refs/heads/norn/${KEY}`);
  });

  test("AC8: beat 7's ready gate waits as needs-you; a reject with a reason sends it back once, and approve passes it", () => {
    expect(atGate.unit).toMatchObject({ step: "ready", waiting: { for: "gate" } });
    expect(atGate.lab.beat.n).toBe(7);
    expect(rejected).toMatchObject({ code: 0, body: { unit: KEY, step: "ready", outcome: "reject" } });
    expect(backAtGate).toMatchObject({ step: "ready", waiting: { for: "gate" }, counters: { "land.rejected": { value: 1 } } });
    expect(approved).toMatchObject({ code: 0, body: { unit: KEY, step: "ready", outcome: "approve" } });
    expect(toMerge).toMatchObject({ beat: { n: 8 }, next: `git merge --no-ff --no-edit norn/${KEY} && git push -q origin main` });
  });

  test("AC9: beat 8 ends the story done after a git merge of its branch, and releases its claim", () => {
    expect(ended.story?.units[0]).toMatchObject({ ended: "done" });
    expect(ended.story?.change).toMatchObject({ state: "merged" });
    expect(ended.story?.claim).toBeNull();
    expect(ended.lab).toMatchObject({ built: false, beat: { n: 8 }, ended: "done", next: null });
    expect(ended.log).toContain("Keep the comma in the greeting");
    expect(play.rules.filter((r) => r.endsWith("!"))).toEqual([]);
  });

  test("AC10: no real harness is launched and no network tool is run: every agent run is the stand-in", () => {
    // init asks which tools answer `--version`, and is told none does; nothing else ran them
    expect(calledBeyondVersion(l)).toEqual([]);
    const executors = [...new Set(play.seen.flatMap((u) => (u.kind === "agent" && u.run ? [u.run.executor] : [])))];
    expect(executors).toEqual(["lab"]);
  });

  test("AC11: the person's own norn home and their repo beside the lab are left as they were", async () => {
    expect(snapshot(l.personHome)).toEqual(personBefore);
    expect(snapshot(l.sibling)).toEqual(siblingBefore.files);
    expect(await sh(l.sibling, "git", "rev-parse", "HEAD")).toBe(siblingBefore.head);
    expect(await sh(l.sibling, "git", "status", "--porcelain")).toBe(siblingBefore.status);
  });

  test("AC12: a second norn lab mid-story resumes at the beat the story's state shows, building nothing", () => {
    expect(resumed).toMatchObject({ built: false, story: KEY, beat: { n: 3 }, waiting: { for: "answer" }, next: `norn story answer ${KEY} "<answer>"` });
  });
});
