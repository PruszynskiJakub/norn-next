/**
 * The dashboard's break-it switches: each puts the lab's story into the state it names, with one
 * shell line run in the lab through the host's exec, and answers with that line and the real way out.
 *
 * Two of them (corrupt, expired claim) are the one deliberate hand-edit of norn's run state, and only
 * in the lab's own norn home. What they know of where store "local" keeps a unit's state and a
 * story's claim, and where the headless runner keeps a run's process, is read from those plugins'
 * exports and kept in this module alone, so a change of either layout breaks here and nowhere else.
 */
import { type HostContext, parseJson } from "@norn/plugin-api";
import { decodeHandle, type HeadlessHandle, keyRecordPath } from "@norn/runner-headless";
import { shellQuote } from "@norn/runtime";
import { ClaimFile, layout } from "@norn/store-local";
import { Type } from "@sinclair/typebox";
import { locateRepo, machineDir } from "../home.ts";
import { refuse } from "../output.ts";
import type { LabPaths } from "./paths.ts";

export const BREAK_NAMES = ["kill", "fail-check", "move-base", "corrupt", "expire-claim"] as const;
export type BreakName = (typeof BREAK_NAMES)[number];

export const isBreak = (name: string): name is BreakName => (BREAK_NAMES as readonly string[]).includes(name);

/** Who the lab's commits that break things are by, so a person reading `git log` sees whose they are. */
const BREAKER = { name: "norn lab", email: "lab@norn.invalid" };
const BASE = "main";
/** The machine an expired claim is handed to: never this one, as a tick takes back its own expired claim by itself. */
export const OTHER_HOLDER = "another-machine@norn-lab.invalid";
/** How long ago the rewritten claim expired. */
const EXPIRED_AGO_MS = 60_000;
const CLAIM_SPAN_MS = 3_600_000;
export const BREAK_CHECK_MESSAGE = "norn lab: break the check on purpose";
export const MOVE_BASE_MESSAGE = "norn lab: move the base under the story";

/** The toy test the check-failing switch commits: it fails whatever greet.sh prints. */
export const BROKEN_TEST = ["#!/bin/sh", '# broken on purpose by the lab\'s "make the check fail" switch', 'echo "FAIL: the lab broke this test on purpose"', "exit 1"];
/** The base the base-moving switch pushes: the same lines of greet.sh and test.sh the story changes, so merging it conflicts. */
export const MOVED_BASE: Readonly<Record<string, readonly string[]>> = {
  "greet.sh": ["#!/bin/sh", "# the lab's toy app: it prints a greeting", 'echo "hello there"'],
  "test.sh": [
    "#!/bin/sh",
    "# the toy app's test, which the lab's check runs: greet.sh prints the greeting below",
    'want="hello there"',
    'got="$(sh greet.sh)"',
    'if [ "$got" = "$want" ]; then',
    "  echo \"ok: greet.sh prints '$want'\"",
    "else",
    "  echo \"FAIL: greet.sh printed '$got', want '$want'\"",
    "  exit 1",
    "fi",
  ],
};

export interface BreakSpec {
  label: string;
  /** what it runs, before the lab is read for the paths and processes it names */
  preview: string;
}

export const BREAKS: Readonly<Record<BreakName, BreakSpec>> = {
  kill: { label: "Kill the agent", preview: "kill -s KILL -- -<the process group of the running agent>" },
  "fail-check": { label: "Make the check fail", preview: `commit a test.sh that always fails in the story's worktree ("${BREAK_CHECK_MESSAGE}")` },
  "move-base": { label: "Move the base", preview: `commit a conflicting greet.sh and test.sh on ${BASE} and push it to the lab's remote ("${MOVE_BASE_MESSAGE}")` },
  corrupt: { label: "Edit a run-state file", preview: "keep a copy of the unit's state.json in the lab's folder, then write invalid JSON over it" },
  "expire-claim": { label: "Expire the claim", preview: `rewrite the story's claim.json as ${OTHER_HOLDER}'s, expired a minute ago` },
};

/** What a switch runs and the way out of what it does. */
export interface BreakPlan {
  line: string;
  way_out: string;
}

const q = (word: string): string => shellQuote([word]);
const printf = (lines: readonly string[], file: string): string => `printf '%s\\n' ${shellQuote([...lines])} > ${q(file)}`;
const commit = (message: string): string => `git -c user.name=${q(BREAKER.name)} -c user.email=${BREAKER.email} commit -q -m ${q(message)}`;

