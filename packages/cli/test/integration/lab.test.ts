/**
 * `norn lab` end to end, every norn call a subprocess of the binary from source: the lab builds a
 * throwaway repo under its own TMPDIR, and its story plays the eight beats with the bundled stand-in
 * agent, the person's commands run as a person runs them. Each lab has a TMPDIR of its own, so labs
 * played side by side share nothing.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
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
  corrupt?: string;
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

/** `norn tick --json` again and again, as watch does, until `done` holds of the story's unit (and its story). */
async function tickUntil(l: Lab, play: Play, done: (u: UnitSeen | undefined, s: StorySeen | undefined) => boolean, maxMs = 240_000): Promise<UnitSeen> {
  for (const until = performance.now() + maxMs; performance.now() < until; ) {
    const t = await norn(l, "tick", "--json");
    const outcomes = (t.body.outcomes ?? []) as { decision: { rule: string }; ok: boolean }[];
    play.rules.push(...outcomes.map((o) => `${o.decision.rule}${o.ok ? "" : "!"}`));
    if (t.code !== 0) throw new Error(`tick exited ${t.code}: ${t.stdout}${t.stderr}\nrules: ${play.rules.join(", ")}`);
    const s = await story(l);
    const unit = s?.units[0];
    if (unit !== undefined) play.seen.push(unit);
    if (done(unit, s) && unit !== undefined) return unit;
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

/** The dashboard's URL, read off what `norn lab` says on stderr; the rest of stderr is drained, so the server never blocks on it. */
async function dashboardUrl(p: { stderr: ReadableStream<Uint8Array> }, said: string[]): Promise<string> {
  const reader = p.stderr.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (const until = performance.now() + NORN_TIMEOUT_MS; performance.now() < until; ) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value);
    const url = /http:\/\/127\.0\.0\.1:\d+\//.exec(text)?.[0];
    if (url === undefined) continue;
    void (async () => {
      for (let r = await reader.read(); !r.done; r = await reader.read()) said.push(decoder.decode(r.value));
    })();
    return url;
  }
  throw new Error(`norn lab named no dashboard URL: ${text}`);
}

interface StateSeen {
  lab: LabSeen;
  graph: { workflow: string; live: string | null; mermaid: string };
  decisions: { rule: string; caption: string }[];
  receipts: { entries: { kind: string }[] };
  needs_you: { unit: string; for: string }[];
  docs: { path: string }[];
  session: { run: string } | null;
  actions: { name: string; command: string }[];
}

interface Pressed {
  action: string;
  command: string;
  exit: number;
  output: string;
}

