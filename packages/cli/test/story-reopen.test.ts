/**
 * `norn story reopen` (B40–B42, B55, D4, D5): a close is not final. Reopen re-claims the story here,
 * restores its worktrees from the pushed branches, sets `spec.md` back to `active` in one commit,
 * and brings each unit back at its step — a unit that was running comes back stuck (`reopened`).
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type CliResult } from "../src/index.ts";
import { createHarness, FakeInteraction, type Harness, issue, sh } from "./harness.ts";
import { runChecked } from "./harness.ts";

setDefaultTimeout(60_000);

const MINI = `name: mini
start: plan
steps:
  plan:
    type: agent
    skill: norn-plan
    outcomes: { done: { to: slices, means: "slice files written" } }
  slices:
    type: slices
    outcomes: { done: $done, stuck: $stuck }
`;

const SLICE = `name: slice
start: implement
steps:
  implement:
    type: agent
    skill: norn-implement
    outcomes: { done: { to: review, means: "tests pass" } }
  review:
    type: gate
    prompt: "Look at it"
    outcomes: { approve: integrate, reject: { to: implement, counter: loop } }
  integrate:
    type: git
    action: integrate
    outcomes: { done: $done, conflict: { to: implement, counter: loop } }
counters: { loop: { max: 3 } }
`;

const CONFIG = `agents:
  claude: { adapter: claude }
runner: { adapter: headless }
remote: { provider: gh, label: norn }
default_workflow: mini
default_mode: auto
notifiers: []
`;

const SPEC = ".agents/specs/gh-7-add-login-form";
const BRANCH = "gh-7-add-login-form";
let h: Harness;
const storyWt = () => `${h.root}-worktrees/${BRANCH}`;
const sliceWt = (nn: string) => `${storyWt()}--${nn}`;
const storyRuns = () => join(storyWt(), SPEC, "runs/_story");
const sliceRuns = (nn: string) => join(sliceWt(nn), SPEC, `runs/${nn}`);
const tick = async () => {
  h.clock.advance(10_000);
  return h.tick();
};
const refused = (r: CliResult, code: string, doInstead?: string) => {
  expect(r.exit).toBe(3);
  expect(r.value).toMatchObject({ code, ...(doInstead ? { do_instead: doInstead } : {}) });
};
const close = async () => {
  const r = await h.norn("story", "close", "gh-7", "--yes");
  expect(r.exit).toBe(0);
  expect(existsSync(storyWt())).toBe(false);
};
const remoteState = () => h.git(["ls-remote", "origin"]);
const tickUntil = async (ok: () => boolean, n = 12) => {
  for (let i = 0; i < n && !ok(); i++) await tick();
  expect(ok()).toBe(true);
};
type Inbox = { groups: Record<string, Array<{ story: string; slice: string | null; reason?: string }>> };

beforeAll(async () => {
  h = await createHarness();
  expect((await h.norn("init")).exit).toBe(0);
  h.write(join(h.root, ".agents/norn/config.yaml"), CONFIG);
  h.write(join(h.root, ".agents/norn/workflows/mini.yaml"), MINI);
  h.write(join(h.root, ".agents/norn/workflows/slice.yaml"), SLICE);
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn init"]);
  h.git(["push", "-q", "origin", "main"]);
  h.remote.issues = [issue(7, "Add login form")];
  await tickUntil(() => h.state(storyRuns())?.run?.session != null);
  await tick(); // recovery commit of runs/ after the launch
  for (const [nn, title] of [
    ["01-form", "Login form"],
    ["02-list", "User list"],
  ] as const)
    h.write(join(storyWt(), SPEC, `slices/${nn}.md`), `---\nid: gh-7/${nn.slice(0, 2)}\ntitle: ${title}\ndepends_on: []\nstatus: planned\n---\n\nAcceptance: it renders.\n`);
  h.report(storyRuns(), "done", { outcome: "done", handoff: "planned two slices" });
  await tickUntil(() => h.state(sliceRuns("01-form"))?.run?.session != null && h.state(sliceRuns("02-list"))?.run?.session != null);
  // slice 01 reaches its review gate; slice 02 is still running implement
  h.write(join(sliceWt("01-form"), "form.txt"), "form v1\n");
  h.report(sliceRuns("01-form"), "done", { outcome: "done", handoff: "form built" });
  await tickUntil(() => h.state(sliceRuns("01-form"))?.step === "review");
  expect(h.state(sliceRuns("01-form"))).toMatchObject({ step: "review", status: "parked", park: { kind: "gate" } });
  expect(h.state(sliceRuns("02-list"))).toMatchObject({ step: "implement", status: "running" });
});
afterAll(() => h.cleanup());

describe("story reopen refusals (B42)", () => {
  test("a story that is not closed is refused not_closed; nothing changes", async () => {
    const before = remoteState();
    refused(await h.norn("story", "reopen", "gh-7"), "not_closed");
    expect(remoteState()).toBe(before);
    expect(existsSync(sliceWt("02-list"))).toBe(true);
  });

  test("a closed issue is refused: reopen the issue first; nothing changes", async () => {
    await close();
    const i = h.remote.issues.find((x) => x.number === 7);
    if (!i) throw new Error("no issue");
    i.state = "closed";
    const before = remoteState();
    refused(await h.norn("story", "reopen", "gh-7"), "issue_closed", "reopen the issue first");
    i.state = "open";
    expect(remoteState()).toBe(before);
    expect(existsSync(storyWt())).toBe(false);
  });

  test("a unit branch missing from the remote is refused naming the branch; nothing changes", async () => {
    const sha = h.git(["ls-remote", "origin", "refs/heads/gh-7/02-list"]).split("\t")[0] as string;
    h.git(["push", "-q", "origin", ":refs/heads/gh-7/02-list"]);
    const before = remoteState();
    const r = await h.norn("story", "reopen", "gh-7");
    refused(r, "branch_missing");
    expect((r.value as { error: string }).error).toContain("gh-7/02-list");
    expect(remoteState()).toBe(before);
    expect(existsSync(storyWt())).toBe(false);
    h.git(["push", "-q", "origin", `${sha}:refs/heads/gh-7/02-list`]);
  });
});

describe("story reopen (B40, B41, B55)", () => {
  test("without a target a terminal is offered closed stories only; a script is refused with them", async () => {
    const asked = new FakeInteraction(true);
    asked.answers = [null];
    const r = await runChecked(["story", "reopen"], { ...h.deps, interaction: asked });
    refused(r, "cancelled");
    expect(asked.picks.map((p) => p.choices.map((c) => c.value))).toEqual([["gh-7"]]);
    const script = await runChecked(["story", "reopen"], { ...h.deps, interaction: new FakeInteraction(false) });
    expect(script.exit).toBe(2);
    expect(script.value).toMatchObject({ code: "target_required", do_instead: "norn story reopen gh-7" });
  });

  test("restores worktrees and the claim, marks spec.md active in one commit; a running unit comes back stuck (reopened)", async () => {
    h.git(["fetch", "-q", "origin"]);
    const closedAt = h.git(["rev-parse", `origin/${BRANCH}`]);
    const asked = new FakeInteraction(true);
    const r = await runChecked(["story", "reopen"], { ...h.deps, interaction: asked });
    expect(r.exit).toBe(0);
    expect(asked.picks[0]?.preselect).toBe(0);
    expect(r.value).toMatchObject({ story: "gh-7", reopened: true, stuck: ["gh-7/02"] });
    expect(existsSync(storyWt())).toBe(true);
    expect(existsSync(sliceWt("01-form"))).toBe(true);
    expect(existsSync(sliceWt("02-list"))).toBe(true);
    expect(readFileSync(join(sliceWt("01-form"), "form.txt"), "utf8")).toBe("form v1\n");
    expect(JSON.parse(sh(h.root, ["cat-file", "-p", "refs/norn/claims/gh-7"]))).toMatchObject({ holder: "tester@box" });
    expect(h.git(["ls-remote", "origin", "refs/norn/claims/gh-7"])).not.toBe("");
    h.git(["fetch", "-q", "origin"]);
    expect(h.git(["rev-list", "--count", `${closedAt}..origin/${BRANCH}`])).toBe("1");
    expect(h.git(["show", `origin/${BRANCH}:${SPEC}/spec.md`])).toContain("status: active");
    // D4: the person's stuck receipt on the unit that was running
    const files = readdirSync(join(sliceRuns("02-list"), "receipts")).sort();
    const last = JSON.parse(readFileSync(join(sliceRuns("02-list"), "receipts", files.at(-1) as string), "utf8"));
    expect(last).toMatchObject({ kind: "stuck", by: "human", reason: "reopened", step: "implement" });
  });

  test("the next tick resumes the units at their steps; the reopened unit is stuck under Unblock and not started", async () => {
    const launches = h.runner.launches.length;
    await tick();
    await tick();
    expect(h.state(sliceRuns("01-form"))).toMatchObject({ step: "review", status: "parked", park: { kind: "gate" } });
    expect(h.state(sliceRuns("02-list"))).toMatchObject({ step: "implement", status: "stuck", park: { kind: "stuck", reason: "reopened" } });
    expect(h.runner.launches.length).toBe(launches);
    const inbox = (await h.norn("status", "--json")).value as Inbox;
    expect(inbox.groups.unblock).toContainEqual(expect.objectContaining({ story: "gh-7", slice: "gh-7/02" }));
    // slice 01 goes on from its gate
    expect((await h.norn("story", "approve", "gh-7/01")).exit).toBe(0);
    await tickUntil(() => h.state(sliceRuns("01-form"))?.step !== "review");
    // and run rerun resumes slice 02 in a fresh session
    expect((await h.norn("run", "rerun", "gh-7/02")).exit).toBe(0);
    await tickUntil(() => h.state(sliceRuns("02-list"))?.status === "running");
    expect(h.runner.launches.slice(launches).map((l) => l.cwd)).toContain(sliceWt("02-list"));
  });

  test("closing again and reopening from a slice worktree that still exists acts on the story (B55)", async () => {
    // a slice worktree left behind (its marker names the unit); the explicit key works the same way
    const marker = readFileSync(join(sliceWt("02-list"), ".norn-unit"), "utf8");
    await close();
    const left = join(h.dir, "left-behind");
    h.write(join(left, ".norn-unit"), marker);
    const r = await runChecked(["story", "reopen"], { ...h.deps, cwd: left });
    expect(r.exit).toBe(0);
    expect(r.value).toMatchObject({ story: "gh-7", reopened: true });
    expect(existsSync(storyWt())).toBe(true);
  });
});

describe("reopen after the base moved (B40)", () => {
  test("restores the claim and worktrees only; the next ticks go on without error", async () => {
    const at = { story: h.state(storyRuns())?.step, slice: h.state(sliceRuns("02-list"))?.step };
    await close();
    // the base moves on while the story is closed
    const other = join(h.dir, "other");
    sh(h.dir, ["clone", "-q", h.remoteDir, other]);
    sh(other, ["config", "user.email", "o@example.com"]);
    sh(other, ["config", "user.name", "Other"]);
    h.write(join(other, "CHANGES.md"), "moved\n");
    sh(other, ["add", "-A"]);
    sh(other, ["commit", "-q", "-m", "base moves"]);
    sh(other, ["push", "-q", "origin", "main"]);
    const base = sh(other, ["rev-parse", "HEAD"]);
    h.git(["fetch", "-q", "origin"]);
    const before = h.git(["rev-parse", `origin/${BRANCH}`]);
    const r = await h.norn("story", "reopen", "gh-7");
    expect(r.exit).toBe(0);
    h.git(["fetch", "-q", "origin"]);
    // reopen itself does not merge the base
    expect(h.git(["rev-list", "--count", `${before}..origin/${BRANCH}`])).toBe("1");
    expect(Bun.spawnSync(["git", "merge-base", "--is-ancestor", base, "HEAD"], { cwd: storyWt() }).exitCode).toBe(1);
    // the base is merged where the workflow says (a `git: update` step), not by reopen; ticks go on
    for (let i = 0; i < 4; i++) {
      const t = await tick();
      expect(t.decisions.filter((d) => !d.ok)).toEqual([]);
    }
    expect(h.state(storyRuns())?.step).toBe(at.story);
    expect(h.state(sliceRuns("02-list"))).toMatchObject({ step: at.slice, status: "stuck", park: { reason: "reopened" } });
  });
});
