/**
 * Integration harness: a temp git repo cloned from a bare remote, a `~/.norn` home, a fake
 * clock, and fake ports for everything that would leave the machine (RemotePort, RunnerPort,
 * notifiers). Commands run in-process through `runCli` with these injected.
 *
 * Reuse: `const h = await createHarness(); await h.norn("init"); …; h.cleanup()`.
 */
import { setDefaultTimeout } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { type Clock, type InboxItem, type LaunchSpec, type NotifierPort, type PaneState, type PromptKey, type RemoteIssue, type RemoteLabel, type RemotePort, type RemotePullRequest, type RunnerCapabilities, type RunnerPort, type RunnerSessionInfo, nameRemoved, type SessionRef } from "@norn/core";
import { parseSpecDirName, type Receipt, ROUNDS_DIR, STORY_UNIT_DIR, type UnitState, ulid } from "@norn/schema";
import { appendReceipt, bindNornHome, HANDOFF_HEADER_BEGIN, HANDOFF_HEADER_END, HANDOFF_LOG_BEGIN, HANDOFF_LOG_END, installSkills, linkSkills, machineDir, readState, repoConfigPath, handoffPath, runStateDir, spawnSyncCaptured, storyRunStateDir, treeHandoffFile, treeRunStateDir, treeUnitRunStateDir, workflowsDir } from "@norn/store";
import type { ProjectView } from "@norn/view";
import { bundledSkills, type CliDeps, type CliResult, type Interaction, type InteractionChoice, runCli, runningVersion, type TickReport } from "../../packages/cli/src/index.ts";
import { assetsDir } from "../../packages/cli/src/runtime/assets.ts";
import { harvestGolden } from "./golden-harvest.ts";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

// Every tick shells out to git (worktrees, status, refs) several times, so the multi-tick
// integration tests take 2–3.5 s each on an idle laptop — too close to bun's 5 s default on a
// loaded machine or CI runner. Genuinely slow, not hung: give every harness test 20 s.
setDefaultTimeout(20_000);

export class FakeClock implements Clock {
  constructor(public t: number) {}
  now() {
    return this.t;
  }
  iso() {
    return new Date(this.t).toISOString();
  }
  advance(ms: number) {
    this.t += ms;
  }
}

