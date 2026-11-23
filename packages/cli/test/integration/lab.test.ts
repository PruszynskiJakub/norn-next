/**
 * `norn lab` end to end, every norn call a subprocess of the binary from source: the lab builds a
 * throwaway repo under its own TMPDIR, and its story plays the eight beats with the bundled stand-in
 * agent, the person's commands run as a person runs them. Each lab has a TMPDIR of its own, so labs
 * played side by side share nothing.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nodeExec } from "@norn/host-node";
import { RUN_ENV } from "@norn/plugin-api";
import { WRITES_ENV } from "@norn/runtime";
import { layout, STORE_DIR } from "@norn/store-local";
import { REPO_LOCAL_FILE } from "../../src/config/paths.ts";
import { MAIN, personOnlyBlocked, sh } from "./world.ts";

const SLOW = 600_000;
const KEY = "lt-1";
const NORN_TIMEOUT_MS = 120_000;
/** The real agents and code-host tools a lab must never start: each is shadowed on PATH by a script that logs how it was called. */
const REAL_TOOLS = ["claude", "pi", "gh", "herdr"];

interface Lab {
  dir: string;
  tmp: string;
  /** the person's own norn home, which the lab must leave as it was */
  personHome: string;
  /** a repo of the person's beside the lab, which the lab must leave as it was */
  sibling: string;
  marks: string;
  env: Record<string, string>;
  root: string;
  repo: string;
  home: string;
}

interface Out {
  code: number;
  body: Record<string, unknown>;
  stdout: string;
  stderr: string;
}

interface UnitSeen {
  id: string;
  step: string | null;
  /** the step's kind: agent, check, gate, or a plugin's */
  kind: string | null;
  ended?: string;
  parked?: string;
  waiting: { for: string; text: string; next?: string } | null;
  counters: Record<string, { value: number; max: number }>;
  run: { executor: string } | null;
}

interface StorySeen {
  key: string;
  claim: { holder: string } | null;
  change: { id: number; state: string } | null;
  units: UnitSeen[];
}

interface LabSeen {
  built: boolean;
  story: string | null;
  root: string;
  repo: string;
  remote: string;
  home: string;
  beat: { n: number; of: number; title: string; caption: string; look: string };
  waiting: { for: string } | null;
  ended: string | null;
  next: string | null;
}

/** A person's machine: an own norn home with a file in it, a repo of theirs, and a TMPDIR the lab goes under. */
async function machine(): Promise<Lab> {
  const blocked = await personOnlyBlocked();
  if (blocked) throw new Error(`the lab's integration test makes a person's calls, which are refused below an agent's session: run it from a shell of your own, or leave it to CI. ${blocked}`);
  // realpath: macOS hands out /var under /private, and git names the canonical path
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "norn-lab-")));
  const tmp = join(dir, "tmp");
  const personHome = join(dir, "person-home");
  const sibling = join(dir, "sibling");
  const marks = join(dir, "marks");
  const bin = join(dir, "bin");
  for (const d of [tmp, personHome, marks, bin]) mkdirSync(d);
  writeFileSync(join(personHome, "holder.json"), '{"keep": "as it is"}\n');
  await sh(dir, "git", "init", "-q", "-b", "main", sibling);
  writeFileSync(join(sibling, "app.txt"), "mine\n");
  await sh(sibling, "git", "add", "-A");
  await sh(sibling, "git", "-c", "user.email=p@p", "-c", "user.name=p", "commit", "-q", "-m", "mine");
  for (const tool of REAL_TOOLS) {
    writeFileSync(join(bin, tool), `#!/bin/sh\necho "$*" >> '${join(marks, tool)}'\nexit 1\n`);
    chmodSync(join(bin, tool), 0o755);
  }
  const env: Record<string, string> = {
    TMPDIR: tmp,
    NORN_HOME_DIR: personHome,
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    HERDR_ENV: "",
    [RUN_ENV.unit]: "",
    [RUN_ENV.run]: "",
    [WRITES_ENV]: "",
    // the person's merge commit needs an identity, which a CI runner may not have
    GIT_AUTHOR_NAME: "p",
    GIT_AUTHOR_EMAIL: "p@p",
    GIT_COMMITTER_NAME: "p",
    GIT_COMMITTER_EMAIL: "p@p",
  };
  const root = join(tmp, "norn-lab");
  return { dir, tmp, personHome, sibling, marks, env, root, repo: join(root, "repo"), home: join(root, "home") };
}

