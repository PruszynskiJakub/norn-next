/**
 * Unit worktrees live in the checkout's machine dir, `<machine dir>/worktrees/`, never in a
 * `<repo>-worktrees/` folder beside the repository: where norn creates them (story at intake, slice
 * at its start), which home and clone they follow, every place that shows the path (`story start`,
 * `--print`, the inbox's start command, the brief's run, the Herdr tab's cwd, `norn status`), and
 * where it finds them again (`norn tidy`'s orphans, `story start`'s gone-check).
 * Paths come from store's `machineDir`/`machineReposDir`, never spelled by hand.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import type { PersonOpenSpec, RunnerPort } from "@norn/core";
import { sliceBranch } from "@norn/schema";
import { checkoutOf, machineDir, machineReposDir, workflowsDir } from "@norn/store";
import type { ProjectView } from "@norn/view";
import type { CliDeps, CliResult, TickReport } from "../../src/index.ts";
import { type Clone, cloneOf } from "../../../../test/support/clone.ts";
import { createHarness, FakeRunner, type Harness, hostEnv, issue, runChecked, sh } from "../../../../test/support/harness.ts";
import { runStateOf } from "../../../../test/support/run-state.ts";

// whole flows over real git, several ticks each
setDefaultTimeout(60_000);

/** Where a unit worktree named `dirName` must be for the checkout at `root`: its machine dir's `worktrees/`. */
const inMachineDir = (root: string, dirName: string) => join(machineDir(root), "worktrees", dirName);
const branchOf = (wt: string) => sh(wt, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
const besideRepo = (root: string) => `${root}-worktrees`;

type InboxItem = { story: string; slice: string | null; command: string; detail?: string; reach?: { worktree: string | null } };
type InboxJson = { groups: Record<string, InboxItem[]> };
const inboxItems = (v: unknown) => Object.values((v as InboxJson).groups).flat();

async function initRepo(h: Harness, config: string, workflows: Record<string, string>): Promise<void> {
  expect((await h.norn("init")).exit).toBe(0);
  h.config(config);
  for (const [name, yaml] of Object.entries(workflows)) h.write(join(workflowsDir(h.root), `${name}.yaml`), yaml);
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn init"]);
  h.git(["push", "-q", "origin", "main"]);
}

const ATTENDED = `name: story
start: refine
steps:
  refine:
    type: agent
    skill: norn-refine
    attended: true
    outcomes: { done: { to: approve, means: "spec written" } }
  approve:
    type: gate
    prompt: "Approve the spec"
    outcomes: { approve: $done, reject: { to: refine, counter: spec_loop } }
counters: { spec_loop: { max: 2 } }
`;

describe("a story worktree in the machine dir: created, shown and found again", () => {
  let h: Harness;
  const DIR = "gh-7-add-login-form";
  const SPEC = `.agents/specs/${DIR}`;
  const wt = () => inMachineDir(h.root, DIR);
  const inWt = (cwd: string, ...argv: string[]): Promise<CliResult> => {
    const env: Record<string, string | undefined> = { ...h.deps.env, NORN_AGENT_PID: String(process.pid) };
    for (const k of ["NORN_AGENT", "NORN_RUN", "NORN_STORY", "NORN_SLICE", "NORN_AGENT_SESSION_ID"]) delete env[k];
    return runChecked(argv, { ...h.deps, cwd, env });
  };

  beforeAll(async () => {
    h = await createHarness();
    await initRepo(h, "provider: gh\nworkflow: story\nmode: manual\n", { story: ATTENDED });
    h.remote.issues = [issue(7, "Add login form", ["norn"])];
    for (let i = 0; i < 3; i++) {
      h.clock.advance(10_000);
      await h.tick();
    }
  });
  afterAll(() => h.cleanup());

  test("the tick creates the story worktree at <machine dir>/worktrees/<story>-<slug> on the story's branch, under the bound home; nothing beside the repo", () => {
    expect(h.worktree(DIR)).toBe(wt());
    expect(existsSync(wt())).toBe(true);
    expect(branchOf(wt())).toBe(DIR);
    // NORN_HOME_DIR binds the home: the worktree follows it as the run state does
    expect(wt().startsWith(`${join(machineReposDir(h.home), checkoutOf(h.root).id)}/`)).toBe(true);
    expect(existsSync(besideRepo(h.root))).toBe(false);
    expect(readdirSync(dirname(h.root)).filter((f) => f.endsWith("-worktrees"))).toEqual([]);
  });

  test("the inbox's start command, story start, --print and the Herdr tab's cwd show the worktree in the machine dir", async () => {
    const start = `cd ${wt()} && claude`;
    const inbox = await h.norn("status", "--json");
    expect((inbox.value as InboxJson).groups.your_turn?.find((i) => i.story === "gh-7")?.command).toStartWith(start);
    const r = await h.norn("story", "start", "gh-7", "--json");
    expect(r.exit).toBe(0);
    expect(r.value).toMatchObject({ unit: "gh-7", worktree: wt(), command: expect.stringContaining(start), opened: false });

    const opened: PersonOpenSpec[] = [];
    h.runner.capabilities = { ...h.runner.capabilities, open: true };
    Object.assign(h.runner, { openForPerson: async (spec: PersonOpenSpec) => (opened.push(spec), { pane_id: "p-9" }) });
    const tab = await h.norn("story", "start", "gh-7", "--json");
    expect(tab.value).toMatchObject({ unit: "gh-7", opened: true });
    expect(opened.map((o) => o.cwd)).toEqual([wt()]);
    const printed = await h.norn("story", "start", "gh-7", "--print", "--json");
    expect(printed.value).toMatchObject({ opened: false, command: expect.stringContaining(start) });
  });

  test("the brief run from the worktree in the machine dir starts the run there", async () => {
    const r = await inWt(wt(), "brief");
    expect(r.exit).toBe(0);
    expect(r.stdout).toStartWith("# norn brief — gh-7 · refine");
    const receipts = join(runStateOf(join(wt(), SPEC)), "receipts");
    const started = readdirSync(receipts).filter((f) => f.endsWith("-started.json")).sort().at(-1) as string;
    expect(JSON.parse(readFileSync(join(receipts, started), "utf8"))).toMatchObject({ kind: "started", worktree: wt() });
  });

  test("a story worktree deleted from the machine dir's worktrees/: story start notices and recreates it", async () => {
    rmSync(wt(), { recursive: true, force: true });
    expect(existsSync(wt())).toBe(false);
    await h.norn("story", "start", "gh-7", "--json");
    expect(existsSync(wt())).toBe(true);
    expect(branchOf(wt())).toBe(DIR);
    expect(existsSync(besideRepo(h.root))).toBe(false);
  });
});

const SLICED = `name: sliced
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
const BUILD = `name: build
start: build
steps:
  build:
    type: agent
    skill: norn-implement
    outcomes: { done: { to: $done, means: "built" } }
`;

describe("a slice worktree beside its story's; norn status shows each unit's worktree", () => {
  let h: Harness;
  const DIR = "gh-2-split-work";
  const SPEC = `.agents/specs/${DIR}`;
  const storyWt = () => inMachineDir(h.root, DIR);
  const sliceWt = () => inMachineDir(h.root, `${DIR}--01-first`);
  const storyRuns = () => runStateOf(join(storyWt(), SPEC));
  const sliceRuns = () => runStateOf(join(sliceWt(), SPEC), "01-first");
  const tick = async () => {
    h.clock.advance(10_000);
    return h.tick();
  };
  const reachOf = async (slice: string | null) => inboxItems((await h.norn("status", "--json")).value).find((i) => i.story === "gh-2" && i.slice === slice)?.reach?.worktree;

  beforeAll(async () => {
    h = await createHarness();
    await initRepo(h, "provider: gh\nworkflow: sliced\nmode: auto\n", { sliced: SLICED, build: BUILD });
    h.remote.issues = [issue(2, "Split work")];
    for (let i = 0; i < 6 && h.state(storyRuns())?.status !== "running"; i++) await tick();
  });
  afterAll(() => h.cleanup());

  test("norn status shows the running story's worktree in the machine dir", async () => {
    expect(h.state(storyRuns())?.status).toBe("running");
    expect(await reachOf(null)).toBe(storyWt());
  });

  test("the slice starts at <machine dir>/worktrees/<story>-<slug>--<nn>-<slug>, beside its story's, on its branch; status shows it", async () => {
    h.write(join(storyWt(), SPEC, "slices/01-first.md"), "---\nid: gh-2/01\ntitle: First part\nworkflow: build\ndepends_on: []\nstatus: planned\n---\n\nAcceptance: it works.\n");
    h.report(storyRuns(), "done", { outcome: "done", handoff: "one slice" });
    for (let i = 0; i < 8 && h.state(sliceRuns())?.status !== "running"; i++) await tick();
    expect(h.state(sliceRuns())?.status).toBe("running");
    expect(existsSync(sliceWt())).toBe(true);
    expect(dirname(sliceWt())).toBe(dirname(storyWt()));
    expect(branchOf(sliceWt())).toBe(sliceBranch("gh-2", "01", "first"));
    expect(await reachOf("gh-2/01")).toBe(sliceWt());
    const view = (await h.norn("story", "list", "--json")).value as ProjectView;
    expect(view.stories.find((s) => s.key === "gh-2")?.root).toBe(storyWt());
    expect(existsSync(besideRepo(h.root))).toBe(false);
  });
});

describe("norn tidy finds orphan worktrees in the machine dir's worktrees/", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
    await initRepo(h, "provider: gh\nworkflow: build\nmode: auto\n", { build: BUILD });
  });
  afterAll(() => h.cleanup());

  test("a clean and a dirty orphan are both reported; tidy removes only the clean one", async () => {
    const clean = inMachineDir(h.root, "gh-97-gone");
    const dirty = inMachineDir(h.root, "gh-96-dirty");
    h.git(["worktree", "add", "-q", "-b", "gh-97-gone", clean, "main"]);
    h.git(["worktree", "add", "-q", "-b", "gh-96-dirty", dirty, "main"]);
    h.write(join(dirty, "README.md"), "# changed\n");

    h.clock.advance(10_000);
    expect((await h.tick("--offline")).orphans?.worktrees).toEqual([dirty, clean]);
    const dry = await h.norn("tidy", "--dry-run");
    expect(dry.value).toMatchObject({ dry_run: true, would_remove: { worktrees: [clean] } });
    expect((dry.value as { kept: unknown[] }).kept).toContainEqual({ item: dirty, reason: "worktree has uncommitted changes" });

    const real = await h.norn("tidy");
    expect(real.exit).toBe(0);
    expect(real.value).toMatchObject({ dry_run: false, removed: { worktrees: [clean] } });
    expect((real.value as { kept: unknown[] }).kept).toContainEqual({ item: dirty, reason: "worktree has uncommitted changes" });
    expect(existsSync(clean)).toBe(false);
    expect(existsSync(dirty)).toBe(true);
  });
});

describe("worktrees follow the clone and its home", () => {
  let h: Harness;
  let B: Clone;
  const DIR = "gh-10-two-places";
  const all = (r: TickReport) => r.decisions.filter((d) => d.kind !== "noop").map((d) => `${d.unit} ${d.rule}${d.ok ? "" : " FAILED"}`);

  beforeAll(async () => {
    h = await createHarness();
    await initRepo(h, "provider: gh\nworkflow: build\nmode: auto\n", { build: BUILD });
    h.remote.issues = [issue(10, "Two places")];
    B = cloneOf(h, "repo-b", "bob");
  });
  afterAll(() => h.cleanup());

  test("two clones of one remote take in the same story: each worktree is in its own clone's machine dir", async () => {
    expect(all(await h.tick())).toContain("gh-10 remote.intake");
    expect(all(await B.tick())).toContain("gh-10 remote.intake");
    const a = inMachineDir(h.root, DIR);
    const b = inMachineDir(B.root, DIR);
    expect(existsSync(a)).toBe(true);
    expect(existsSync(b)).toBe(true);
    expect(a).not.toBe(b);
    expect(a.startsWith(`${machineReposDir(h.home)}/`)).toBe(true);
    expect(b.startsWith(`${machineReposDir(B.home)}/`)).toBe(true);
    expect(existsSync(besideRepo(B.root))).toBe(false);
  });

  test("a home given to the command (the `--home` override, no NORN_HOME_DIR) holds the worktree", async () => {
    const root = join(h.dir, "repo-c");
    sh(h.dir, ["clone", "-q", h.remoteDir, root]);
    sh(root, ["config", "user.email", "carol@example.com"]);
    sh(root, ["config", "user.name", "carol"]);
    const home = join(h.dir, "home-c");
    mkdirSync(home);
    const env: Record<string, string | undefined> = { ...hostEnv(), USER: "carol", NORN_MACHINE: "repo-c", NORN_HOOK_COMMAND: "norn hook" };
    delete env.NORN_HOME_DIR;
    const runner = new FakeRunner();
    const deps: CliDeps = { cwd: root, env, home, clock: h.clock, ports: { remote: h.remote, runner: runner as RunnerPort, notifiers: [] } };
    const r = await runChecked(["tick"], deps);
    expect(r.exit).toBe(0);
    const wt = join(machineReposDir(home), checkoutOf(root).id, "worktrees", DIR);
    expect(existsSync(wt)).toBe(true);
    expect(branchOf(wt)).toBe(DIR);
    expect(existsSync(besideRepo(root))).toBe(false);
  });

  test("a home reached through a symlink: the worktree, a tidy orphan and a lost marker are all found under the resolved path", async () => {
    const root = join(h.dir, "repo-d");
    sh(h.dir, ["clone", "-q", h.remoteDir, root]);
    sh(root, ["config", "user.email", "dan@example.com"]);
    sh(root, ["config", "user.name", "dan"]);
    const real = join(h.dir, "home-d-real");
    mkdirSync(real);
    const link = join(h.dir, "home-d-link");
    symlinkSync(real, link);
    const env: Record<string, string | undefined> = { ...hostEnv(), USER: "dan", NORN_MACHINE: "repo-d", NORN_HOOK_COMMAND: "norn hook" };
    delete env.NORN_HOME_DIR;
    const deps: CliDeps = { cwd: root, env, home: link, clock: h.clock, ports: { remote: h.remote, runner: new FakeRunner() as RunnerPort, notifiers: [] } };
    expect((await runChecked(["tick"], deps)).exit).toBe(0);
    const worktrees = join(machineReposDir(real), checkoutOf(root).id, "worktrees");
    const wt = join(worktrees, DIR);
    expect(branchOf(wt)).toBe(DIR);

    const orphan = join(link, "repos", checkoutOf(root).id, "worktrees", "gh-95-orphan");
    sh(root, ["worktree", "add", "-q", "-b", "gh-95-orphan", orphan, "main"]);
    rmSync(join(wt, ".norn-unit"));
    h.clock.advance(10_000);
    const r = await runChecked(["tick", "--offline"], deps);
    expect(r.exit).toBe(0);
    expect((r.value as TickReport).orphans?.worktrees).toEqual([join(worktrees, "gh-95-orphan")]);
    expect(readFileSync(join(wt, ".norn-unit"), "utf8")).toContain("story=gh-10");
  });
});
