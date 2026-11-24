/**
 * A person's machine for the `norn lab` integration tests: an own norn home, a repo of theirs and a
 * TMPDIR the lab goes under, with every norn call a subprocess of the binary from source. Each lab
 * suite is a file of its own, so CI runs each alone on a runner (ci.yml's lab job).
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "bun:test";
import { nodeExec } from "@norn/host-node";
import { RUN_ENV } from "@norn/plugin-api";
import { WRITES_ENV } from "@norn/runtime";
import { layout, STORE_DIR } from "@norn/store-local";
import { MAIN, personOnlyBlocked, sh } from "./world.ts";

export const SLOW = 600_000;
export const KEY = "lt-1";
export const NORN_TIMEOUT_MS = 120_000;
/** The real agents and code-host tools a lab must never start: each is shadowed on PATH by a script that logs how it was called. */
const REAL_TOOLS = ["claude", "pi", "gh", "herdr"];

export interface Lab {
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

export interface Out {
  code: number;
  body: Record<string, unknown>;
  stdout: string;
  stderr: string;
}

export interface UnitSeen {
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

export interface StorySeen {
  key: string;
  claim: { holder: string } | null;
  change: { id: number; state: string } | null;
  units: UnitSeen[];
}

export interface LabSeen {
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
export async function machine(): Promise<Lab> {
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

export function parsed(r: { code: number; stdout: string; stderr: string }): Out {
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(r.stdout) as Record<string, unknown>;
  } catch {
    // markdown or nothing: the caller reads stdout
  }
  return { code: r.code, body, stdout: r.stdout, stderr: r.stderr };
}

/** `norn lab` as the person runs it, from their own repo with their own norn home. */
export async function nornLab(l: Lab, ...args: string[]): Promise<LabSeen> {
  const r = parsed(await nodeExec(["bun", MAIN, "lab", ...args, "--json"], { cwd: l.sibling, env: l.env, timeoutMs: NORN_TIMEOUT_MS }));
  if (r.code !== 0) throw new Error(`norn lab ${args.join(" ")} exited ${r.code}: ${r.stdout}${r.stderr}`);
  return r.body as unknown as LabSeen;
}

/** A command in the lab's repo with the lab's norn home, as the lab tells the person to run it. */
export async function inLab(l: Lab, argv: string[]): Promise<Out> {
  return parsed(await nodeExec(argv, { cwd: l.repo, env: { ...l.env, NORN_HOME_DIR: l.home }, timeoutMs: NORN_TIMEOUT_MS }));
}

export const norn = (l: Lab, ...args: string[]) => inLab(l, ["bun", MAIN, ...args]);

export async function story(l: Lab): Promise<StorySeen | undefined> {
  const r = await norn(l, "status", "--json");
  if (r.code !== 0) throw new Error(`status: ${r.stdout}${r.stderr}`);
  return (r.body.stories as StorySeen[]).find((s) => s.key === KEY);
}

/**
 * One `norn tick --json` beside the dashboard's own ticks: the served lab ticks on its own, so a tick
 * that meets its lock (exit 5, `tick_locked`) is tried again rather than read as the tick's report.
 */
export async function tickBeside(l: Lab, maxMs = 60_000): Promise<Out> {
  for (const until = performance.now() + maxMs; ; await Bun.sleep(200)) {
    const t = await norn(l, "tick", "--json");
    if (!(t.code === 5 && t.body.code === "tick_locked") || performance.now() >= until) return t;
  }
}

/** What the play saw: every tick's rules, and the unit after each tick. */
export interface Play {
  rules: string[];
  seen: UnitSeen[];
}

/** `norn tick --json` again and again, as watch does, until `done` holds of the story's unit (and its story). */
export async function tickUntil(l: Lab, play: Play, done: (u: UnitSeen | undefined, s: StorySeen | undefined) => boolean, maxMs = 240_000): Promise<UnitSeen> {
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
export function snapshot(dir: string): Record<string, string> {
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
export function receipts(l: Lab): { kind: string; outcome?: string; findings?: { title: string }[] }[] {
  const repos = join(l.home, "repos");
  const machines = readdirSync(repos).filter((n) => existsSync(join(repos, n, STORE_DIR)));
  expect(machines).toHaveLength(1);
  const dir = layout(join(repos, machines[0] as string)).receipts(KEY);
  return readdirSync(dir)
    .sort()
    .map((f) => (JSON.parse(readFileSync(join(dir, f), "utf8")) as { data: { kind: string; outcome?: string; findings?: { title: string }[] } }).data);
}

/** Each call of a shadowed real tool other than a `--version` probe, as `<tool> <args>`. */
export function calledBeyondVersion(l: Lab): string[] {
  return readdirSync(l.marks).flatMap((tool) =>
    readFileSync(join(l.marks, tool), "utf8")
      .split("\n")
      .filter((args) => args !== "" && args !== "--version")
      .map((args) => `${tool} ${args}`),
  );
}

export const parkedOn = (what: string) => (u: UnitSeen | undefined) => u?.waiting?.for === what;

/** The dashboard's URL, read off what `norn lab` says on stderr; the rest of stderr is drained, so the server never blocks on it. */
export async function dashboardUrl(p: { stderr: ReadableStream<Uint8Array> }, said: string[]): Promise<string> {
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

export interface StateSeen {
  lab: LabSeen;
  graph: { workflow: string; live: string | null; mermaid: string };
  decisions: { rule: string; caption: string }[];
  receipts: { entries: { kind: string }[] };
  needs_you: { unit: string; for: string }[];
  docs: { path: string }[];
  session: { run: string } | null;
  actions: { name: string; command: string }[];
}

export interface Pressed {
  action: string;
  command: string;
  exit: number;
  output: string;
}

/** A switch's answer: a pressed button's, with the way out, or the refusal it met. */
interface Broken extends Pressed {
  way_out: string | null;
}

/** `norn lab` serving its dashboard from the person's repo, with what the page reads and presses. */
export async function served(l: Lab) {
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
export async function statusUntil(l: Lab, what: string, done: (u: UnitSeen | undefined) => boolean, maxMs = 240_000): Promise<UnitSeen> {
  let last: UnitSeen | undefined;
  for (const end = performance.now() + maxMs; performance.now() < end; await Bun.sleep(300)) {
    last = (await story(l))?.units[0];
    if (done(last)) return last as UnitSeen;
  }
  throw new Error(`the lab never got to ${what}; unit: ${JSON.stringify(last)}`);
}

export const alive = (pid: number): boolean => {
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
 * when the kill switch is pressed, and the lab's own commits and ticks never wait. Every exec child
 * leads its own process group, so killing the agent's group leaves a held git running: it exits once
 * its agent is gone (it is reparented), as a real agent's tool dies with it, and never commits behind
 * the retry.
 */
export function holdCommits(l: Lab): { hold: string; held: string } {
  const hold = join(l.dir, "hold-commits");
  const held = join(l.dir, "commit-held");
  const git = Bun.which("git");
  if (git === null) throw new Error("no git on PATH");
  writeFileSync(join(l.dir, "bin", "git"), `#!/bin/sh\nfor a in "$@"; do if [ "$a" = commit ] && [ -n "$${RUN_ENV.run}" ] && [ -e '${hold}' ]; then : > '${held}'; while [ -e '${hold}' ]; do [ "$(ps -o ppid= -p $$ | tr -d ' ')" = "$PPID" ] || exit 137; sleep 0.2; done; fi; done\nexec '${git}' "$@"\n`);
  chmodSync(join(l.dir, "bin", "git"), 0o755);
  return { hold, held };
}
