/**
 * Integration harness: a temp git repo cloned from a bare remote, a `~/.norn` home, a fake
 * clock, and fake ports for everything that would leave the machine (RemotePort, RunnerPort,
 * notifiers). Commands run in-process through `runCli` with these injected.
 *
 * Reuse: `const h = await createHarness(); await h.norn("init"); …; h.cleanup()`.
 */
import { setDefaultTimeout } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Clock, InboxItem, LaunchSpec, NotifierPort, PaneState, PromptKey, RemoteIssue, RemotePort, RemotePullRequest, RunnerCapabilities, RunnerPort, RunnerSessionInfo, SessionRef } from "@norn/core";
import { type Receipt, type UnitState, ulid } from "@norn/schema";
import { appendReceipt, readState } from "@norn/store";
import { type CliDeps, type CliResult, runCli, type TickReport } from "../src/index.ts";

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
  calls: string[] = [];
  async whoami() {
    return "tester";
  }
  async listAssignedIssues({ label }: { label: string }) {
    this.calls.push(`list ${label}`);
    return this.issues.filter((i) => i.state === "open" && i.labels.includes(label) && i.assignees.includes("tester"));
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
    const pr: RemotePullRequest = { number: 100 + this.prs.length, url: `https://github.com/o/r/pull/${100 + this.prs.length}`, state: "open", is_draft: true, head_sha: "", draft: true, head: o.head, base: o.base, base_branch: o.base, merged_at: null };
    this.prs.push(pr);
    return pr;
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
  async available() {
    return true;
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

export function sh(cwd: string, args: string[], input?: string): string {
  const r = Bun.spawnSync(["git", ...args], { cwd, stdin: input === undefined ? "ignore" : new TextEncoder().encode(input), stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")} (${cwd}): ${r.stderr.toString()}`);
  return r.stdout.toString().trim();
}

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
  /** one `norn tick`; throws unless it exits 0 */
  tick(...flags: string[]): Promise<TickReport>;
  git(args: string[], cwd?: string): string;
  write(path: string, text: string): void;
  read(path: string): string;
  state(runsDir: string): UnitState | null;
  /** simulate a reporting verb: append a receipt at the unit's cursor */
  report(runsDir: string, kind: Receipt["kind"], body: Record<string, unknown>, by?: "agent" | "human"): number;
  cleanup(): void;
}

/** Fake time starts in the past: `ulid()` is monotonic per process, and other test files mint ids from the real clock. */
export const T0 = Date.parse("2026-01-15T10:00:00.000Z");

export async function createHarness(): Promise<Harness> {
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
  sh(root, ["config", "user.email", "t@example.com"]);
  sh(root, ["config", "user.name", "Tester"]);

  const clock = new FakeClock(T0);
  const remote = new FakeRemote();
  const runner = new FakeRunner();
  const notifier = new FakeNotifier();
  const deps: CliDeps = {
    cwd: root,
    env: { ...process.env, NORN_HOME_DIR: home, USER: "tester", NORN_MACHINE: "box", NORN_HOOK_COMMAND: "norn hook" },
    clock,
    ports: { remote, runner, notifiers: [notifier] },
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
    norn: (...argv) => runCli(argv, deps),
    async tick(...flags) {
      const r = await runCli(["tick", ...flags], deps);
      if (r.exit !== 0) throw new Error(`tick failed: ${r.stdout}`);
      return r.value as TickReport;
    },
    git: (args, cwd = root) => sh(cwd, args),
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
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
  return h;
}

export function issue(n: number, title: string, labels: string[] = ["norn"], body = "As a user I want to log in."): RemoteIssue {
  return { provider: "gh", number: n, url: `https://github.com/o/r/issues/${n}`, title, body, state: "open", assignees: ["tester"], labels, updated_at: new Date(T0).toISOString() };
}