describe("norn lab serves its dashboard", () => {
  test(
    "AC1, AC2, AC8, AC9, AC10: the dashboard is served on 127.0.0.1, a taken port is refused, each button runs its real command in the lab, Reset rebuilds it, and nothing beyond the lab changes",
    async () => {
      const l = await machine();
      const personBefore = snapshot(l.personHome);
      const siblingBefore = snapshot(l.sibling);
      const said: string[] = [];
      const served = Bun.spawn(["bun", MAIN, "lab"], { cwd: l.sibling, env: { ...process.env, ...l.env }, stdout: "pipe", stderr: "pipe" });
      try {
        const url = await dashboardUrl(served, said);
        expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);

        const port = new URL(url).port;
        const taken = await nodeExec(["bun", MAIN, "lab", "--port", port], { cwd: l.sibling, env: l.env, timeoutMs: NORN_TIMEOUT_MS });
        expect(taken.code).toBe(3);
        expect(taken.stdout).toContain("(port_taken)");
        expect(taken.stdout).toContain(port);

        const page = await fetch(url);
        expect(page.status).toBe(200);
        expect(await page.text()).toContain("/api/state");

        const state = async (): Promise<StateSeen | null> => {
          const res = await fetch(`${url}api/state`);
          return res.ok ? ((await res.json()) as StateSeen) : null;
        };
        const until = async (what: string, done: (s: StateSeen) => boolean, maxMs = 240_000): Promise<StateSeen> => {
          let last: StateSeen | null = null;
          for (const end = performance.now() + maxMs; performance.now() < end; await Bun.sleep(500)) {
            last = await state();
            if (last !== null && done(last)) return last;
          }
          throw new Error(`the dashboard never showed ${what}; last: ${JSON.stringify(last?.lab)} ${JSON.stringify(last?.needs_you)}\n${said.join("")}`);
        };
        const press = async (name: string, text?: string): Promise<Pressed> => {
          const res = await fetch(`${url}api/act/${name}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
          expect(res.status).toBe(200);
          return (await res.json()) as Pressed;
        };
        const waits = (what: string) => (s: StateSeen) => s.needs_you.some((n) => n.unit === KEY && n.for === what);

        const asked = await until("the question", waits("answer"));
        expect(asked.graph).toMatchObject({ workflow: "quick", live: "implement" });
        expect(asked.decisions.length).toBeGreaterThan(0);
        expect(asked.session).not.toBeNull();
        expect(await press("answer", "Keep the comma.")).toMatchObject({ action: "answer", command: `norn story answer ${KEY} 'Keep the comma.'`, exit: 0 });

        await until("the ready gate", waits("gate"));
        expect(await press("reject", "Name the greeting in the README too.")).toMatchObject({ command: `norn story reject ${KEY} --reason 'Name the greeting in the README too.'`, exit: 0 });
        // the reject sends the work back through implement; the gate waits again once land.rejected is spent
        for (const end = performance.now() + 240_000; (await story(l))?.units[0]?.counters["land.rejected"]?.value !== 1 && performance.now() < end; ) await Bun.sleep(500);
        const back = await until("the gate again after the reject", waits("gate"));
        expect(back.docs.map((d) => d.path)).toEqual(expect.arrayContaining(["spec.md", "pr.md"]));
        expect(await press("approve")).toMatchObject({ command: `norn story approve ${KEY}`, exit: 0 });

        await until("the merge beat", (s) => s.graph.live === "merge");
        const merged = await press("merge");
        expect(merged).toMatchObject({ command: `git merge --no-ff --no-edit norn/${KEY} && git push -q origin main`, exit: 0 });
        const ended = await until("the story ended", (s) => s.lab.ended === "done");
        expect(ended.receipts.entries.at(-1)?.kind).toBe("state.committed");
        expect(await sh(l.repo, "git", "log", "--format=%s", "main")).toContain("Keep the comma in the greeting");

        // a merged story takes no rerun and no new round: each button still ran its command, and says how it went
        for (const [name, command] of [
          ["rerun", `norn run rerun ${KEY}`],
          ["round", `norn story round ${KEY} --workflow quick`],
        ] as const) {
          const r = await press(name);
          expect(r.command).toBe(command);
          expect(typeof r.exit).toBe("number");
          expect(r.output).not.toBe("");
        }

        expect(snapshot(l.personHome)).toEqual(personBefore);
        expect(snapshot(l.sibling)).toEqual(siblingBefore);
        expect(calledBeyondVersion(l)).toEqual([]);

        const reset = await press("reset");
        expect(reset).toMatchObject({ action: "reset", command: "norn lab --clean", exit: 0 });
        expect(reset.output).toContain("Built a new lab");
        expect(await sh(l.repo, "git", "log", "--format=%s", "main")).not.toContain("Keep the comma in the greeting");
        const again = await until("beat 1 or 2 of the rebuilt lab", (s) => s.lab.story === KEY && s.lab.ended === null && s.lab.beat.n <= 2);
        expect(again.receipts.entries.filter((e) => e.kind === "gate.decided")).toEqual([]);
      } finally {
        served.kill("SIGINT");
        await served.exited;
      }
      expect(served.exitCode).toBe(0);
    },
    SLOW,
  );
});

describe("norn lab --tty plays the tour in the terminal", () => {
  test(
    "AC1, AC2, AC3: Enter at each pause plays the eight beats to done with their captions; each decision prints its exact command, Enter runs it, and one run in another shell moves the tour on without it",
    async () => {
      const l = await machine();
      // `norn` on the person's PATH is this build, so a printed command runs as pasted
      const bin = join(l.dir, "norn-bin");
      mkdirSync(bin);
      writeFileSync(join(bin, "norn"), `#!/bin/sh\nexec bun '${MAIN}' "$@"\n`);
      chmodSync(join(bin, "norn"), 0o755);
      const env = { ...l.env, PATH: `${bin}:${l.env.PATH}` };
      const proc = Bun.spawn(["bun", MAIN, "lab", "--tty", "--json"], { cwd: l.sibling, env, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
      const said: string[] = [];
      const printed: string[] = [];
      const elsewhere: Out[] = [];
      let prompts = 0;
      const decoder = new TextDecoder();
      let partial = "";
      for await (const chunk of proc.stderr) {
        partial += decoder.decode(chunk, { stream: true });
        const lines = partial.split("\n");
        partial = lines.pop() ?? "";
        for (const line of lines) {
          said.push(line);
          if (line.startsWith("    (cd ")) printed.push(line.trim());
          if (line === "Press Enter to go on.") {
            proc.stdin.write("\n");
            proc.stdin.flush();
          }
          // the printed command follows its prompt; the first one, the answer, the person runs in a shell of their own
          if (line.startsWith("    (cd ") && prompts++ > 0) {
            proc.stdin.write("\n");
            proc.stdin.flush();
          } else if (line.startsWith("    (cd ")) elsewhere.push(parsed(await nodeExec(["sh", "-c", line.trim()], { cwd: l.dir, env, timeoutMs: NORN_TIMEOUT_MS })));
        }
      }
      const code = await proc.exited;
      const out = await new Response(proc.stdout).text();
      if (code !== 0) throw new Error(`norn lab --tty exited ${code}: ${out}\n${said.join("\n")}`);
      const lab = JSON.parse(out) as LabSeen;

      expect(lab).toMatchObject({ story: KEY, ended: "done", next: null, beat: { n: 8 } });
      expect(said.filter((s) => s.startsWith("## Beat ")).map((s) => s.slice(0, 9))).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map((n) => `## Beat ${n}`));
      expect(said.some((s) => s.includes("ended `done`"))).toBe(true);
      const where = `(cd ${l.repo} && export NORN_HOME_DIR=${l.home} && `;
      expect(printed).toEqual([
        `${where}norn story answer ${KEY} "Keep the comma.")`,
        `${where}norn story reject ${KEY} --reason "Name the greeting in the README too.")`,
        `${where}norn story approve ${KEY})`,
        `${where}git merge --no-ff --no-edit norn/${KEY} && git push -q origin main)`,
      ]);
      expect(elsewhere.map((r) => r.code)).toEqual([0]);
      expect(said.filter((s) => s === "You ran it: the story moved on.")).toHaveLength(1);
      const end = await story(l);
      expect(end?.units[0]).toMatchObject({ ended: "done", counters: { "land.rejected": { value: 1 } } });
      expect(end?.claim).toBeNull();
      expect(await sh(l.repo, "git", "log", "--format=%s", "main")).toContain("Name the greeting in the README");
      expect(calledBeyondVersion(l)).toEqual([]);
    },
    SLOW,
  );
});

/** A switch's answer: a pressed button's, with the way out, or the refusal it met. */
interface Broken extends Pressed {
  way_out: string | null;
}

/** `norn lab` serving its dashboard from the person's repo, with what the page reads and presses. */
async function served(l: Lab) {
  const said: string[] = [];
  const proc = Bun.spawn(["bun", MAIN, "lab"], { cwd: l.sibling, env: { ...process.env, ...l.env }, stdout: "pipe", stderr: "pipe" });
  const url = await dashboardUrl(proc, said);
  const state = async (): Promise<StateSeen | null> => {
    const res = await fetch(`${url}api/state`);
    return res.ok ? ((await res.json()) as StateSeen) : null;
  };
  const until = async (what: string, done: (s: StateSeen) => boolean, maxMs = 240_000): Promise<StateSeen> => {
    let last: StateSeen | null = null;
    for (const end = performance.now() + maxMs; performance.now() < end; await Bun.sleep(300)) {
      last = await state();
      if (last !== null && done(last)) return last;
    }
    throw new Error(`the dashboard never showed ${what}; last: ${JSON.stringify(last?.lab)} ${JSON.stringify(last?.needs_you)}\n${said.join("")}`);
  };
  const press = async (name: string, text?: string): Promise<Broken> => {
    const res = await fetch(`${url}api/act/${name}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
    const body = (await res.json()) as Broken;
    if (res.status !== 200) throw new Error(`${name} answered ${res.status}: ${JSON.stringify(body)}`);
    return body;
  };
  const stop = async (): Promise<number | null> => {
    proc.kill("SIGINT");
    await proc.exited;
    return proc.exitCode;
  };
  return { url, state, until, press, stop };
}

/** Each unit's status until `done` holds of the story's unit. */
async function statusUntil(l: Lab, what: string, done: (u: UnitSeen | undefined) => boolean, maxMs = 240_000): Promise<UnitSeen> {
  let last: UnitSeen | undefined;
  for (const end = performance.now() + maxMs; performance.now() < end; await Bun.sleep(300)) {
    last = (await story(l))?.units[0];
    if (done(last)) return last as UnitSeen;
  }
  throw new Error(`the lab never got to ${what}; unit: ${JSON.stringify(last)}`);
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/**
 * Holds every `git commit` an agent's run makes (its env names the run) while `hold` exists, saying so
 * in `held`: the stand-in agent commits its work through git on PATH, so its step is still running
 * when the kill switch is pressed, and the lab's own commits and ticks never wait.
 */
function holdCommits(l: Lab): { hold: string; held: string } {
  const hold = join(l.dir, "hold-commits");
  const held = join(l.dir, "commit-held");
  const git = Bun.which("git");
  if (git === null) throw new Error("no git on PATH");
  writeFileSync(join(l.dir, "bin", "git"), `#!/bin/sh\nfor a in "$@"; do if [ "$a" = commit ] && [ -n "$${RUN_ENV.run}" ] && [ -e '${hold}' ]; then : > '${held}'; while [ -e '${hold}' ]; do sleep 0.2; done; fi; done\nexec '${git}' "$@"\n`);
  chmodSync(join(l.dir, "bin", "git"), 0o755);
  return { hold, held };
}

describe("norn lab's break-it switches", () => {
  test(
    "AC1–AC7: each switch on the dashboard produces the state it names, answers with the command it ran and the way out, and changes nothing beyond the lab",
    async () => {
      const [a, b] = await Promise.all([machine(), machine()]);
      const before = [a, b].map((l) => ({ home: snapshot(l.personHome), sibling: snapshot(l.sibling) }));
      const { hold, held } = holdCommits(a);
      writeFileSync(hold, "");
      const [da, db] = await Promise.all([served(a), served(b)]);
      try {
        const playA = async () => {
          // AC1: kill the agent while implement's agent is running, held at its commit
          await da.until("implement's agent running", (s) => s.graph.live === "implement" && existsSync(held));
          const killed = await da.press("kill");
          const pids = [...killed.command.matchAll(/kill -s KILL -- -(\d+)/g)].map((m) => Number(m[1]));
          expect(pids.length).toBeGreaterThan(0);
          expect(killed.exit).toBe(0);
          expect(killed.way_out).toContain("agent.died.retry");
          for (const end = performance.now() + 10_000; pids.some(alive) && performance.now() < end; ) await Bun.sleep(100);
          expect(pids.filter(alive)).toEqual([]);
          rmSync(hold);
          await da.until("a tick finding the agent died", (s) => s.decisions.some((d) => d.rule === "agent.died.retry"));

          // AC5: expire the claim at the question, where nothing else moves the story
          await da.until("the question", (s) => s.needs_you.some((n) => n.unit === KEY && n.for === "answer"));
          const ours = (await story(a))?.claim?.holder;
          expect(ours).toBeDefined();
          const expired = await da.press("expire-claim");
          expect(expired.exit).toBe(0);
          expect(expired.way_out).toContain(`norn story take ${KEY} --force`);
          const stories = (await norn(a, "status", "--json")).body.stories as { key: string; claim: { holder: string; expires_at: string } | null }[];
          const rewritten = stories.find((s) => s.key === KEY)?.claim;
          expect(rewritten?.holder).not.toBe(ours);
          expect(Date.parse(rewritten?.expires_at ?? "")).toBeLessThan(Date.now());
          const tick = await norn(a, "tick", "--json");
          const waits = (tick.body.decisions ?? []) as { rule: string; reason?: string }[];
          expect(waits.find((d) => d.rule === "claim.held_elsewhere")?.reason).toContain("expired");
          const took = await norn(a, "story", "take", KEY, "--force", "--json");
          expect(took).toMatchObject({ code: 0, body: { taken: true, expired: true, holder: ours } });
          expect((await story(a))?.claim?.holder).toBe(ours);

          // AC2: make the check fail, then answer: implement's fix meets a test that fails, and the work loops back
          const failing = await da.press("fail-check");
          expect(failing.exit).toBe(0);
          expect(failing.way_out).toContain("revert");
          expect((await da.press("answer", "Keep the comma.")).exit).toBe(0);
          await statusUntil(a, "a second failed check", (u) => (u?.counters["check.fail"]?.value ?? 0) >= 2);

          // AC4: edit a run-state file: the unit shows corrupt; the way out puts the good copy back
          const corrupt = await da.press("corrupt");
          expect(corrupt.exit).toBe(0);
          expect((await story(a))?.units[0]).toMatchObject({ id: KEY, corrupt: expect.stringContaining("state.json") });
          const restore = /`(cp [^`]+)`/.exec(corrupt.way_out ?? "")?.[1];
          expect(restore).toBeDefined();
          expect((await inLab(a, ["sh", "-c", restore as string])).code).toBe(0);
          expect((await story(a))?.units[0]?.corrupt).toBeUndefined();
        };
        const playB = async () => {
          // AC3: move the base once the story has its worktree; the base update then needs a resolve
          await db.until("implement", (s) => s.graph.live === "implement");
          const moved = await db.press("move-base");
          expect(moved.exit).toBe(0);
          expect(moved.way_out).toContain(`norn run rerun ${KEY} --step update`);
          expect(await sh(b.repo, "git", "ls-remote", "origin", "main")).toContain(await sh(b.repo, "git", "rev-parse", "main"));
          await db.until("the question", (s) => s.needs_you.some((n) => n.unit === KEY && n.for === "answer"));
          expect((await db.press("answer", "Keep the comma.")).exit).toBe(0);
          await statusUntil(b, "the resolve step", (u) => u?.step === "resolve");
        };
        await Promise.all([playA(), playB()]);
      } finally {
        await Promise.all([da.stop(), db.stop()]);
      }
      // AC7: the person's norn home and their repo beside each lab are as they were, and no real tool ran
      for (const [i, l] of [a, b].entries()) {
        expect(snapshot(l.personHome)).toEqual(before[i]?.home ?? {});
        expect(snapshot(l.sibling)).toEqual(before[i]?.sibling ?? {});
        expect(calledBeyondVersion(l)).toEqual([]);
      }
    },
    SLOW,
  );
});
