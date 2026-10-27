/**
 * Base sync through the CLI runtime with real git (BS0–BS11, SPEC-base-sync-and-qa §7 cases 1, 2, 4,
 * 6, 7b): a sibling merge into main is merged into the story branch by `git: update` with a
 * `Norn-Tick` merge commit; a conflicting one goes to `resolve` and back; a story waiting at `ready`
 * goes back through update when the base moves into a conflict; `norn update` re-enters a done story;
 * a PR merged into another branch parks the story; `base_branch: develop` is used throughout.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { herdr } from "@norn/adapters";
import { runCli, type TickReport } from "../src/index.ts";
import { createHarness, type Harness, installBundledSkills, issue, sh } from "./harness.ts";
import { expectTranscript, recordTranscript, type Transcript } from "./transcript.ts";

// whole flows over real git, several ticks each: 5 s is too tight on a loaded machine (full suite)
setDefaultTimeout(30_000);

const BASED = `name: based
start: update
steps:
  update:
    type: git
    action: update
    outcomes: { done: test, conflict: { to: resolve, counter: base_conflict_loop } }
  resolve:
    type: agent
    skill: norn-merge
    inputs: [spec, handoff]
    outcomes: { done: { to: update, means: "base merged into the story branch, conflicts resolved and committed" } }
  test:
    type: check
    run: "true"
    timeout: 1m
    outcomes: { pass: open-pr, fail: $stuck }
  open-pr:
    type: git
    action: open-pr
    outcomes: { done: ready }
  ready:
    type: gate
    outcomes:
      approve: $done
      reject: $stuck
      stale: { to: update, counter: stale_loop }
counters: { base_conflict_loop: { max: 2 }, stale_loop: { max: 3 } }
`;

const config = (extra = "") => `agents:
  claude: { adapter: claude }
runner: { adapter: headless }
remote: { provider: gh, label: norn }
default_workflow: based
default_mode: auto
notifiers: []
${extra}`;

const kinds = (r: TickReport) => r.decisions.filter((d) => d.kind !== "noop" && d.rule !== "claim.renew").map((d) => `${d.unit} ${d.rule}${d.ok ? "" : ` FAILED ${d.error}`}`);

/** commit `file` = `text` on `branch` of a fresh clone and push it — a sibling story merging into the base */
function siblingMerge(h: Harness, file: string, text: string, branch = "main"): string {
  const dir = join(h.dir, `sibling-${Math.random().toString(36).slice(2)}`);
  sh(h.dir, ["clone", "-q", "-b", branch, h.remoteDir, dir]);
  sh(dir, ["config", "user.email", "s@example.com"]);
  sh(dir, ["config", "user.name", "Sibling"]);
  writeFileSync(join(dir, file), text);
  sh(dir, ["add", "-A"]);
  sh(dir, ["commit", "-q", "-m", `sibling: ${file}`]);
  sh(dir, ["push", "-q", "origin", branch]);
  return sh(dir, ["rev-parse", "HEAD"]);
}