/** Stops each process group of the run, its agent and every child it started. */
export function killPlan(key: string, groups: readonly HeadlessHandle[]): BreakPlan {
  return {
    line: groups.map((g) => `kill -s KILL -- -${g.pid}`).join("; "),
    way_out: `Nothing to do: the next tick finds the agent's process gone and retries the step in a fresh session (rule \`agent.died.retry\` in \`norn tick\`). Once the step's retries are spent the unit ends stuck, and \`norn run rerun ${key}\` runs it again.`,
  };
}

export function failCheckPlan(key: string, worktree: string): BreakPlan {
  const revert = `git -C ${q(worktree)} revert --no-edit "$(git -C ${q(worktree)} log -1 --format=%H --grep=${q(BREAK_CHECK_MESSAGE)})"`;
  return {
    line: `cd ${q(worktree)} && ${printf(BROKEN_TEST, "test.sh")} && git add test.sh && ${commit(BREAK_CHECK_MESSAGE)}`,
    way_out: `The next check fails and its output goes back to implement as rework, where a real agent fixes the test. The stand-in cannot, so undo the commit in the story's worktree: \`${revert}\`. If the check's counter runs out first, the unit ends stuck: undo the commit, then \`norn run rerun ${key}\`.`,
  };
}

export function moveBasePlan(key: string, repo: string, worktree: string): BreakPlan {
  const writes = Object.entries(MOVED_BASE).map(([file, lines]) => printf(lines, file));
  return {
    line: `cd ${q(repo)} && git checkout -q ${BASE} && ${writes.join(" && ")} && git add ${Object.keys(MOVED_BASE).join(" ")} && ${commit(MOVE_BASE_MESSAGE)} && git push -q origin ${BASE}`,
    way_out: `The base update merges ${BASE} into the story's branch and conflicts, so norn sends the story to its resolve step, where a real agent merges with the norn-merge skill. The stand-in has no beat there and reports stuck. Resolve it as that agent would, in the story's worktree: \`cd ${q(worktree)} && git merge origin/${BASE}\`, keep the story's greeting in greet.sh and test.sh, \`git commit -am "Merge ${BASE}"\`, then \`norn run rerun ${key} --step update\`.`,
  };
}

export function corruptPlan(state: string, backup: string): BreakPlan {
  const dir = backup.slice(0, backup.lastIndexOf("/"));
  return {
    line: `mkdir -p ${q(dir)} && cp ${q(state)} ${q(backup)} && printf '%s\\n' ${q('{"version": "edited by hand')} > ${q(state)}`,
    way_out: `The unit's state no longer validates, so norn shows the unit \`corrupt\` and no tick acts on it, rather than guess: only a person repairs the record. The lab kept the good copy: \`cp ${q(backup)} ${q(state)}\` puts it back, and the next tick goes on.`,
  };
}

/** The claim as another machine's that expired a minute before `now`. */
export function expiredClaim(file: ClaimFile & { claim: NonNullable<ClaimFile["claim"]> }, now: string): ClaimFile {
  const expires = Date.parse(now) - EXPIRED_AGO_MS;
  return { version: file.version, claim: { ...file.claim, holder: OTHER_HOLDER, acquired_at: new Date(expires - CLAIM_SPAN_MS).toISOString(), expires_at: new Date(expires).toISOString() } };
}

export function expireClaimPlan(key: string, claimPath: string, expired: ClaimFile): BreakPlan {
  return {
    line: printf([JSON.stringify(expired)], claimPath),
    way_out: `The story's claim reads as ${OTHER_HOLDER}'s, expired at ${expired.claim?.expires_at}. A tick never takes another machine's claim, even an expired one, since that machine may still be acting on the story: it waits. A person takes it back for this machine with \`norn story take ${key} --force\`, and the next tick carries the story on.`,
  };
}

/** The part of `norn status --json` the switches read: the story's units and their runs. */
const StatusRuns = Type.Object({
  stories: Type.Array(Type.Object({ key: Type.String(), units: Type.Array(Type.Object({ id: Type.String(), kind: Type.Union([Type.String(), Type.Null()]), run: Type.Union([Type.Object({ id: Type.String() }), Type.Null()]) })) })),
});

const KeyRecord = Type.Object({ key: Type.String(), handle: Type.String() });

export interface BreakLab {
  host: HostContext;
  paths: LabPaths;
  self: readonly string[];
  /** the env every child of the lab runs with */
  env: Record<string, string>;
}

const NOT_READY = "wait for the lab's story to get there, or press Reset";

async function exec(lab: BreakLab, argv: string[], cwd: string): Promise<string> {
  const r = await lab.host.exec(argv, { cwd, env: lab.env });
  if (r.code !== 0) throw refuse(`the lab could not read ${argv.slice(0, 3).join(" ")}: ${(r.stderr.trim() || r.stdout.trim()).slice(0, 500)}`, NOT_READY, "lab_not_ready");
  return r.stdout;
}

