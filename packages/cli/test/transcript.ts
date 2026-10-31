/**
 * Effect transcripts (refactor Phase 0.2): what a harness scenario did to the world, in order, so a
 * structure-only refactor can show it changed nothing. Per command run through the harness:
 *   - the child processes norn spawned (argv + cwd, via store's `setSpawnObserver`): store's
 *     `spawnBounded` and sync git calls, check commands (`runShell`), `gitRemoteUrl`, adapters'
 *     `bunExec`, the headless runner's launch and doctor's probes. Not observed: the pid probes
 *     (`ps` in store/proc.ts, the process adapter and brief, `lsof` in strays): read-only, and their
 *     argv carries live pids. In the harness the runner/remote ports are fakes, so their spawns never
 *     happen; their calls are recorded below instead.
 *   - every call on the fake ports (RunnerPort, RemotePort, notifiers), in call order,
 *   - the files under any `runs/` dir that appeared, changed or went away (sorted by path, so
 *     numbered receipts read in order), each added or changed one with its content: JSON (receipts,
 *     state.json) as one normalised line, other text as a hash of its normalised text.
 * Machine- and time-specific text is normalised: the harness temp dir → `<dir>`, norn's own temp dirs
 * → `<tmp>/<prefix>-<rand>`, ulids → `<ulid:N>`,
 * full and short git shas → `<sha:N>` / `<short:N>`, 16-hex content hashes → `<hash:N>` (numbered by
 * first sight, so identity survives),
 * ISO timestamps → `<time>`, durations → `<ms>`.
 *
 * Reuse: `const t = recordTranscript(h)` right after `createHarness()`; drive the scenario through
 * `h.norn` / `h.tick` (or `t.command(label, fn)` for another clone); then `expectTranscript(t, name)`.
 * `NORN_TRANSCRIPT_UPDATE=1 bun test <file>` rewrites `test/transcripts/<name>.txt`.
 */
import { expect } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import type { NotifierPort, RemotePort, RunnerPort } from "@norn/core";
import { setSpawnObserver, machineDir } from "@norn/store";
import type { CliResult } from "../src/index.ts";
import { normaliser } from "./golden-harvest.ts";
import type { Harness } from "./harness.ts";

export interface Transcript {
  /** bracket one command: header line, then its effects, then the runs/ files it touched */
  command<T>(label: string, fn: () => Promise<T>): Promise<T>;
  /** watch another clone: its runs/ files (under `root` and `<root>-worktrees`) and its fake ports, under a name (`B`) */
  watchClone(name: string, root: string, ports: { runner?: RunnerPort; remote?: RemotePort; notifiers?: NotifierPort[] }): void;
  /** the normalised transcript so far */
  text(): string;
  /** turn the spawn observer off; idempotent */
  stop(): void;
}

/** Port methods recorded, with how their arguments are summarised. */
const RUNNER_CALLS: Record<string, (...a: never[]) => string> = {
  launch: (spec: { title?: string; cwd: string; argv: string[]; env?: Record<string, string> }) =>
    `launch title=${JSON.stringify(spec.title ?? "")} cwd=${spec.cwd} argv=${JSON.stringify(spec.argv)} env=${JSON.stringify(Object.fromEntries(Object.entries(spec.env ?? {}).filter(([k]) => k.startsWith("NORN_")).sort()))}`,
  send: (s: { session_id: string }, text: string) => `send ${s.session_id} ${JSON.stringify(text)}`,
  sendKeys: (s: { session_id: string }, keys: unknown) => `sendKeys ${s.session_id} ${JSON.stringify(keys)}`,
  kill: (s: { session_id: string }) => `kill ${s.session_id}`,
  findSessions: () => "findSessions",
  paneState: (s: { session_id: string }) => `paneState ${s?.session_id ?? ""}`,
  isAlive: (s: { session_id: string }) => `isAlive ${s?.session_id ?? ""}`,
};
const REMOTE_CALLS: Record<string, (...a: never[]) => string> = {
  listAssignedIssues: (o: { label: string }) => `listAssignedIssues ${o.label}`,
  getIssue: (n: number) => `getIssue ${n}`,
  findPullRequest: (branch: string) => `findPullRequest ${branch}`,
  openDraftPullRequest: (o: { head: string; base: string; title: string }) => `openDraftPullRequest ${o.head} → ${o.base} ${JSON.stringify(o.title)}`,
  editPullRequestBody: (n: number) => `editPullRequestBody ${n}`,
  createIssue: (o: { title: string; labels: string[] }) => `createIssue ${JSON.stringify(o.title)} ${o.labels.join(",")}`,
  newIssueUrl: (o: { labels: string[] }) => `newIssueUrl ${o.labels.join(",")}`,
};
const NOTIFIER_CALLS: Record<string, (...a: never[]) => string> = {
  notify: (item: { id: string }) => `notify ${item.id}`,
};

