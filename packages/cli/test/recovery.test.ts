/**
 * Auto-mode recovery (SPEC-auto-mode-recovery R1–R3): two clones of one bare remote.
 *   - R1.2: a renewal that loses its CAS stops the story's other actions in that tick.
 *   - R2.3: the checkout that lost the claim reports its unpushed receipt; `tidy` moves it to
 *     `orphaned/` on the local branch and pushes nothing.
 *   - R3.1: the loser of an intake race removes its local intake.
 *   - R3.3: release refuses a push that is not a fast-forward and keeps the claim.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Inbox, RunnerPort } from "@norn/core";
import { type CliDeps, type CliResult, runCli, type TickReport } from "../src/index.ts";
import { createHarness, FakeRunner, type Harness, issue, sh } from "./harness.ts";

// whole flows over real git, several ticks each: 5 s is too tight on a loaded machine (full suite)
setDefaultTimeout(30_000);

const SOLO = `name: solo
start: implement
steps:
  implement:
    type: agent
    skill: implement
    outcomes: { done: { to: $done, means: "implemented" } }
`;

const CONFIG = `agents:
  claude: { adapter: claude }
runner: { adapter: headless }
remote: { provider: gh, label: norn }
default_workflow: solo
default_mode: auto
notifiers: []
`;

interface Clone {
  root: string;
  norn(...argv: string[]): Promise<CliResult>;
  tick(...flags: string[]): Promise<TickReport>;
}

function wrap(root: string, deps: CliDeps): Clone {
  return {
    root,
    norn: (...argv) => runCli(argv, deps),
    async tick(...flags) {
      const r = await runCli(["tick", ...flags], deps);
      if (r.exit !== 0) throw new Error(`tick failed: ${r.stdout}`);
      return r.value as TickReport;
    },
  };
}

/** Another machine: its own clone, ~/.norn, user@machine and runner; same remote, issues and clock. */
function cloneOf(h: Harness, name: string, user: string): Clone {
  const root = join(h.dir, name);
  sh(h.dir, ["clone", "-q", h.remoteDir, root]);
  sh(root, ["config", "user.email", `${user}@example.com`]);
  sh(root, ["config", "user.name", user]);
  const home = join(h.dir, `home-${name}`);
  mkdirSync(home);
  const runner = new FakeRunner();
  (runner as { name: string }).name = `fake-${name}`;
  return wrap(root, {
    cwd: root,
    env: { ...process.env, NORN_HOME_DIR: home, USER: user, NORN_MACHINE: name, NORN_HOOK_COMMAND: "norn hook" },
    clock: h.clock,
    ports: { remote: h.remote, runner: runner as RunnerPort, notifiers: [] },
  });
}

/** Every decision with its result, renewals included (they are what R1 is about). */
const all = (r: TickReport) => r.decisions.filter((d) => d.kind !== "noop").map((d) => `${d.unit} ${d.rule}${d.ok ? "" : ` FAILED ${d.error?.split("\n")[0]}`}`);

async function setup(h: Harness, n: number, title: string): Promise<void> {
  expect((await h.norn("init")).exit).toBe(0);
  h.write(join(h.root, ".agents/norn/config.yaml"), CONFIG);
  h.write(join(h.root, ".agents/norn/workflows/solo.yaml"), SOLO);
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn init"]);
  h.git(["push", "-q", "origin", "main"]);
  h.remote.issues = [issue(n, title)];
}