export class FakeRemote implements RemotePort {
  readonly provider = "gh" as const;
  issues: RemoteIssue[] = [];
  prs: RemotePullRequest[] = [];
  /** PR number → body as last written (GR9) */
  bodies = new Map<number, string>();
  calls: string[] = [];
  async whoami() {
    return "tester";
  }
  async listAssignedIssues({ label }: { label: string }) {
    this.calls.push(`list ${label}`);
    return this.issues.filter((i) => i.state === "open" && i.labels.includes(label) && i.assignees.includes("tester"));
  }
  async listLabelledIssues({ label }: { label: string }) {
    this.calls.push(`list* ${label}`);
    return this.issues.filter((i) => i.state === "open" && i.labels.includes(label));
  }
  async assignIssue(n: number, assignee: string) {
    this.calls.push(`assign ${n} ${assignee}`);
    this.issues = this.issues.map((i) => (i.number === n && !i.assignees.includes(assignee) ? { ...i, assignees: [...i.assignees, assignee] } : i));
  }
  async getIssue(n: number) {
    this.calls.push(`issue ${n}`);
    return this.issues.find((i) => i.number === n) ?? null;
  }
  async findPullRequest(branch: string) {
    this.calls.push(`pr? ${branch}`);
    return [...this.prs].reverse().find((p) => p.head === branch) ?? null;
  }
  async openDraftPullRequest(o: { head: string; base: string; title: string; body: string }) {
    this.calls.push(`pr+ ${o.head}`);
    const pr: RemotePullRequest = { number: 100 + this.prs.length, url: `https://github.com/o/r/pull/${100 + this.prs.length}`, state: "open", is_draft: true, head_sha: "", head: o.head, base_branch: o.base, merged_at: null };
    this.prs.push(pr);
    this.bodies.set(pr.number, o.body);
    return pr;
  }
  async editPullRequestBody(n: number, body: string) {
    this.calls.push(`pr~ ${n}`);
    this.bodies.set(n, body);
  }
  /** set → `createIssue` throws it (B22) */
  createError: Error | null = null;
  async createIssue(o: { title: string; body: string; labels: string[]; assignee: string }) {
    this.calls.push(`issue+ ${o.title}`);
    if (this.createError) throw this.createError;
    const number = Math.max(80, ...this.issues.map((i) => i.number)) + 1;
    const created: RemoteIssue = { provider: "gh", number, url: `https://github.com/o/r/issues/${number}`, title: o.title, body: o.body, state: "open", assignees: [o.assignee], labels: [...o.labels], updated_at: new Date(T0).toISOString() };
    this.issues.push(created);
    return created;
  }
  async newIssueUrl(o: { labels: string[] }) {
    this.calls.push(`issue+? ${o.labels.join(",")}`);
    return `https://github.com/o/r/issues/new?labels=${encodeURIComponent(o.labels.join(","))}`;
  }
  async rawFileUrl(o: { commit: string; path: string }) {
    this.calls.push(`raw ${o.commit} ${o.path}`);
    return `https://github.com/o/r/blob/${o.commit}/${o.path.split("/").map(encodeURIComponent).join("/")}?raw=true`;
  }
  /** set → `replaceIssueLabel` throws it, changing nothing (B20) */
  labelError: Error | null = null;
  async replaceIssueLabel(n: number, o: { remove: string; add: string }) {
    this.calls.push(`label ${n} -${o.remove} +${o.add}`);
    if (this.labelError) throw this.labelError;
    this.issues = this.issues.map((i) => (i.number === n ? { ...i, labels: [...i.labels.filter((l) => l !== o.remove && l !== o.add), o.add] } : i));
  }
  /** GR10: the labels defined on the repository */
  labels: RemoteLabel[] = [];
  /** set → `listLabels` throws it (GR10: init, upgrade and doctor report labels not checked) */
  listLabelsError: Error | null = null;
  /** set → `createLabel` throws it, creating nothing (GR10: not created, with the command) */
  createLabelError: Error | null = null;
  async listLabels() {
    this.calls.push("labels?");
    const e = this.listLabelsError ?? this.labelError;
    if (e) throw e;
    return this.labels.map((l) => ({ ...l }));
  }
  async createLabel(l: RemoteLabel) {
    this.calls.push(`label+ ${l.name}`);
    const e = this.createLabelError ?? this.labelError;
    if (e) throw e;
    if (this.labels.some((x) => x.name === l.name)) throw Object.assign(new Error(`label ${l.name} already exists`), { code: "gh_exists", retryable: false });
    this.labels.push({ ...l });
  }
}

export class FakeRunner implements RunnerPort {
  readonly name = "fake";
  /** R4.1: a pane runner by default; tests flip these to model headless or capability-less runners */
  capabilities: RunnerCapabilities = { send: true, resume: true };
  launches: LaunchSpec[] = [];
  /** R8.2: doctor's throwaway session process */
  doctor: ReturnType<typeof Bun.spawn> | null = null;
  sent: Array<{ session: SessionRef; text: string }> = [];
  killed: SessionRef[] = [];
  pane: PaneState = { alive: true, state: "working", since: null };
  /** set → `send` throws it (R4.3) */
  sendError: Error | null = null;
  /** R5.1: sessions `findSessions` reports */
  found: RunnerSessionInfo[] = [];
  /** what `available` answers (doctor tests flip it) */
  availableResult = true;
  async available() {
    return this.availableResult;
  }
  /** R6.2: keystrokes typed into prompts; `keysError` set → `sendKeys` throws it (R6.3) */
  keyed: Array<{ session: SessionRef; keys: PromptKey[] }> = [];
  keysError: Error | null = null;
  async launch(spec: LaunchSpec): Promise<SessionRef> {
    // R8.2: doctor's throwaway session really runs its command (a pane would) — under a PATH a login
    // shell reset (R8.1: the launcher puts this norn first again); it runs until doctor kills it
    if (spec.title === "norn doctor") {
      this.doctor = Bun.spawn(spec.argv, { cwd: spec.cwd, env: { ...process.env, ...spec.env, PATH: "/usr/bin:/bin" }, stdout: "ignore", stderr: "ignore" });
      return { runner: this.name, session_id: "doctor" };
    }
    this.launches.push(spec);
    return { runner: this.name, session_id: `s-${this.launches.length}`, pane_id: `p-${this.launches.length}` };
  }
  async send(session: SessionRef, text: string) {
    if (this.sendError) throw this.sendError;
    this.sent.push({ session, text });
  }
  async sendKeys(session: SessionRef, keys: PromptKey[]) {
    if (this.keysError) throw this.keysError;
    this.keyed.push({ session, keys });
  }
  reach(session: SessionRef) {
    return `fake attach ${session.pane_id ?? session.session_id}`;
  }
  async findSessions() {
    return this.found;
  }
  /** runs once when observe reads the pane — models another writer acting mid-tick (B11) */
  onPaneState: (() => Promise<void>) | null = null;
  async paneState() {
    const hook = this.onPaneState;
    this.onPaneState = null;
    if (hook) await hook();
    return this.pane;
  }
  async isAlive() {
    return this.pane.alive;
  }
  async kill(session: SessionRef) {
    if (session.session_id === "doctor") this.doctor?.kill();
    this.killed.push(session);
  }
}