function parsed(r: { code: number; stdout: string; stderr: string }): Out {
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(r.stdout) as Record<string, unknown>;
  } catch {
    // markdown or nothing: the caller reads stdout
  }
  return { code: r.code, body, stdout: r.stdout, stderr: r.stderr };
}

/** `norn lab` as the person runs it, from their own repo with their own norn home. */
async function nornLab(l: Lab, ...args: string[]): Promise<LabSeen> {
  const r = parsed(await nodeExec(["bun", MAIN, "lab", ...args, "--json"], { cwd: l.sibling, env: l.env, timeoutMs: NORN_TIMEOUT_MS }));
  if (r.code !== 0) throw new Error(`norn lab ${args.join(" ")} exited ${r.code}: ${r.stdout}${r.stderr}`);
  return r.body as unknown as LabSeen;
}

/** A command in the lab's repo with the lab's norn home, as the lab tells the person to run it. */
async function inLab(l: Lab, argv: string[]): Promise<Out> {
  return parsed(await nodeExec(argv, { cwd: l.repo, env: { ...l.env, NORN_HOME_DIR: l.home }, timeoutMs: NORN_TIMEOUT_MS }));
}

const norn = (l: Lab, ...args: string[]) => inLab(l, ["bun", MAIN, ...args]);

async function story(l: Lab): Promise<StorySeen | undefined> {
  const r = await norn(l, "status", "--json");
  if (r.code !== 0) throw new Error(`status: ${r.stdout}${r.stderr}`);
  return (r.body.stories as StorySeen[]).find((s) => s.key === KEY);
}

/** What the play saw: every tick's rules, and the unit after each tick. */
interface Play {
  rules: string[];
  seen: UnitSeen[];
}

/** `norn tick --json` again and again, as watch does, until `done` holds of the story's unit. */
async function tickUntil(l: Lab, play: Play, done: (u: UnitSeen | undefined) => boolean, maxMs = 240_000): Promise<UnitSeen> {
  for (const until = performance.now() + maxMs; performance.now() < until; ) {
    const t = await norn(l, "tick", "--json");
    const outcomes = (t.body.outcomes ?? []) as { decision: { rule: string }; ok: boolean }[];
    play.rules.push(...outcomes.map((o) => `${o.decision.rule}${o.ok ? "" : "!"}`));
    if (t.code !== 0) throw new Error(`tick exited ${t.code}: ${t.stdout}${t.stderr}\nrules: ${play.rules.join(", ")}`);
    const unit = (await story(l))?.units[0];
    if (unit !== undefined) play.seen.push(unit);
    if (done(unit) && unit !== undefined) return unit;
    await Bun.sleep(250);
  }
  throw new Error(`the lab did not get there in ${maxMs}ms; rules: ${play.rules.join(", ")}; unit: ${JSON.stringify(play.seen.at(-1))}`);
}

/** Every file under `dir` with its text, for a before-and-after comparison; git's index and logs aside. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string): void => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out[p.slice(dir.length)] = readFileSync(p, "utf8");
    }
  };
  walk(dir);
  return out;
}

/** The receipts of the lab's story, as its local store keeps them. */
function receipts(l: Lab): { kind: string; outcome?: string; findings?: { title: string }[] }[] {
  const repos = join(l.home, "repos");
  const machines = readdirSync(repos).filter((n) => existsSync(join(repos, n, STORE_DIR)));
  expect(machines).toHaveLength(1);
  const dir = layout(join(repos, machines[0] as string)).receipts(KEY);
  return readdirSync(dir)
    .sort()
    .map((f) => (JSON.parse(readFileSync(join(dir, f), "utf8")) as { data: { kind: string; outcome?: string; findings?: { title: string }[] } }).data);
}