const ULID = /\b[0-9A-HJKMNP-TV-Z]{26}\b/g;
const SHA = /\b[0-9a-f]{40}\b/g;
/** content hashes (the launch script's file name) */
const HASH = /\b[0-9a-f]{16}\b/g;
const ISO = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g;

/** Number each distinct match of `re` by first sight. */
function numberer(re: RegExp, tag: string): (text: string) => string {
  const seen = new Map<string, number>();
  return (text) =>
    text.replace(re, (m) => {
      let n = seen.get(m);
      if (n === undefined) seen.set(m, (n = seen.size + 1));
      return `<${tag}:${n}>`;
    });
}

/** Every file under a `runs/` dir below each of `tops` (skipping `.git` and the trace dir), keyed by its path relative to `dir`, with its content. */
function runsFiles(dir: string, tops: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  const traces = new Set(tops.map((top) => machineDir(top)));
  const walk = (d: string, inRuns: boolean) => {
    let names: string[];
    try {
      names = readdirSync(d);
    } catch {
      return;
    }
    for (const name of names) {
      if (name === ".git" || name === "node_modules") continue;
      const p = join(d, name);
      // the trace dir holds read-only caches (base/<tree>/ copies of the record), not records norn wrote
      if (traces.has(p)) continue;
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(p, inRuns || name === "runs");
      else if (inRuns) out.set(relative(dir, p), readFileSync(p, "utf8"));
    }
  };
  for (const top of tops) walk(top, false);
  return out;
}

/**
 * One normaliser for a harness run (also used by the observe snapshots, Phase 0.3): the harness dir
 * → `<dir>`, norn's temp dirs → `<tmp>/<prefix>-<rand>`, ulids/shas/hashes numbered by first sight,
 * ISO times → `<time>`, `duration_ms` → `<ms>`. Numbering is per normaliser.
 */