export class FakeNotifier implements NotifierPort {
  readonly name = "fake";
  items: InboxItem[] = [];
  async notify(item: InboxItem) {
    this.items.push(item);
  }
}

/**
 * D2: the terminal, scripted. `tty: false` is "no TTY"; each `pick` takes the next answer (null = the
 * person left), each `confirm` the next of `confirms` (default N), each `ask` the next of `lines`, each
 * `edit` the next of `edited` (else the text unchanged).
 */
export class FakeInteraction implements Interaction {
  picks: Array<{ question: string; choices: InteractionChoice[]; preselect: number }> = [];
  answers: Array<string | null> = [];
  questions: string[] = [];
  confirms: boolean[] = [];
  asks: string[] = [];
  lines: Array<string | null> = [];
  edits: string[] = [];
  edited: Array<string | null> = [];
  constructor(readonly tty = true) {}
  async confirm(question: string) {
    this.questions.push(question);
    return this.confirms.shift() ?? false;
  }
  async ask(question: string) {
    this.asks.push(question);
    return this.lines.shift() ?? null;
  }
  async edit(text: string) {
    this.edits.push(text);
    const next = this.edited.shift();
    return next === undefined ? text : next;
  }
  async pick(question: string, choices: readonly InteractionChoice[], preselect: number) {
    this.picks.push({ question, choices: [...choices], preselect });
    const next = this.answers.shift();
    return next === undefined ? (choices[preselect]?.value ?? null) : next;
  }
}

/** A6 launch env and the orient env: the env of the agent session a test may run in is not the harness's. */
const AGENT_ENV = ["NORN_HOME", "NORN_STORY", "NORN_SLICE", "NORN_RUN", "NORN_BIN", "NORN_ORIENT", "HERDR_ENV", "HERDR_SOCKET_PATH"];

/**
 * gh-64 (Plan, Risks): runner detection reads HERDR_ENV and PATH, so the harness pins both — no
 * HERDR_ENV, and a PATH without any directory that holds `herdr` — and a machine with Herdr
 * installed gives the same results as CI.
 */
const pathWithoutHerdr = (path: string | undefined) =>
  (path ?? "")
    .split(":")
    .filter((d) => d && !existsSync(join(d, "herdr")))
    .join(":");
export const hostEnv = () => ({ ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !AGENT_ENV.includes(k))), PATH: pathWithoutHerdr(process.env.PATH) });

export function sh(cwd: string, args: string[], input?: string): string {
  // not Bun.spawnSync with pipes: under load it now and then returns exit 0 with an empty stdout (spawnSyncCaptured)
  const r = spawnSyncCaptured(["git", ...args], { cwd, ...(input === undefined ? {} : { stdin: new TextEncoder().encode(input) }) });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")} (${cwd}): ${r.stderr.toString()}`);
  return r.stdout.toString().trim();
}

/** A story or one of its slices in `norn story list --json`. */
export type Listed = ProjectView["stories"][number] | ProjectView["stories"][number]["slices"][number];