/** Each call of a shadowed real tool other than a `--version` probe, as `<tool> <args>`. */
function calledBeyondVersion(l: Lab): string[] {
  return readdirSync(l.marks).flatMap((tool) =>
    readFileSync(join(l.marks, tool), "utf8")
      .split("\n")
      .filter((args) => args !== "" && args !== "--version")
      .map((args) => `${tool} ${args}`),
  );
}

const parkedOn = (what: string) => (u: UnitSeen | undefined) => u?.waiting?.for === what;

describe("norn lab plays its story through eight beats", () => {
  let l: Lab;
  const play: Play = { rules: [], seen: [] };
  let personBefore: Record<string, string>;
  let siblingBefore: { files: Record<string, string>; head: string; status: string };
  let built: LabSeen;
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
    await tickUntil(l, play, (u) => u?.ended !== undefined);
    ended = { story: await story(l), lab: await nornLab(l), log: await sh(l.repo, "git", "log", "--format=%s", "main") };
  }, SLOW);

  test("AC1: norn lab builds a git repo with the toy app and its test, a bare remote and its own norn home, set up for the lab, with a quick story", async () => {
    expect(built).toMatchObject({ built: true, story: KEY, root: l.root, repo: l.repo, home: l.home, beat: { n: 1, of: 8 } });
    expect(readFileSync(join(l.repo, "greet.sh"), "utf8")).toContain('echo "hello"');
    expect(readFileSync(join(l.repo, "test.sh"), "utf8")).toContain("want=");
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

describe("norn lab, side by side and again", () => {
  test(
    "AC11, AC12, AC13: two labs under different TMPDIRs share nothing; --clean starts one again from beat 1; one executor line swaps the stand-in for a real agent",
    async () => {
      const [a, b] = await Promise.all([machine(), machine()]);
      const [la, lb] = await Promise.all([nornLab(a), nornLab(b)]);
      expect(la.root).not.toBe(lb.root);
      expect(la.root.startsWith(a.tmp)).toBe(true);
      expect(lb.root.startsWith(b.tmp)).toBe(true);
      const [ua, ub] = await Promise.all([tickUntil(a, { rules: [], seen: [] }, parkedOn("answer")), tickUntil(b, { rules: [], seen: [] }, parkedOn("answer"))]);
      expect([ua.id, ub.id]).toEqual([KEY, KEY]);
      // each lab's norn home knows its own repo alone
      for (const l of [a, b]) {
        const repos = readdirSync(join(l.home, "repos"));
        expect(repos).toHaveLength(1);
        expect(JSON.stringify(snapshot(join(l.home, "repos", repos[0] as string)))).not.toContain((l === a ? b : a).root);
      }

      const again = await nornLab(a, "--clean");
      expect(again).toMatchObject({ built: true, story: KEY, beat: { n: 1 }, waiting: null });
      expect((await story(a))?.units ?? []).toEqual([]);
      expect(await sh(a.repo, "git", "worktree", "list")).not.toContain(`[norn/${KEY}]`);
      // the other lab is where it was
      expect((await story(b))?.units[0]).toMatchObject({ step: "implement", waiting: { for: "answer" } });

      // the person edits the one line that names the lab's agent
      const file = join(b.repo, REPO_LOCAL_FILE);
      const text = readFileSync(file, "utf8");
      const line = "  lab: { harness: lab, runner: headless }";
      expect(text.split("\n").filter((t) => t.includes("harness"))).toEqual([expect.stringContaining("# the stand-in agent"), line]);
      writeFileSync(file, text.replace(line, "  lab: { harness: claude, runner: headless }"));
      expect((await norn(b, "config", "get", "executors.lab", "--json")).body.value).toEqual({ harness: "claude", runner: "headless" });
      expect(calledBeyondVersion(b)).toEqual([]);
    },
    SLOW,
  );
});