describe("base sync with real git", () => {
  let h: Harness;
  const wt = () => `${h.root}-worktrees/gh-7-add-login-form`;
  const runs = () => join(wt(), ".agents/specs/gh-7-add-login-form/runs/_story");
  const step = () => h.clock.advance(10_000);
  const until = async (pred: () => boolean, label: string, max = 20) => {
    const seen: string[] = [];
    for (let i = 0; i < max && !pred(); i++) {
      step();
      seen.push(...kinds(await h.tick()));
    }
    if (!pred()) throw new Error(`${label} not reached: ${JSON.stringify(h.state(runs()))}\n${seen.join("\n")}`);
    return seen;
  };

  beforeAll(async () => {
    h = await createHarness();
    h.write(join(h.root, ".agents/norn/config.yaml"), config());
    h.write(join(h.root, ".agents/norn/workflows/based.yaml"), BASED);
    installBundledSkills(h.root);
    writeFileSync(join(h.root, "a.txt"), "one\n");
    h.git(["add", "-A"]);
    h.git(["commit", "-q", "-m", "norn init"]);
    h.git(["push", "-q", "origin", "main"]);
    h.remote.issues = [issue(7, "Add login form")];
    transcript = recordTranscript(h);
  });
  afterAll(() => {
    transcript.stop();
    h.cleanup();
  });
  let transcript: Transcript;

  test("1: a sibling merge without conflicts is merged by update — one Norn-Tick merge commit, no foreign item, → test", async () => {
    expect(kinds(await h.tick())).toEqual(["gh-7 remote.intake"]);
    const sibling = siblingMerge(h, "b.txt", "b\n");
    step();
    await h.tick("--sync"); // claim; the base is fetched with the sync (P2)
    const seen = await until(() => h.state(runs())?.step === "test", "test");
    expect(seen).toContain("gh-7 git.update");
    expect(h.git(["log", "--merges", "--format=%H"], wt()).split("\n").filter(Boolean)).toHaveLength(1);
    const log = h.git(["log", "--merges", "-1", "--format=%s%n%P%n%(trailers:key=Norn-Tick,valueonly)"], wt()).split("\n");
    expect(log[0]).toBe(`Update gh-7 from main (${sibling.slice(0, 7)})`);
    expect(log[1]).toContain(sibling);
    expect(log[2]).toMatch(/^[0-9A-Z]{26}$/);
    // pushed at the step boundary (S8)
    expect(h.git(["ls-remote", "origin", "refs/heads/gh-7-add-login-form"]).split("\t")[0]).toBe(h.git(["rev-parse", "HEAD"], wt()));
    const inbox = (await h.norn("inbox")).value as { groups: Record<string, Array<{ id: string }>> };
    expect(inbox.groups.check?.filter((i) => i.id.startsWith("foreign:"))).toEqual([]);
    // norn status shows the base sync state and the update's merge commit
    const merge = h.git(["log", "--merges", "-1", "--format=%H"], wt());
    const status = (await h.norn("status", "gh-7")).value as { base_sync: unknown };
    expect(status.base_sync).toMatchObject({ branch: "main", conflicts: [], last_update: { sha: merge, base_sha: sibling, step: "update" } });
    expect((await h.norn("status")).stdout).toContain(`base main: up to date · last update merge ${merge.slice(0, 12)} (update, `);
  }, 60_000);

  test("4 + 2: waiting at ready, a conflicting sibling merge → stale → update → conflict → resolve (brief: base sha + paths) → done → update → test", async () => {
    await until(() => h.state(runs())?.step === "ready" && h.state(runs())?.status === "parked", "ready");
    expect(h.remote.prs).toMatchObject([{ base_branch: "main" }]);
    // the story changed a.txt (agent work, committed through norn)
    writeFileSync(join(wt(), "a.txt"), "story side\n");
    h.git(["add", "-A"], wt());
    h.git(["commit", "-q", "-m", "story edits a", "--trailer", "Norn-Tick: 01JBQ6ZK3E8Y4V5W6X7Y8Z9ABC"], wt());
    const sibling = siblingMerge(h, "a.txt", "base side\n");
    step();
    const r = kinds(await h.tick("--sync"));
    expect(r).toContain("gh-7 gate.stale");
    const st = h.state(runs());
    expect(st).toMatchObject({ step: "update", counters: { stale_loop: 1 } });
    const stale = JSON.parse(readFileSync(join(runs(), "receipts", (h.git(["ls-files", "--others", "--cached", "receipts"], runs()).split("\n").filter((f) => f.endsWith("-classify.json")).at(-1) as string).replace(/^receipts\//, "")), "utf8"));
    expect(stale).toMatchObject({ outcome: "stale", rule: "base moved", route: "update", base: { sha: sibling, conflicts: ["a.txt"], behind: 1 } });

    await until(() => h.state(runs())?.step === "resolve" && h.state(runs())?.status === "running", "resolve running");
    expect(h.state(runs())?.counters.base_conflict_loop).toBe(1);
    // the agent's brief, from the story worktree
    const b = await runCli(["brief", "--json"], { ...h.deps, cwd: wt() });
    const json = (b.value as { brief: { rework: { base?: { sha: string; conflicts: string[] } } | null } }).brief;
    expect(json.rework?.base).toMatchObject({ sha: sibling, conflicts: ["a.txt"] });
    expect(sh(wt(), ["status", "--porcelain"])).toBe("");

    // the agent merges the base in the story worktree, resolves by intent, commits (BS5)
    const merge = Bun.spawnSync(["git", "merge", "--no-ff", sibling], { cwd: wt() });
    expect(merge.exitCode).not.toBe(0);
    writeFileSync(join(wt(), "a.txt"), "story side\nbase side\n");
    h.git(["add", "a.txt"], wt());
    h.git(["commit", "-q", "--no-edit"], wt());
    h.report(runs(), "done", { outcome: "done", handoff: "merged main, kept both lines in a.txt" });
    const seen = await until(() => h.state(runs())?.step === "ready" && h.state(runs())?.status === "parked", "ready again");
    expect(seen).toContain("gh-7 git.update");
    expect(h.git(["merge-base", "--is-ancestor", sibling, "HEAD"], wt())).toBe("");
    const last = h.git(["log", "-3", "--format=%s"], wt());
    expect(last).not.toContain("Update gh-7 from main"); // the second update found it up to date: no merge commit
  }, 60_000);

  test("6: norn update re-enters a done, unmerged story; refused without the claim and once merged", async () => {
    expect((await h.norn("approve", "gh-7")).exit).toBe(0);
    await until(() => h.state(runs())?.status === "done", "done");
    // not done-and-waiting refusal paths first: a slice key is a usage of the story
    const ok = await h.norn("update", "gh-7");
    expect(ok.exit).toBe(0);
    expect(ok.value).toMatchObject({ unit: "gh-7", receipt: { kind: "update", from: "$done", to: "update", reason: "person", step: "$done" }, delivered: { via: "local" } });
    const again = await h.norn("update", "gh-7");
    expect(again.exit).toBe(3);
    expect(again.value).toMatchObject({ code: "already_recorded", do_instead: "norn tick" });
    expect((again.value as { error: string }).error).toMatch(/^an update of gh-7 is already recorded \(.*-update\.json\) and not applied yet$/);
    expect(again.value).not.toHaveProperty("details");
    step();
    expect(kinds(await h.tick())).toContain("gh-7 receipts.apply");
    expect(h.state(runs())).toMatchObject({ step: "update", status: "ready" });
    await until(() => h.state(runs())?.step === "ready" && h.state(runs())?.status === "parked", "ready (3rd)");
    expect((await h.norn("approve", "gh-7")).exit).toBe(0);
    await until(() => h.state(runs())?.status === "done", "done again");

    // without the claim: refused
    expect((await h.norn("release", "gh-7")).exit).toBe(0);
    const noClaim = await h.norn("update", "gh-7");
    expect(noClaim.exit).toBe(3);
    expect(noClaim.value).toMatchObject({ code: "not_holder", do_instead: "norn take gh-7" });
    expect((await h.norn("take", "gh-7")).exit).toBe(0);

    // 7b: merged into another branch → parked, no cleanup
    const pr = h.remote.prs[0] as (typeof h.remote.prs)[number];
    pr.state = "merged";
    pr.base_branch = "release";
    step();
    expect(kinds(await h.tick("--sync"))).toContain("gh-7 remote.park");
    expect(h.state(runs())?.park).toMatchObject({ kind: "remote", reason: "remote: PR merged into release, not main" });
    expect(existsSync(wt())).toBe(true);

    // merged into the base (the story branch lands on main) → cleanup and the done record; then update is refused
    pr.base_branch = "main";
    const land = join(h.dir, "land");
    sh(h.dir, ["clone", "-q", h.remoteDir, land]);
    sh(land, ["-c", "user.email=s@example.com", "-c", "user.name=S", "merge", "-q", "--no-ff", "-m", "Merge PR #100", "origin/gh-7-add-login-form"]);
    sh(land, ["push", "-q", "origin", "main"]);
    step();
    expect(kinds(await h.tick("--sync"))).toContain("gh-7 remote.pr_merged");
    const merged = await h.norn("update", "gh-7");
    expect(merged.exit).toBe(3);
    expect(merged.value).toMatchObject({ code: "story_merged" });
  }, 60_000);

  test("effect transcript: spawns, port calls and runs/ files of cases 1, 4 + 2 and 6 (refactor Phase 0.2)", () => {
    expectTranscript(transcript, "base-sync");
  });
});

describe("BS3.3a (dogfood D4): a person's push to the branch of a $done story", () => {
  let h: Harness;
  const wt = () => `${h.root}-worktrees/gh-13-take-person-pushes`;
  const runs = () => join(wt(), ".agents/specs/gh-13-take-person-pushes/runs/_story");
  const until = async (pred: () => boolean, label: string) => {
    const seen: string[] = [];
    for (let i = 0; i < 20 && !pred(); i++) {
      h.clock.advance(10_000);
      seen.push(...kinds(await h.tick()));
    }
    if (!pred()) throw new Error(`${label} not reached: ${JSON.stringify(h.state(runs()))}\n${seen.join("\n")}`);
    return seen;
  };

  beforeAll(async () => {
    h = await createHarness();
    h.write(join(h.root, ".agents/norn/config.yaml"), config());
    h.write(join(h.root, ".agents/norn/workflows/based.yaml"), BASED);
    installBundledSkills(h.root);
    h.git(["add", "-A"]);
    h.git(["commit", "-q", "-m", "norn init"]);
    h.git(["push", "-q", "origin", "main"]);
    h.remote.issues = [issue(13, "Take person pushes")];
  });
  afterAll(() => h.cleanup());

  test("norn's next commit merges it in (never rebases) and pushes; norn update does not end stuck diverged", async () => {
    await until(() => h.state(runs())?.step === "ready" && h.state(runs())?.status === "parked", "ready");
    expect((await h.norn("approve", "gh-13")).exit).toBe(0);
    await until(() => h.state(runs())?.status === "done", "done");
    const person = siblingMerge(h, "README.md", "a line from a person\n", "gh-13-take-person-pushes");
    expect((await h.norn("update", "gh-13")).exit).toBe(0);
    const seen = await until(() => h.state(runs())?.step === "ready" && h.state(runs())?.status === "parked", "ready again");
    expect(seen.filter((k) => k.includes("FAILED"))).toEqual([]);
    const head = h.git(["rev-parse", "HEAD"], wt());
    expect(h.git(["merge-base", "--is-ancestor", person, head], wt())).toBe("");
    expect(h.git(["log", "--format=%s", "-n", "20"], wt())).toContain("Merge origin/gh-13-take-person-pushes into gh-13-take-person-pushes");
    expect(h.git(["ls-remote", "origin", "refs/heads/gh-13-take-person-pushes"]).split("\t")[0]).toBe(head);
    expect(readFileSync(join(wt(), "README.md"), "utf8")).toBe("a line from a person\n");
  }, 60_000);
});

describe("base_branch: develop (BS0, 7b)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
    h.write(join(h.root, ".agents/norn/config.yaml"), config("base_branch: develop\n"));
    h.write(join(h.root, ".agents/norn/workflows/based.yaml"), BASED);
    installBundledSkills(h.root);
    h.git(["add", "-A"]);
    h.git(["commit", "-q", "-m", "norn init"]);
    h.git(["push", "-q", "origin", "main"]);
    h.git(["push", "-q", "origin", "main:develop"]);
    h.git(["fetch", "-q", "origin"]);
    h.git(["branch", "-q", "develop", "origin/develop"]);
    h.remote.issues = [issue(8, "Use develop")];
  });
  afterAll(() => h.cleanup());

  test("intake from develop, update merges develop, open-pr targets develop", async () => {
    const wt = `${h.root}-worktrees/gh-8-use-develop`;
    const runs = join(wt, ".agents/specs/gh-8-use-develop/runs/_story");
    await h.tick();
    const sibling = siblingMerge(h, "d.txt", "d\n", "develop");
    siblingMerge(h, "m.txt", "m\n", "main"); // main moves too: never merged into the story
    h.clock.advance(10_000);
    await h.tick("--sync");
    for (let i = 0; i < 12 && h.state(runs)?.step !== "ready"; i++) {
      h.clock.advance(10_000);
      await h.tick();
    }
    expect(h.state(runs)).toMatchObject({ step: "ready", status: "parked" });
    expect(h.git(["log", "--format=%s"], wt)).toContain(`Update gh-8 from develop (${sibling.slice(0, 7)})`);
    expect(existsSync(join(wt, "m.txt"))).toBe(false);
    expect(h.remote.prs).toMatchObject([{ head: "gh-8-use-develop", base_branch: "develop" }]);
  }, 60_000);
});

describe("PR items between syncs and in the read model (C1), ready approval voided by norn update (C5)", () => {
  let h: Harness;
  const wt = () => `${h.root}-worktrees/gh-9-pay-by-card`;
  const runs = () => join(wt(), ".agents/specs/gh-9-pay-by-card/runs/_story");
  type View = { groups: Record<string, Array<{ id: string; command: string; detail?: string }>> };
  const view = async () => (await h.norn("inbox")).value as View;
  const ids = (v: View, group: string) => (v.groups[group] ?? []).map((i) => i.id);
  /** the tick-side open set (inbox history, O4) */
  const open = () => Object.keys((JSON.parse(h.read(join(h.root, ".agents/norn/trace/inbox.json"))) as { open: Record<string, unknown> }).open);
  const until = async (pred: () => boolean, label: string) => {
    for (let i = 0; i < 20 && !pred(); i++) {
      h.clock.advance(10_000);
      await h.tick();
    }
    if (!pred()) throw new Error(`${label} not reached: ${JSON.stringify(h.state(runs()))}`);
  };

  beforeAll(async () => {
    h = await createHarness();
    h.write(join(h.root, ".agents/norn/config.yaml"), config());
    h.write(join(h.root, ".agents/norn/workflows/based.yaml"), BASED);
    installBundledSkills(h.root);
    writeFileSync(join(h.root, "a.txt"), "one\n");
    h.git(["add", "-A"]);
    h.git(["commit", "-q", "-m", "norn init"]);
    h.git(["push", "-q", "origin", "main"]);
    h.remote.issues = [issue(9, "Pay by card")];
  });
  afterAll(() => h.cleanup());

  test("C1: a done story conflicting with its base keeps its Merge item (norn update) and a retarget item, in every tick and in norn inbox", async () => {
    await h.tick();
    h.clock.advance(10_000);
    await h.tick("--sync");
    await until(() => h.state(runs())?.step === "ready" && h.state(runs())?.status === "parked", "ready");
    writeFileSync(join(wt(), "a.txt"), "story side\n");
    h.git(["add", "-A"], wt());
    h.git(["commit", "-q", "-m", "story edits a", "--trailer", "Norn-Tick: 01JBQ6ZK3E8Y4V5W6X7Y8Z9ABC"], wt());
    expect((await h.norn("approve", "gh-9")).exit).toBe(0);
    await until(() => h.state(runs())?.status === "done", "done");
    siblingMerge(h, "a.txt", "base side\n");
    const pr = h.remote.prs[0] as (typeof h.remote.prs)[number];
    pr.base_branch = "release";
    h.clock.advance(10_000);
    await h.tick("--sync");

    const merge = `merge:gh-9:${pr.number}`;
    const retarget = `retarget:gh-9:${pr.number}:release`;
    // the read model: no remote calls, the last sync's PR
    const v = await view();
    expect(v.groups.your_turn?.find((i) => i.id === merge)).toMatchObject({ command: "norn update gh-9" });
    expect(v.groups.your_turn?.find((i) => i.id === merge)?.detail).toContain("behind main by 1");
    expect(ids(v, "check")).toContain(retarget);
    expect(open()).toEqual(expect.arrayContaining([merge, retarget]));
    // a done story behind a conflicting base says so in norn status
    expect(((await h.norn("status", "gh-9")).value as { base_sync: unknown }).base_sync).toMatchObject({ branch: "main", behind: 1, conflicts: ["a.txt"] });
    expect((await h.norn("status")).stdout).toContain("base main: 1 behind · conflicts a.txt");
    // ticks between syncs: the items stay open (no appear/resolve flicker)
    const calls = h.remote.calls.length;
    for (let i = 0; i < 3; i++) {
      h.clock.advance(1_000);
      await h.tick();
      expect(open()).toEqual(expect.arrayContaining([merge, retarget]));
    }
    expect(h.remote.calls.length).toBe(calls);
    const history = (await h.norn("inbox", "--history")).value as { items: Array<{ id: string; resolved_at: string | null }> };
    expect(history.items.filter((i) => i.id === merge || i.id === retarget).map((i) => i.resolved_at)).toEqual([null, null]);
    pr.base_branch = "main";
  }, 60_000);

  test("C5: norn's own commits after the ready approval (its $done commit) are no head change; anyone else's commit is", async () => {
    const pr = h.remote.prs[0] as (typeof h.remote.prs)[number];
    const approve = h.git(["log", "--format=%H", "-1", "--grep", "story edits a"], wt());
    const head = h.git(["rev-parse", "HEAD"], wt());
    expect(head).not.toBe(approve);
    expect(h.git(["log", "--format=%(trailers:key=Norn-Story,valueonly)", `${approve}..${head}`], wt()).split("\n").filter(Boolean).every((s) => s === "gh-9")).toBe(true);
    pr.head_sha = head;
    h.clock.advance(10_000);
    await h.tick("--sync");
    expect(ids(await view(), "check").filter((i) => i.startsWith("head:"))).toEqual([]);
    expect(open().filter((i) => i.startsWith("head:"))).toEqual([]);
    // a person's commit on top: the head changed after the approval
    writeFileSync(join(wt(), "late.txt"), "late\n");
    h.git(["add", "-A"], wt());
    h.git(["commit", "-q", "-m", "late fix"], wt());
    pr.head_sha = h.git(["rev-parse", "HEAD"], wt());
    h.clock.advance(10_000);
    await h.tick("--sync");
    expect(ids(await view(), "check")).toContain(`head:gh-9:${pr.head_sha}`);
    expect(open()).toContain(`head:gh-9:${pr.head_sha}`);
  }, 60_000);

  test("C5: after norn update from $done, the old ready approval no longer pins the head", async () => {
    const pr = h.remote.prs[0] as (typeof h.remote.prs)[number];
    const approved = h.git(["rev-parse", "HEAD"], wt());
    pr.head_sha = "f".repeat(40);
    h.clock.advance(10_000);
    await h.tick("--sync");
    // F35 still holds before the re-entry: the head moved after the approval
    expect(ids(await view(), "check")).toContain(`head:gh-9:${"f".repeat(40)}`);
    expect(open()).toContain(`head:gh-9:${"f".repeat(40)}`);
    expect(approved).toMatch(/^[0-9a-f]{40}$/);

    expect((await h.norn("update", "gh-9")).exit).toBe(0);
    h.clock.advance(10_000);
    await h.tick("--sync");
    expect(h.state(runs())?.step).not.toBe("$done");
    pr.head_sha = "e".repeat(40);
    h.clock.advance(10_000);
    await h.tick("--sync");
    expect(ids(await view(), "check").filter((i) => i.startsWith("head:"))).toEqual([]);
    expect(open().filter((i) => i.startsWith("head:"))).toEqual([]);
  }, 60_000);
});

describe("H1/BS5: a resolve parked mid-merge — norn never concludes the merge; done is verified", () => {
  let h: Harness;
  const wt = () => `${h.root}-worktrees/gh-11-merge-safely`;
  const runs = () => join(wt(), ".agents/specs/gh-11-merge-safely/runs/_story");
  /** a Claude Code permission dialog in the agent's pane (as in prompts.test.ts) */
  const SCREEN = [" Bash command", "", " │ python3 fix.py", "╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌", " Do you want to proceed?", " ❯ 1. Yes", "   2. No", "", " Esc to cancel · Tab to amend"].join("\n");
  const inWt = (...argv: string[]) => runCli(argv, { ...h.deps, cwd: wt() });
  const until = async (pred: () => boolean, label: string) => {
    const seen: string[] = [];
    for (let i = 0; i < 20 && !pred(); i++) {
      h.clock.advance(10_000);
      seen.push(...kinds(await h.tick()));
    }
    if (!pred()) throw new Error(`${label} not reached: ${JSON.stringify(h.state(runs()))}\n${seen.join("\n")}`);
    return seen;
  };

  beforeAll(async () => {
    h = await createHarness();
    h.write(join(h.root, ".agents/norn/config.yaml"), config().replace("runner: { adapter: headless }", "runner: { adapter: herdr }"));
    h.write(join(h.root, ".agents/norn/workflows/based.yaml"), BASED);
    installBundledSkills(h.root);
    writeFileSync(join(h.root, "a.txt"), "one\n");
    h.git(["add", "-A"]);
    h.git(["commit", "-q", "-m", "norn init"]);
    h.git(["push", "-q", "origin", "main"]);
    h.remote.issues = [issue(11, "Merge safely")];
  });
  afterAll(() => h.cleanup());

  test("park while the agent's merge is in progress: no commit, MERGE_HEAD kept, nothing pushed; done refused until the merge is concluded clean", async () => {
    await h.tick();
    writeFileSync(join(wt(), "a.txt"), "story side\n");
    h.git(["add", "-A"], wt());
    h.git(["commit", "-q", "-m", "story edits a", "--trailer", "Norn-Tick: 01JBQ6ZK3E8Y4V5W6X7Y8Z9ABC"], wt());
    const sibling = siblingMerge(h, "a.txt", "base side\n");
    h.clock.advance(10_000);
    await h.tick("--sync");
    await until(() => h.state(runs())?.step === "resolve" && h.state(runs())?.status === "running", "resolve running");

    // the agent starts the merge; a permission prompt parks it with conflict markers in the work tree
    expect(Bun.spawnSync(["git", "merge", "--no-ff", sibling], { cwd: wt() }).exitCode).not.toBe(0);
    const before = h.git(["rev-parse", "HEAD"], wt());
    const pushed = h.git(["ls-remote", "origin", "refs/heads/gh-11-merge-safely"]).split("\t")[0];
    const prompt = herdr.parsePanePrompt(SCREEN);
    h.runner.pane = { alive: true, state: "waiting_input", since: null, detail: SCREEN, ...(prompt ? { prompt } : {}) };
    h.clock.advance(10_000);
    const t = await h.tick();
    expect(kinds(t)).toEqual(["gh-11 agent.ask.implicit"]);
    expect(h.state(runs())).toMatchObject({ status: "parked", park: { kind: "ask" } });
    // the trace records why the park commit waits
    const traced = h.read(join(h.root, ".agents/norn/trace", t.trace));
    expect(traced).toContain("merge in progress (unmerged: a.txt): nothing committed; the commit waits until it is concluded");
    expect(h.git(["rev-parse", "HEAD"], wt())).toBe(before);
    expect(existsSync(join(h.git(["rev-parse", "--absolute-git-dir"], wt()), "MERGE_HEAD"))).toBe(true);
    expect(h.git(["ls-remote", "origin", "refs/heads/gh-11-merge-safely"]).split("\t")[0]).toBe(pushed);
    expect(h.git(["log", "--format=%H", "--grep", "<<<<<<<", "--all"])).toBe("");

    // BS5.1 (dogfood D3): answered, the agent's next command mid-merge hits a second prompt — the
    // deferred commit does not starve the unit: it parks on the new prompt (an Answer item again)
    expect((await h.norn("answer", "gh-11", "1")).exit).toBe(0);
    h.clock.advance(10_000);
    expect(kinds(await h.tick())).toEqual(["gh-11 receipts.apply"]);
    expect(h.state(runs())?.status).toBe("running");
    h.clock.advance(10_000);
    expect(kinds(await h.tick())).toEqual(["gh-11 agent.ask.implicit"]);
    expect(h.state(runs())).toMatchObject({ status: "parked", park: { kind: "ask" } });
    expect(((await h.norn("inbox")).value as { groups: Record<string, Array<{ id: string }>> }).groups.answer).toHaveLength(1);
    expect(h.git(["rev-parse", "HEAD"], wt())).toBe(before);

    // done mid-merge → refused, nothing written
    const mid = await inWt("done", "done", "--handoff", "merged main");
    expect(mid.exit).toBe(3);
    expect(mid.value).toMatchObject({ code: "merge_unfinished", error: expect.stringContaining("unmerged: a.txt") });
    // concluded with the markers still in a.txt → refused
    h.git(["add", "-A"], wt());
    h.git(["commit", "-q", "--no-edit"], wt());
    const marked = await inWt("done", "done", "--handoff", "merged main");
    expect(marked.exit).toBe(3);
    expect(marked.value).toMatchObject({ code: "merge_unfinished", details: { markers: ["a.txt:1", "a.txt:5"] } });
    expect(String((marked.value as { error: unknown }).error)).toContain("conflict markers left after merging");
    // fixed in a follow-up commit → accepted, the merge commit recorded
    const merge = h.git(["rev-parse", "HEAD"], wt());
    // BS5.2 (dogfood D5): norn's owed commit is clean, but pushing it would publish the agent's merge
    // commit with markers — the push is held: ok:false, an Unblock item naming file and commit
    expect((await h.norn("answer", "gh-11", "1")).exit).toBe(0);
    h.runner.pane = { alive: true, state: "working", since: null };
    h.clock.advance(10_000);
    const held = await h.tick();
    expect(kinds(held)).toEqual([expect.stringMatching(/^gh-11 receipts\.apply FAILED .*held: conflict markers in a\.txt \(commit [0-9a-f]{12}\)/)]);
    expect(kinds(held)[0]).toContain(`(commit ${merge.slice(0, 12)})`);
    expect(h.git(["rev-parse", "HEAD~1"], wt())).toBe(merge);
    expect(h.git(["ls-remote", "origin", "refs/heads/gh-11-merge-safely"]).split("\t")[0]).toBe(pushed);
    const unblock = ((await h.norn("inbox")).value as { groups: Record<string, Array<{ title: string }>> }).groups.unblock ?? [];
    expect(unblock.map((i) => i.title)).toEqual([expect.stringContaining(`conflict markers in a.txt (commit ${merge.slice(0, 12)})`)]);
    writeFileSync(join(wt(), "a.txt"), "story side\nbase side\n");
    h.git(["commit", "-q", "-am", "resolve a.txt"], wt());
    const head = h.git(["rev-parse", "HEAD"], wt());
    const ok = await inWt("done", "done", "--handoff", "merged main, kept both lines");
    expect(ok.exit).toBe(0);
    expect(ok.value).toMatchObject({ base_merge: { sha: sibling, merge, head } });
    expect(h.git(["log", "-1", "--format=%P", merge], wt()).split(" ")).toHaveLength(2);

    h.runner.pane = { alive: true, state: "working", since: null };
    await until(() => h.state(runs())?.step === "ready" && h.state(runs())?.status === "parked", "ready");
    const why = (await h.norn("why", "gh-11", "--transition", "resolve.done")).stdout;
    expect(why).toContain(`by merge commit ${merge}`);
    // the agent's merge and fix-up, made during its run, are not foreign (C4)
    const inbox = (await h.norn("inbox")).value as { groups: Record<string, Array<{ id: string }>> };
    expect(inbox.groups.check?.filter((i) => i.id.startsWith("foreign:"))).toEqual([]);
  }, 60_000);

  test("a norn commit that would record conflict markers is refused: ok:false, an Unblock item, nothing pushed", async () => {
    // an unresolved file left in the story worktree when the person approves
    writeFileSync(join(wt(), "b.txt"), ["<<<<<<< HEAD", "ours", "=======", "theirs", ">>>>>>> main", ""].join("\n"));
    const before = h.git(["rev-parse", "HEAD"], wt());
    expect((await h.norn("approve", "gh-11")).exit).toBe(0);
    h.clock.advance(10_000);
    const t = await h.tick();
    expect(kinds(t).find((k) => k.startsWith("gh-11 receipts.apply"))).toContain("FAILED commit on gh-11-merge-safely refused: conflict markers in b.txt");
    expect(h.git(["rev-parse", "HEAD"], wt())).toBe(before);
    expect(h.git(["ls-remote", "origin", "refs/heads/gh-11-merge-safely"]).split("\t")[0]).toBe(before);
    const inbox = (await h.norn("inbox")).value as { groups: Record<string, Array<{ title: string }>> };
    expect(inbox.groups.unblock?.map((i) => i.title)).toEqual([expect.stringContaining("conflict markers in b.txt")]);
  }, 60_000);
});

describe("BUG-2: an update conflict that exhausts base_conflict_loop, then unstick --to resolve (BS5, W4)", () => {
  let h: Harness;
  const wt = () => `${h.root}-worktrees/gh-12-conflict-twice`;
  const runs = () => join(wt(), ".agents/specs/gh-12-conflict-twice/runs/_story");
  const inWt = (...argv: string[]) => runCli(argv, { ...h.deps, cwd: wt() });
  const lastClassify = () => {
    const file = h.git(["ls-files", "--others", "--cached", "receipts"], runs()).split("\n").filter((f) => f.endsWith("-classify.json")).at(-1) as string;
    return JSON.parse(readFileSync(join(runs(), file), "utf8"));
  };
  const until = async (pred: () => boolean, label: string) => {
    for (let i = 0; i < 20 && !pred(); i++) {
      h.clock.advance(10_000);
      await h.tick();
    }
    if (!pred()) throw new Error(`${label} not reached: ${JSON.stringify(h.state(runs()))}`);
  };
  /** the story side and a sibling on the base both change a.txt; returns the sibling's sha */
  const conflict = (n: number) => {
    writeFileSync(join(wt(), "a.txt"), `story side ${n}\n`);
    h.git(["add", "-A"], wt());
    h.git(["commit", "-q", "-m", `story edits a ${n}`, "--trailer", "Norn-Tick: 01JBQ6ZK3E8Y4V5W6X7Y8Z9ABC"], wt());
    return siblingMerge(h, "a.txt", `base side ${n}\n`);
  };

  beforeAll(async () => {
    h = await createHarness();
    h.write(join(h.root, ".agents/norn/config.yaml"), config());
    h.write(join(h.root, ".agents/norn/workflows/based.yaml"), BASED.replace("base_conflict_loop: { max: 2 }", "base_conflict_loop: { max: 1 }"));
    installBundledSkills(h.root);
    writeFileSync(join(h.root, "a.txt"), "one\n");
    h.git(["add", "-A"]);
    h.git(["commit", "-q", "-m", "norn init"]);
    h.git(["push", "-q", "origin", "main"]);
    h.remote.issues = [issue(12, "Conflict twice")];
  });
  afterAll(() => h.cleanup());

  test("act records route $stuck and the unit stays stuck at update; after unstick --to resolve, done without the merge is refused", async () => {
    await h.tick();
    const first = conflict(1);
    h.clock.advance(10_000);
    await h.tick("--sync");
    await until(() => h.state(runs())?.step === "resolve" && h.state(runs())?.status === "running", "resolve running");
    expect(lastClassify()).toMatchObject({ outcome: "conflict", route: "resolve", base: { sha: first } });
    // the agent merges and concludes; update merges cleanly
    expect(Bun.spawnSync(["git", "merge", "--no-ff", first], { cwd: wt() }).exitCode).not.toBe(0);
    writeFileSync(join(wt(), "a.txt"), "story side 1\nbase side 1\n");
    h.git(["add", "a.txt"], wt());
    h.git(["commit", "-q", "--no-edit"], wt());
    h.report(runs(), "done", { outcome: "done", handoff: "merged main" });
    await until(() => h.state(runs())?.step === "ready" && h.state(runs())?.status === "parked", "ready");
    expect(h.state(runs())?.counters.base_conflict_loop).toBe(1);

    // a second conflicting base move (ready → stale → update): base_conflict_loop 1/1 is used up,
    // so act's classify receipt records $stuck, not the edge's target `resolve`
    const second = conflict(2);
    h.clock.advance(10_000);
    await h.tick("--sync");
    await until(() => h.state(runs())?.status === "stuck", "stuck");
    expect(lastClassify()).toMatchObject({ outcome: "conflict", route: "$stuck", base: { sha: second } });
    expect(h.state(runs())).toMatchObject({ step: "update", status: "stuck", park: { kind: "exhausted" } });
    h.clock.advance(10_000);
    await h.tick();
    expect(h.state(runs())).toMatchObject({ step: "update", status: "stuck" });

    // a person sends it to resolve: the brief still names the base, and done still verifies it (BS5)
    expect((await h.norn("unstick", "gh-12", "--to", "resolve", "--reset", "base_conflict_loop")).exit).toBe(0);
    await until(() => h.state(runs())?.step === "resolve" && h.state(runs())?.status === "running", "resolve running again");
    const b = await inWt("brief", "--json");
    expect((b.value as { brief: { rework: { base?: { sha: string } } | null } }).brief.rework?.base).toMatchObject({ sha: second });
    const unmerged = await inWt("done", "done", "--handoff", "nothing merged");
    expect(unmerged.exit).toBe(3);
    expect(unmerged.value).toMatchObject({ code: "merge_unfinished" });
  }, 60_000);
});