export function textNormaliser(dir: string): (text: string) => string {
  const dirNorm = normaliser(dir);
  const sha = numberer(SHA, "sha");
  const ulid = numberer(ULID, "ulid");
  const hash = numberer(HASH, "hash");
  // short shas only once their full sha has been seen: a bare 7–12 hex word may be anything
  const fullShas = new Set<string>();
  const shorts = new Map<string, string>();
  // norn's own temp dirs (mkdtemp under the OS temp dir, either spelling): `<tmp>/norn-record-<rand>`
  const tmp = [...new Set([tmpdir(), realpathSync(tmpdir()), tmpdir().replace(/^\/private\//, "/")])].map((d) => d.replace(/\/$/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const tmpRe = new RegExp(`(?:${tmp.join("|")})/([\\w.-]*-)[A-Za-z0-9]{6}\\b`, "g");
  return (text: string): string => {
    let t = dirNorm(text).replace(tmpRe, "<tmp>/$1<rand>");
    for (const m of t.match(SHA) ?? []) fullShas.add(m);
    t = t.replace(/\b[0-9a-f]{7,12}\b/g, (m) => {
      if (shorts.has(m)) return shorts.get(m) as string;
      for (const full of fullShas) if (full.startsWith(m)) {
        const tag = `<short:${shorts.size + 1}>`;
        shorts.set(m, tag);
        return tag;
      }
      return m;
    });
    return hash(ulid(sha(t))).replace(ISO, "<time>").replace(/"duration_ms":\s*[\d.]+/g, '"duration_ms":<ms>');
  };
}

export function recordTranscript(h: Harness): Transcript {
  const lines: string[] = [];
  const norm = textNormaliser(h.dir);
  const log = (line: string) => lines.push(norm(line));
  /**
   * A runs/ file that appeared or changed, with what it now holds, so a change in a receipt's or
   * state.json's fields shows up in the diff and not only a change in their names: JSON as one
   * normalised line, other text (handoff.md, workflow.yaml, logs) as a hash of its normalised text.
   */
  const logFile = (mark: "+" | "~", p: string, content: string) => {
    log(`  ${mark} ${p}`);
    if (p.endsWith(".json")) {
      let compact: string;
      try {
        compact = JSON.stringify(JSON.parse(content));
      } catch {
        compact = content.replace(/\s+/g, " ");
      }
      log(`      ${compact}`);
    } else {
      const text = norm(content);
      lines.push(`      text ${text.split("\n").length} lines, normalised sha256 ${createHash("sha256").update(text).digest("hex").slice(0, 12)}`);
    }
  };

  let stopped = false;
  let inCommand = false;
  let lastOutside = false;
  setSpawnObserver(({ argv, cwd }) => {
    if (stopped) return;
    // a spawn the test's own code caused (e.g. `runCli` called directly), not one of a bracketed command
    if (!inCommand && !lastOutside) log("> (outside a command)");
    lastOutside = !inCommand;
    const at = cwd === undefined ? "?" : cwd === h.dir || cwd.startsWith(`${h.dir}/`) ? relative(h.dir, cwd) || "." : cwd;
    log(`  spawn ${at} $ ${argv.map((a) => (/^[\w./@:=+,-]+$/.test(a) ? a : JSON.stringify(a))).join(" ")}`);
  });

  const patch = (who: string, obj: object | undefined, calls: Record<string, (...a: never[]) => string>) => {
    if (!obj) return;
    const o = obj as Record<string, unknown>;
    for (const [name, show] of Object.entries(calls)) {
      const orig = o[name];
      if (typeof orig !== "function") continue;
      o[name] = (...args: never[]) => {
        log(`  ${who}.${show(...args)}`);
        return (orig as (...a: unknown[]) => unknown).apply(obj, args);
      };
    }
  };
  type Ports = Parameters<Transcript["watchClone"]>[2];
  const watchPorts = (name: string, ports: Ports) => {
    patch(`${name}.runner`, ports.runner, RUNNER_CALLS);
    patch(`${name}.remote`, ports.remote, REMOTE_CALLS);
    for (const n of ports.notifiers ?? []) patch(`${name}.notifier`, n, NOTIFIER_CALLS);
  };
  const tops: string[] = [];
  const watchClone: Transcript["watchClone"] = (name, root, ports) => {
    tops.push(root, `${root}-worktrees`);
    watchPorts(name, ports);
  };
  watchClone("A", h.root, { runner: h.runner, remote: h.remote, notifiers: [h.notifier] });

  const command: Transcript["command"] = async (label, fn) => {
    // files the test itself wrote since the last command (a simulated receipt) are not this command's
    const before = runsFiles(h.dir, tops);
    log(`> ${label}`);
    inCommand = true;
    lastOutside = false;
    try {
      return await fn();
    } finally {
      inCommand = false;
      const after = runsFiles(h.dir, tops);
      for (const p of [...new Set([...before.keys(), ...after.keys()])].sort()) {
        const was = before.get(p);
        const now = after.get(p);
        if (was === undefined) logFile("+", p, now as string);
        else if (now === undefined) log(`  - ${p}`);
        else if (was !== now) logFile("~", p, now);
      }
    }
  };

  const norn = h.norn;
  const tick = h.tick;
  h.norn = (...argv: string[]): Promise<CliResult> =>
    command(`norn ${argv.join(" ")}`, async () => {
      const r = await norn(...argv);
      log(`  exit ${r.exit}`);
      return r;
    });
  h.tick = (...flags: string[]) => command(["norn tick", ...flags].join(" "), () => tick(...flags));

  return {
    command,
    watchClone,
    text: () => `${lines.join("\n")}\n`,
    stop() {
      if (stopped) return;
      stopped = true;
      setSpawnObserver(null);
    },
  };
}

/** Compare with `test/transcripts/<name>.txt`; `NORN_TRANSCRIPT_UPDATE=1` writes it instead. */
export function expectTranscript(t: Transcript, name: string): void {
  t.stop();
  const file = join(import.meta.dir, "transcripts", `${name}.txt`);
  const actual = t.text();
  if (process.env.NORN_TRANSCRIPT_UPDATE === "1") {
    writeFileSync(file, actual);
    return;
  }
  if (!existsSync(file)) throw new Error(`no transcript ${file}: run NORN_TRANSCRIPT_UPDATE=1 bun test on this file and review it`);
  expect(actual).toBe(readFileSync(file, "utf8"));
}