/** The lab's machine folder, where its store and runners keep their files. */
async function dataDir(lab: BreakLab): Promise<string> {
  return machineDir(lab.paths.home, (await locateRepo(lab.host.exec, lab.paths.repo)).id);
}

/** The worktree the story's branch is checked out in. */
async function worktree(lab: BreakLab, key: string): Promise<string> {
  const out = await exec(lab, ["git", "worktree", "list", "--porcelain"], lab.paths.repo);
  const blocks = out.split(/\n\n+/).map((b) => Object.fromEntries(b.split("\n").map((l) => [l.slice(0, l.indexOf(" ")), l.slice(l.indexOf(" ") + 1)])));
  const found = blocks.find((b) => b.branch === `refs/heads/norn/${key}` && typeof b.worktree === "string");
  if (found === undefined) throw refuse(`${key} has no worktree yet`, NOT_READY, "lab_not_ready");
  return found.worktree as string;
}

/** The live process groups of the agent running the story's step, as the headless runner recorded them. */
async function runGroups(lab: BreakLab, key: string): Promise<HeadlessHandle[]> {
  const out = await exec(lab, [...lab.self, "status", "--json"], lab.paths.repo);
  const status = parseJson(StatusRuns, out, "norn status --json");
  if (!status.ok) throw refuse(`the lab could not read its status: ${status.failure.message}`, NOT_READY, "lab_not_ready");
  const unit = status.value.stories.find((s) => s.key === key)?.units.find((u) => u.id === key);
  const none = refuse(`no agent of ${key} is running`, "press it while a step's agent runs: the Agent session panel shows one", "lab_not_ready");
  if (unit?.run === null || unit?.run === undefined || unit.kind !== "agent") throw none;
  const runId = unit.run.id;
  const ctx = { ...lab.host, repo: { root: lab.paths.repo, dataDir: await dataDir(lab) } };
  const record = keyRecordPath(ctx, runId);
  const dir = record.slice(0, record.lastIndexOf("/"));
  // a resumed session is started under the run's id and a suffix: each is a process of the run
  const names = (await lab.host.files.list(dir)).filter((n) => n === `${runId}.json` || (n.startsWith(`${runId}.`) && n.endsWith(".json")));
  const groups: HeadlessHandle[] = [];
  for (const name of names) {
    const text = await lab.host.files.read(`${dir}/${name}`);
    const rec = text === null ? null : parseJson(KeyRecord, text, name);
    const handle = rec?.ok ? decodeHandle(rec.value.handle) : null;
    if (handle !== null) groups.push(handle);
  }
  const alive = await liveOnly(lab.host, groups);
  if (alive.length === 0) throw none;
  return alive;
}

/** The groups whose leader still runs as the process that was started, so a pid handed out again is never killed. */
async function liveOnly(host: HostContext, groups: HeadlessHandle[]): Promise<HeadlessHandle[]> {
  if (host.alive === undefined) return groups;
  const out: HeadlessHandle[] = [];
  for (const g of groups) if (await host.alive(g.pid, g.started)) out.push(g);
  return out;
}

/** Where the corrupt switch keeps the good copy of a unit's state: the lab's own folder, outside its norn home. */
export const stateBackup = (paths: LabPaths, key: string): string => `${paths.root}/break-it/${key}.state.json`;

/** Reads the lab for what switch `name` names, and plans it; refused when the story is not where it can break that way. */
export async function planBreak(lab: BreakLab, name: BreakName, key: string): Promise<BreakPlan> {
  switch (name) {
    case "kill":
      return killPlan(key, await runGroups(lab, key));
    case "fail-check":
      return failCheckPlan(key, await worktree(lab, key));
    case "move-base":
      return moveBasePlan(key, lab.paths.repo, await worktree(lab, key));
    case "corrupt": {
      const state = layout(await dataDir(lab)).state(key);
      if ((await lab.host.files.read(state)) === null) throw refuse(`${key} has no state yet`, NOT_READY, "lab_not_ready");
      return corruptPlan(state, stateBackup(lab.paths, key));
    }
    case "expire-claim": {
      const path = layout(await dataDir(lab)).claim(key);
      const text = await lab.host.files.read(path);
      const file = text === null ? null : parseJson(ClaimFile, text, path);
      if (file === null || !file.ok || file.value.claim === null) throw refuse(`${key} holds no claim to expire`, NOT_READY, "lab_not_ready");
      return expireClaimPlan(key, path, expiredClaim({ version: file.value.version, claim: file.value.claim }, lab.host.now()));
    }
  }
}