export interface Harness {
  dir: string;
  root: string;
  remoteDir: string;
  home: string;
  clock: FakeClock;
  remote: FakeRemote;
  runner: FakeRunner;
  notifier: FakeNotifier;
  deps: CliDeps;
  norn(...argv: string[]): Promise<CliResult>;
  /** a story or slice as `norn story list --json` shows it (B15); undefined when not listed */
  listed(key: string): Promise<Listed | undefined>;
  /** one `norn tick`; throws unless it exits 0. Waits for the `norn check-run`s it started (C5), so the next tick applies their receipts */
  tick(...flags: string[]): Promise<TickReport>;
  /** wait for every `norn check-run` a tick started to end */
  checksDone(): Promise<void>;
  git(args: string[], cwd?: string): string;
  write(path: string, text: string): void;
  /**
   * gh-64: write config the way a person splits it — the team keys (`provider`, `base_branch`,
   * `workflow`, `slice_workflow`) into `.agents/norn.config.yaml`, your keys (`mode`, `agent`,
   * `agents`) into `.agents/norn.config.local.yaml`, machine keys into the user file. A repo file
   * left without keys is removed; the user file is only written, never removed.
   */
  config(yaml: string): void;
  /** gh-61: record the running binary's version as the team file's `norn_version`, keeping its other keys (a repo set up with this norn) */
  recordVersion(): void;
  read(path: string): string;
  state(runsDir: string): UnitState | null;
  /** simulate a reporting verb: append a receipt at the unit's cursor */
  report(runsDir: string, kind: Receipt["kind"], body: Record<string, unknown>, by?: "agent" | "human"): number;
  cleanup(): void;
}

/**
 * Fake time starts in the future: `ulid()` is monotonic per process, so once another test file mints
 * an id from the real clock, ids minted at an earlier fake time carry the real time instead — and
 * anything keyed by an id's day (hook block counts) misses. Ahead of the real clock, fake time wins.
 */
export const T0 = Date.parse("2099-01-15T10:00:00.000Z");

/**
 * B7: no command norn prints names a removed command (B5). Every command a cli suite runs through the
 * harness (`h.norn`, `h.tick`, `runChecked`) is checked here — its stdout (markdown or JSON: inbox items, `do_instead`, briefs, decide
 * details) and stderr — so a printed old verb fails the test that printed it.
 */
export function printsNoRemovedCommand(argv: readonly string[], r: CliResult): CliResult {
  const old = nameRemoved(r.stdout) ?? nameRemoved(r.stderr ?? "");
  if (old) throw new Error(`\`norn ${argv.join(" ")}\` printed the removed command \`${old}\` (B7):\n${r.stdout}${r.stderr ?? ""}`);
  return r;
}

/** `runCli` with the B7 check: what a suite that passes its own deps calls instead. */
export const runChecked = async (argv: string[], deps: CliDeps): Promise<CliResult> => printsNoRemovedCommand(argv, await runCli(argv, deps));

export interface HarnessOptions {
  /** run every command as a norn binary of this version (`X.Y.Z`); default the package version */
  version?: string;
}