describe("a claim lost mid-run (R1.2, R2.3)", () => {
  let h: Harness;
  let A: Clone;
  let B: Clone;
  const SPEC = ".agents/specs/gh-9-add-search";
  const BRANCH = "gh-9-add-search";
  const storyRuns = (root: string) => join(`${root}-worktrees/${BRANCH}`, SPEC, "runs/_story");
  const step = (ms = 10_000) => h.clock.advance(ms);
  const remoteHead = () => h.git(["ls-remote", "origin", `refs/heads/${BRANCH}`]).split("\t")[0];

  beforeAll(async () => {
    h = await createHarness();
    A = wrap(h.root, h.deps);
    await setup(h, 9, "Add search");
    for (const want of ["intake_story", "claim", "start_unit", "start_run"]) {
      const r = await A.tick();
      expect(r.decisions.filter((d) => d.kind !== "noop").map((d) => d.kind)).toEqual([want]);
      step();
    }
  });
  afterAll(() => h.cleanup());

  test("R1.2: the renewal loses its CAS → the waiting done receipt is skipped, nothing is written or pushed", async () => {
    // the agent on A finishes; before A's next tick, B force-takes the story
    h.report(storyRuns(A.root), "done", { outcome: "done", handoff: "search works" });
    B = cloneOf(h, "repo-b", "bob");
    expect((await B.norn("take", "gh-9", "--force")).exit).toBe(0);
    const head = remoteHead();
    step(4 * 60_000); // A's renewal is due; A still believes it holds the claim (no sync)
    const r = await A.tick("--offline");
    expect(all(r)).toEqual(["gh-9 claim.renew FAILED " + r.decisions[0]?.error?.split("\n")[0], "gh-9 receipts.apply FAILED skipped: claim lost"]);
    expect(r.decisions.find((d) => d.rule === "receipts.apply")?.error).toBe("skipped: claim lost");
    expect(h.state(storyRuns(A.root))).toMatchObject({ step: "implement", status: "running" });
    expect(remoteHead()).toBe(head);
  });

  test("R2.3: the non-holder reports its unpushed receipt; tidy moves it to orphaned/ locally and pushes nothing", async () => {
    step();
    const r = await A.tick("--sync");
    expect(r.decisions.filter((d) => d.unit === "gh-9")).toEqual([{ unit: "gh-9", rule: "claim.other", kind: "noop", ok: true }]);
    const done = readdirSync(join(storyRuns(A.root), "receipts")).find((f) => f.endsWith("-done.json")) as string;
    const inbox = (await A.norn("inbox")).value as Inbox;
    expect(inbox.groups.check).toEqual([
      expect.objectContaining({ story: "gh-9", command: "norn tidy", title: `local work on gh-9 is not in the record (${done.replace(/\.json$/, "")}) — the story is now held by bob@repo-b` }),
    ]);

    const head = remoteHead();
    const t = await A.norn("tidy");
    expect(t.exit).toBe(0);
    const orphaned = `${SPEC}/runs/_story/orphaned/tester@box-${done}`;
    expect(t.value).toMatchObject({ orphaned: [{ story: "gh-9", unit: "gh-9", moved: [{ from: `${SPEC}/runs/_story/receipts/${done}`, to: orphaned }], commit: expect.any(String) }] });
    expect(existsSync(join(storyRuns(A.root), "receipts", done))).toBe(false);
    expect(existsSync(join(`${A.root}-worktrees/${BRANCH}`, orphaned))).toBe(true);
    // committed on the local branch only; the record is untouched
    expect(remoteHead()).toBe(head);
    expect(sh(`${A.root}-worktrees/${BRANCH}`, ["status", "--porcelain"])).toBe("");
    expect(((await A.norn("inbox")).value as Inbox).groups.check).toEqual([]);
  });
});

describe("intake race and release (R3.1, R3.3)", () => {
  let h: Harness;
  let A: Clone;
  let B: Clone;
  const BRANCH = "gh-10-add-filters";
  const step = (ms = 10_000) => h.clock.advance(ms);

  beforeAll(async () => {
    h = await createHarness();
    A = wrap(h.root, h.deps);
    await setup(h, 10, "Add filters");
    B = cloneOf(h, "repo-b", "bob");
  });
  afterAll(() => h.cleanup());

  test("R3.1: both clones intake the issue; the one losing the claim CAS removes its local intake", async () => {
    expect(all(await A.tick())).toEqual(["gh-10 remote.intake"]);
    expect(all(await B.tick())).toEqual(["gh-10 remote.intake"]);
    expect(existsSync(`${B.root}-worktrees/${BRANCH}`)).toBe(true);
    step();
    expect(all(await A.tick())).toEqual(["gh-10 claim.acquire.intake"]);
    const r = await B.tick();
    expect(all(r)[0]).toMatch(/^gh-10 claim\.acquire\.intake FAILED held by tester@box/);
    expect(existsSync(`${B.root}-worktrees/${BRANCH}`)).toBe(false);
    expect(sh(B.root, ["branch", "--list", BRANCH])).toBe("");
    expect(readdirSync(join(h.dir, "home-repo-b", "leases"))).toEqual([]);
  });

  test("R3.3: release refuses a push that is not a fast-forward; the claim and the remote branch stay", async () => {
    step();
    expect(all(await A.tick())).toEqual(["gh-10 story.start"]);
    // someone else's commit lands on the remote story branch
    const other = join(h.dir, "other");
    sh(h.dir, ["clone", "-q", "-b", BRANCH, h.remoteDir, other]);
    sh(other, ["-c", "user.email=o@example.com", "-c", "user.name=O", "commit", "-q", "--allow-empty", "-m", "outside"]);
    sh(other, ["push", "-q", "origin", BRANCH]);
    const head = h.git(["ls-remote", "origin", `refs/heads/${BRANCH}`]).split("\t")[0];
    const r = await A.norn("release", "gh-10");
    expect(r.exit).not.toBe(0);
    expect((r.value as { error: string }).error).toContain(`${BRANCH} is not a fast-forward of origin/${BRANCH}`);
    expect(h.git(["ls-remote", "origin", `refs/heads/${BRANCH}`]).split("\t")[0]).toBe(head);
    expect(h.git(["ls-remote", "origin", "refs/norn/claims/gh-10"])).not.toBe("");
  });
});
