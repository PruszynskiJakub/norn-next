/**
 * Trace benchmark (gh-107 B1, B2, B10): how `norn cockpit`, `norn status` and `norn brief` fare
 * over a large trace against the same repo with an empty one. Footprint and timing are not asserted
 * in the suite (see the gh-107 spec, Plan); QA runs this.
 *
 * It writes a throwaway repo under $TMPDIR with one story whose unit has a live run, a synthetic
 * trace like the reported one (day files of ~650 KB tick lines, the live run's hook facts in
 * today's file), then measures each command twice: over that trace and with the day files moved away.
 *
 *   bun scripts/trace-bench.ts [--gb 2] [--days 14] [--hooks 420] [--cockpit 60s] [--interval 5s]
 *                              [--status-runs 5] [--norn "<command>"] [--keep]
 *
 * `--norn` defaults to this checkout's `bun packages/cli/src/main.ts` (never run it in a unit
 * worktree: the repo it acts on is the throwaway one). Prints one JSON value: the numbers per case
 * and the ratios full/empty.
 */
import { mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { type HookFact, parseDuration, type UnitState, ulid } from "../packages/schema/src/index.ts";
import { appendReceipt, pinWorkflow, sha256, storyDir, storyFile, storyUnitDir, traceDir, writeState, writeStoryFile, writeUnitMarker } from "../packages/store/src/index.ts";

const ROOT = join(import.meta.dir, "..");
const DAY = 86_400_000;

const { values: a } = parseArgs({
  options: {
    gb: { type: "string", default: "2" },
    days: { type: "string", default: "14" },
    hooks: { type: "string", default: "420" },
    cockpit: { type: "string", default: "60s" },
    interval: { type: "string", default: "5s" },
    "status-runs": { type: "string", default: "5" },
    norn: { type: "string" },
    keep: { type: "boolean", default: false },
  },
});
const norn = a.norn ? a.norn.split(" ") : ["bun", join(ROOT, "packages/cli/src/main.ts")];
const totalBytes = Number(a.gb) * 1024 ** 3;
const nDays = Number(a.days);
const nHooks = Number(a.hooks);

const WF = `name: one
start: implement
steps:
  implement:
    type: agent
    skill: norn-implement
    outcomes: { done: { to: $done, means: "built" } }
`;

const now = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const dir = mkdtempSync(join(tmpdir(), "norn-trace-bench-"));
const repo = join(dir, "repo");
const home = join(dir, "home");
const wt = join(dir, "repo-worktrees", "gh-1-long-step");
mkdirSync(repo, { recursive: true });
mkdirSync(home);
const git = (cwd: string, ...args: string[]) => Bun.spawnSync(["git", ...args], { cwd, stdout: "ignore", stderr: "ignore" });
git(repo, "init", "-q", "-b", "main");
git(repo, "config", "user.email", "bench@example.com");
git(repo, "config", "user.name", "Bench");
writeFileSync(join(repo, "README.md"), "# bench\n");
git(repo, "add", "-A");
git(repo, "commit", "-q", "-m", "init");
git(repo, "worktree", "add", "-q", "-b", "gh-1-long-step", wt);
writeUnitMarker(wt, { repo, story: "gh-1", slice: null, unit: "_story", spec_dir: ".agents/specs/gh-1-long-step" });

// one story, its unit running an agent step that started at the beginning of today's day file
const runStart = Math.max(now - 6 * 3_600_000, Date.parse(iso(now).slice(0, 10)));
const runId = ulid(runStart);
const spec = storyDir(wt, "gh-1", "long-step");
writeStoryFile(
  storyFile(spec),
  { id: "gh-1", slug: "long-step", provider: "gh", number: 1, url: "https://example.com/1", title: "Long step", assignee: null, workflow: "one", status: "active", intake_at: iso(now - nDays * DAY) },
  "\nbench\n",
);
const unit = storyUnitDir(spec);
pinWorkflow(unit, WF);
appendReceipt(unit, { kind: "started", receipt_id: runId, run_id: runId, step: "implement", attempt: 1, at: iso(runStart), by: "agent", how: "auto", agent: "claude", worktree: wt } as Parameters<typeof appendReceipt>[1]);
const state: UnitState = {
  version: 1,
  story: "gh-1",
  slice: null,
  unit_dir: "_story",
  workflow: "one",
  workflow_hash: sha256(WF),
  step: "implement",
  attempt: 1,
  visits: { implement: 1 },
  step_entered_at: iso(runStart),
  status: "running",
  park: null,
  counters: {},
  nudges_used: 0,
  retries_used: 0,
  applied_through: 1,
  run: { run_id: runId, step: "implement", attempt: 1, started_at: iso(runStart), how: "auto", agent: "claude" },
  last_outcome: null,
  created_at: iso(now - nDays * DAY),
  updated_at: iso(runStart),
  last_tick_id: null,
  mode: "auto",
};
writeState(unit, state);

// the trace: each day ~totalBytes/nDays of tick lines whose facts carry the run's hooks (~650 KB a line)
const hooks: HookFact[] = Array.from({ length: nHooks }, (_, i) => ({
  event: "tool_use",
  at: iso(runStart + i * 1000),
  agent: "claude",
  native: "PostToolUse",
  cwd: wt,
  story: "gh-1",
  run_id: runId,
  tool: "Bash",
  input: { command: `echo ${"x".repeat(1200)} ${i}` },
}) as HookFact);
const tdir = traceDir(repo);
mkdirSync(tdir, { recursive: true });
const facts = JSON.stringify({ tick_id: "", now: 0, stories: [{ key: "gh-1", units: [{ run: { hooks } }] }] });
const perDay = totalBytes / nDays;
for (let d = nDays - 1; d >= 0; d--) {
  const day = now - d * DAY;
  const file = join(tdir, `${iso(day).slice(0, 10)}.jsonl`);
  const parts: string[] = [];
  let bytes = 0;
  for (let i = 0; bytes < perDay; i++) {
    const at = Date.parse(iso(day).slice(0, 10)) + i * 60_000;
    const line = `{"type":"tick","tick_id":"${ulid(at)}","at":"${iso(at)}","heartbeat_id":null,"duration_ms":40,"facts":${facts},"decisions":[{"unit":"gh-1","rule":"noop","action":{"kind":"wait"},"result":{"ok":true}}]}\n`;
    parts.push(line);
    bytes += line.length;
    if (parts.length >= 64) {
      writeFileSync(file, parts.join(""), { flag: "a" });
      parts.length = 0;
    }
  }
  if (d === 0) for (const fact of hooks) parts.push(`${JSON.stringify({ type: "hook", id: ulid(Date.parse(fact.at)), fact })}\n`);
  writeFileSync(file, parts.join(""), { flag: "a" });
}

const env = { ...process.env, NORN_HOME_DIR: home, NORN_MACHINE: "bench" } as Record<string, string>;
for (const k of ["NORN_HOME", "NORN_AGENT", "NORN_RUN", "NORN_STORY", "NORN_SLICE", "NORN_AGENT_SESSION_ID"]) delete env[k];

function rssKb(pid: number): number {
  const out = Bun.spawnSync(["ps", "-o", "rss=", "-p", String(pid)]).stdout.toString().trim();
  return Number(out) || 0;
}

async function timed(cwd: string, ...args: string[]): Promise<number> {
  const t = performance.now();
  const p = Bun.spawn([...norn, ...args], { cwd, env, stdout: "ignore", stderr: "ignore" });
  await p.exited;
  return performance.now() - t;
}

/** median wall time of `status --json` over `runs` runs, ms */
async function status(): Promise<number> {
  const ms: number[] = [];
  for (let i = 0; i < Number(a["status-runs"]); i++) ms.push(await timed(repo, "status", "--json"));
  return ms.sort((x, y) => x - y)[Math.floor(ms.length / 2)] as number;
}

/** the cockpit refreshing every `--interval` for `--cockpit`: peak and last RSS (KB), sampled each second */
async function cockpit(): Promise<{ peak_kb: number; last_kb: number; samples: number }> {
  const p = Bun.spawn([...norn, "cockpit", "--interval", a.interval as string], { cwd: repo, env: { ...env, COLUMNS: "160", LINES: "40" }, stdin: "pipe", stdout: "ignore", stderr: "ignore" });
  const end = Date.now() + parseDuration(a.cockpit as string);
  let peak = 0;
  let last = 0;
  let samples = 0;
  while (Date.now() < end) {
    await Bun.sleep(1000);
    last = rssKb(p.pid);
    peak = Math.max(peak, last);
    samples++;
  }
  p.stdin.write("q");
  await p.stdin.end();
  await Promise.race([p.exited, Bun.sleep(5000)]);
  p.kill();
  return { peak_kb: peak, last_kb: last, samples };
}

async function measure() {
  return { status_ms: await status(), brief_ms: await timed(wt, "brief", "--json"), cockpit: await cockpit() };
}

const dayFiles = (d: string) => readdirSync(d).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f));
const traceBytes = dayFiles(tdir).reduce((n, f) => n + Bun.file(join(tdir, f)).size, 0);
const full = await measure();
const away = join(dir, "trace-away");
mkdirSync(away);
for (const f of dayFiles(tdir)) renameSync(join(tdir, f), join(away, f));
const empty = await measure();
for (const f of dayFiles(away)) renameSync(join(away, f), join(tdir, f));

const ratio = (x: number, y: number) => (y ? Math.round((x / y) * 100) / 100 : null);
console.log(
  JSON.stringify(
    {
      repo,
      trace: { days: nDays, bytes: traceBytes, hooks: nHooks },
      full,
      empty,
      ratios: {
        status_ms: ratio(full.status_ms, empty.status_ms),
        brief_ms: ratio(full.brief_ms, empty.brief_ms),
        cockpit_peak_kb: ratio(full.cockpit.peak_kb, empty.cockpit.peak_kb),
      },
    },
    null,
    2,
  ),
);
if (!a.keep) rmSync(dir, { recursive: true, force: true });