export async function createHarness(opts: HarnessOptions = {}): Promise<Harness> {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "norn-cli-")));
  const remoteDir = join(dir, "remote.git");
  const seed = join(dir, "seed");
  const root = join(dir, "repo");
  const home = join(dir, "home");
  mkdirSync(seed);
  mkdirSync(home);
  sh(dir, ["init", "--bare", "-q", "-b", "main", remoteDir]);
  sh(seed, ["init", "-q", "-b", "main"]);
  sh(seed, ["config", "user.email", "t@example.com"]);
  sh(seed, ["config", "user.name", "Tester"]);
  writeFileSync(join(seed, "README.md"), "# app\n");
  sh(seed, ["add", "-A"]);
  sh(seed, ["commit", "-q", "-m", "init"]);
  sh(seed, ["push", "-q", remoteDir, "main"]);
  sh(dir, ["clone", "-q", remoteDir, root]);
  // S12 (gh-195/05): the test names run state in the checkout's machine dir before any command binds it
  bindNornHome(root, home);
  sh(root, ["config", "user.email", "t@example.com"]);
  sh(root, ["config", "user.name", "Tester"]);

  const clock = new FakeClock(T0);
  const remote = new FakeRemote();
  const runner = new FakeRunner();
  const notifier = new FakeNotifier();
  const checks: Promise<void>[] = [];
  const deps: CliDeps = {
    cwd: root,
    onCheckStarted: (exited) => void checks.push(exited),
    env: { ...hostEnv(), NORN_HOME_DIR: home, USER: "tester", NORN_MACHINE: "box", NORN_HOOK_COMMAND: "norn hook" },
    clock,
    ports: { remote, runner, notifiers: [notifier] },
    interaction: null,
    ...(opts.version ? { version: opts.version } : {}),
  };
  const h: Harness = {
    dir,
    root,
    remoteDir,
    home,
    clock,
    remote,
    runner,
    notifier,
    deps,
    norn: async (...argv) => printsNoRemovedCommand(argv, await runCli(argv, deps)),
    async listed(key) {
      const view = (await this.norn("story", "list", "--json")).value as ProjectView;
      return view.stories.flatMap((s): Listed[] => [s, ...s.slices]).find((u) => u.key === key);
    },
    async tick(...flags) {
      const r = printsNoRemovedCommand(["tick", ...flags], await runCli(["tick", ...flags], deps));
      if (r.exit !== 0) throw new Error(`tick failed: ${r.stdout}`);
      await h.checksDone();
      return r.value as TickReport;
    },
    async checksDone() {
      while (checks.length) await checks.shift();
    },
    git: (args, cwd = root) => sh(cwd, args),
    config(yaml) {
      const value = (parseYaml(yaml) ?? {}) as Record<string, unknown>;
      const files: Record<string, Record<string, unknown>> = { team: {}, local: {}, user: {} };
      for (const [k, v] of Object.entries(value)) files[["mode", "agent", "agents"].includes(k) ? "local" : ["max_agents", "notify", "trace"].includes(k) ? "user" : "team"]![k] = v;
      const paths = { team: repoConfigPath(root), local: join(root, ".agents", "norn.config.local.yaml"), user: join(home, "config.yaml") };
      for (const [f, keys] of Object.entries(files) as Array<[keyof typeof paths, Record<string, unknown>]>) {
        if (Object.keys(keys).length) h.write(paths[f], stringifyYaml(keys));
        else if (f !== "user") rmSync(paths[f], { force: true });
      }
    },
    recordVersion() {
      const file = repoConfigPath(root);
      const team = existsSync(file) ? ((parseYaml(readFileSync(file, "utf8")) ?? {}) as Record<string, unknown>) : {};
      h.write(file, stringifyYaml({ ...team, norn_version: runningVersion(deps) }));
    },
    write(path, text) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text);
    },
    read: (path) => readFileSync(path, "utf8"),
    state(runsDir) {
      const r = readState(runsDir);
      return r.ok ? r.value : null;
    },
    report(runsDir, kind, body, by = "agent") {
      const st = h.state(runsDir);
      if (!st) throw new Error(`no state in ${runsDir}`);
      const receipt = { kind, receipt_id: ulid(clock.now()), run_id: st.run?.run_id ?? null, step: st.step, attempt: st.attempt, at: clock.iso(), by, who: by === "agent" ? "claude" : "tester@box", ...body } as Receipt;
      return appendReceipt(runsDir, receipt).n;
    },
    cleanup() {
      // Phase 0.1: `scripts/golden.ts` sets NORN_GOLDEN_OUT to collect this repo's ticks as golden decide cases
      const out = process.env.NORN_GOLDEN_OUT;
      if (out) harvestGolden(dir, root, out, process.env.NORN_GOLDEN_SOURCE ?? "harness");
      rmSync(dir, { recursive: true, force: true });
    },
  };
  return h;
}

/** gh-110 D4: the three layout parts, each with its old place (spelled out: what a person had) and its new one. */
export type LayoutPartName = "config" | "workflows" | "machine files";
export const oldNornDir = (root: string) => join(root, ".agents/norn");
export function layoutPlaces(root: string): Record<LayoutPartName, { old: string; new: string }> {
  return {
    config: { old: join(oldNornDir(root), "config.yaml"), new: repoConfigPath(root) },
    workflows: { old: join(oldNornDir(root), "workflows"), new: workflowsDir(root) },
    "machine files": { old: join(oldNornDir(root), "trace"), new: machineDir(root) },
  };
}

/** S1: a repo on the old layout, built by moving `init`'s files (and the machine dir) back to their old places. */
export function toOldLayout(root: string, parts: LayoutPartName[] = ["config", "workflows", "machine files"]): void {
  const places = layoutPlaces(root);
  for (const p of parts) {
    const { old, new: now } = places[p];
    if (!existsSync(now)) continue;
    mkdirSync(dirname(old), { recursive: true });
    renameSync(now, old);
  }
}

/** The reverse of `toOldLayout`: every part back at its new place, `.agents/norn/` gone. */
export function toNewLayout(root: string): void {
  for (const { old, new: now } of Object.values(layoutPlaces(root))) {
    if (!existsSync(old)) continue;
    mkdirSync(dirname(now), { recursive: true });
    renameSync(old, now);
  }
  rmSync(oldNornDir(root), { recursive: true, force: true });
}

/**
 * gh-195/06 (B34): a unit as an older norn left it: its run state moved from the machine dir back into
 * `<spec folder>/runs/<unit>` in `worktree`, and its handoff from `handoffs/<unit>.md` to
 * `runs/<unit>/handoff.md` under an older norn's generated header and heartbeat blocks (gh-195/07, B8),
 * committed on the worktree's branch with norn's trailers, then pushed to `push` (a remote name) when given.
 * - `flat`: the story's one round folded back into `_story/` itself, the record of a norn before rounds (RD7).
 * - `broken`: a receipt that fails validation committed with it (S2).
 * - `interrupted`: a move that stopped partway, its copy already in the machine dir: `"after copy"`
 *   with runs/ still in the worktree, `"after removal"` with runs/ deleted from the worktree and the
 *   handoff back at `handoffs/<unit>.md` but neither committed (S1).
 */
export function toBranchRunState(
  worktree: string,
  specDir: string,
  unit: string,
  opts: { flat?: boolean; push?: string; broken?: boolean; interrupted?: "after copy" | "after removal" } = {},
): void {
  const key = parseSpecDirName(basename(specDir))?.story;
  if (!key) throw new Error(`not a spec folder: ${specDir}`);
  const story = { key, spec_dir: specDir };
  const machine = unit === STORY_UNIT_DIR ? join(storyRunStateDir(worktree, story), STORY_UNIT_DIR) : runStateDir(worktree, story, unit);
  const tree = treeUnitRunStateDir(worktree, story, unit);
  mkdirSync(tree, { recursive: true });
  const rounds = unit === STORY_UNIT_DIR ? readdirSync(join(machine, ROUNDS_DIR)) : [];
  if (opts.flat) {
    if (rounds.length !== 1) throw new Error(`flat: ${unit} has ${rounds.length} rounds`);
    cpSync(join(machine, ROUNDS_DIR, rounds[0] as string), tree, { recursive: true });
  } else cpSync(machine, tree, { recursive: true });
  const handoff = handoffPath(join(worktree, specDir), unit);
  const prose = existsSync(handoff) ? readFileSync(handoff, "utf8") : null;
  if (prose !== null) {
    writeFileSync(treeHandoffFile(join(worktree, specDir), unit), `${olderNornHandoffBlocks(key, unit)}\n\n${prose}`);
    rmSync(handoff);
  }
  if (opts.broken) {
    const record = opts.flat || unit !== STORY_UNIT_DIR ? tree : join(tree, ROUNDS_DIR, rounds.at(-1) as string);
    mkdirSync(join(record, "receipts"), { recursive: true });
    writeFileSync(join(record, "receipts", "0099-done.json"), "{}\n");
  }
  if (!opts.interrupted) rmSync(machine, { recursive: true, force: true });
  sh(worktree, ["add", "-A"]);
  sh(worktree, ["commit", "-q", "-m", `norn: ${key} run state (older norn)`, "--trailer", `Norn-Story: ${key}`, "--trailer", "Norn-Tick: 01OLDERNORN0000000000000000"]);
  if (opts.push) sh(worktree, ["push", "-q", "--force", opts.push, "HEAD"]);
  if (opts.interrupted === "after removal") {
    rmSync(treeRunStateDir(worktree, story), { recursive: true, force: true });
    if (prose !== null) writeFileSync(handoff, prose);
  }
}

/** The generated header and heartbeat blocks an older norn kept at the top of a unit's handoff (S9, O6; gone since gh-195/07). */
export function olderNornHandoffBlocks(story: string, unit: string): string {
  return [HANDOFF_HEADER_BEGIN, `- Story: ${story} · Unit: ${unit}`, "- Step: implement (attempt 1)", HANDOFF_HEADER_END, HANDOFF_LOG_BEGIN, "- story.start: story at implement", HANDOFF_LOG_END].join("\n");
}

/** What `norn init` does for skills (SK1), for setups that write their own config instead: `.agents/skills/` linked from Claude's folder. */
export function installBundledSkills(root: string): void {
  const names = bundledSkills();
  installSkills(root, join(assetsDir(), "skills"), names);
  linkSkills(root, join(root, ".claude", "skills"), names);
}

export function issue(n: number, title: string, labels: string[] = ["norn"], body = "As a user I want to log in."): RemoteIssue {
  return { provider: "gh", number: n, url: `https://github.com/o/r/issues/${n}`, title, body, state: "open", assignees: ["tester"], labels, updated_at: new Date(T0).toISOString() };
}
