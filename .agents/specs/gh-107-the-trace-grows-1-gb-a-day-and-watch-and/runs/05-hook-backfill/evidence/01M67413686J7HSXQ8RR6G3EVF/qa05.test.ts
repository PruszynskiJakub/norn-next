import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { appendFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { ulid } from "/Users/jakubpruszynski/Projects/norn-worktrees/gh-107-the-trace-grows-1-gb-a-day-and-watch-and--05-hook-backfill/packages/schema/src/index.ts";
import { setTraceReadObserver, traceDir } from "/Users/jakubpruszynski/Projects/norn-worktrees/gh-107-the-trace-grows-1-gb-a-day-and-watch-and--05-hook-backfill/packages/store/src/index.ts";
import { runCli } from "/Users/jakubpruszynski/Projects/norn-worktrees/gh-107-the-trace-grows-1-gb-a-day-and-watch-and--05-hook-backfill/packages/cli/src/index.ts";
import { createHarness, issue } from "/Users/jakubpruszynski/Projects/norn-worktrees/gh-107-the-trace-grows-1-gb-a-day-and-watch-and--05-hook-backfill/packages/cli/test/harness.ts";
setDefaultTimeout(60_000);
const DUO = `name: duo
start: implement
steps:
  implement:
    type: agent
    skill: norn-implement
    outcomes: { done: { to: $done, means: "x" } }
`;
const CONFIG = `agents:
  claude: { adapter: claude }
remote: { provider: gh, label: norn }
default_workflow: duo
default_mode: manual
notifiers: []
`;
let g: any;
const log: string[] = [];
const L = (s: string) => { log.push(s); console.log(s); };
const wt = () => `${g.root}-worktrees/gh-9-manual-thing`;
const runsDir = () => join(wt(), ".agents/specs/gh-9-manual-thing/runs/_story");
const bf = () => join(traceDir(g.root), "hooks", "backfill.json");
const hf = () => join(traceDir(g.root), "hooks", "gh-9", "_story.jsonl");
const ids = () => existsSync(hf()) ? g.read(hf()).split("\n").filter(Boolean).map((l: string) => JSON.parse(l).id) : [];
async function days(run: () => Promise<unknown>) { const seen: any[] = []; const p = setTraceReadObserver((r: any) => seen.push(r)); try { await run(); } finally { setTraceReadObserver(p); } return [...new Set(seen.filter(r => r.kind === "day").map(r => r.file.split("/").pop()))]; }
const ev = (at: number, story = "gh-9", extra: any = {}) => ({ type: "hook", id: ulid(at), fact: { event: "tool_use", at: new Date(at).toISOString(), agent: "claude", native: "PostToolUse", cwd: wt(), story, tool: "Bash", ...extra } });
const put = (e: any) => appendFileSync(join(traceDir(g.root), `${e.fact.at.slice(0, 10)}.jsonl`), JSON.stringify(e) + "\n");
beforeAll(async () => {
  g = await createHarness();
  await g.norn("init");
  g.write(join(g.root, ".agents/norn/config.yaml"), CONFIG);
  g.write(join(g.root, ".agents/norn/workflows/duo.yaml"), DUO);
  g.git(["add", "-A"]); g.git(["commit", "-q", "-m", "init"]); g.git(["push", "-q", "origin", "main"]);
  g.remote.issues = [issue(9, "Manual thing")];
});
afterAll(() => { Bun.write("/private/tmp/claude-501/-Users-jakubpruszynski-Projects-norn-worktrees-gh-107-the-trace-grows-1-gb-a-day-and-watch-and--05-hook-backfill/09162666-bf72-4727-b99e-9ef9bdfe863b/scratchpad/qa05-probe.log", log.join("\n") + "\n"); g.cleanup(); });
test("probe", async () => {
  for (let i = 0; i < 10 && g.state(runsDir())?.status !== "ready"; i++) { g.clock.advance(10_000); await g.tick(); }
  L("unit status before brief: " + JSON.stringify(g.state(runsDir())?.status));
  L("backfill.json after first ticks: " + g.read(bf()));
  // non-tick commands never write backfill.json
  rmSync(bf());
  await g.norn("inbox", "--json"); await g.norn("status", "--json");
  L("backfill.json exists after inbox+status (expect false): " + existsSync(bf()));
  g.clock.advance(10_000);
  const b = await runCli(["brief", "--json"], { ...g.deps, cwd: wt(), env: { ...g.deps.env, NORN_AGENT_PID: String(process.pid) } });
  const runId = b.value.run_id; L("brief exit " + b.exit + " run " + runId);
  g.clock.advance(10_000); await g.tick();
  const st = g.state(runsDir()); const start = Date.parse(st.run.started_at);
  L("run status " + st.status + " started_at " + st.run.started_at);
  L("backfill.json (run started before this first tick -> AC3 case false): " + g.read(bf()));
  // simulate upgrade: delete backfill.json + hook file; write old-style day lines
  rmSync(bf()); rmSync(hf(), { force: true });
  const mid = Date.parse(new Date(start).toISOString().slice(0, 10) + "T00:00:00.000Z") + 86_400_000;
  const want: string[] = [];
  put(ev(start - 5_000)); // before run start: must NOT be copied
  for (let i = 0; i < 400; i++) { const at = i < 200 ? start + (i + 1) * 60_000 : mid + (i - 200) * 1000; const e = ev(at, "gh-9", { run_id: runId }); want.push(e.id); put(e); if (i === 7) put(e); }
  put(ev(mid + 5, "gh-404")); put(ev(mid + 6, "gh-9", { slice: "gh-9/01" }));
  L("day files: " + readdirSync(traceDir(g.root)).filter(n => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n)).join(","));
  g.clock.t = mid + 400_000;
  const d1 = await days(() => g.tick());
  const got = ids();
  L("UPGRADE TICK opened day files: " + d1.join(","));
  L("hook file lines: " + got.length + ", unique " + new Set(got).size + ", equals the 400 run lines in order: " + (JSON.stringify(got) === JSON.stringify(want)));
  L("backfill.json: " + g.read(bf()));
  g.clock.advance(10_000); const before = g.read(hf());
  const d2 = await days(() => g.tick());
  L("SECOND TICK opened day files: [" + d2.join(",") + "], hook file unchanged: " + (g.read(hf()) === before));
  // interrupted backfill + concurrent hook
  const s = JSON.parse(g.read(bf())).since;
  g.write(bf(), JSON.stringify({ since: s, done: [] }));
  g.write(hf(), want.slice(0, 150).map((id) => JSON.stringify(JSON.parse(before.split("\n").find((l: string) => l.includes(id))))).join("\n") + "\n");
  g.clock.advance(10_000);
  const fired = await runCli(["hook", "post-tool-use"], { ...g.deps, cwd: wt(), env: { ...g.deps.env, NORN_AGENT_PID: String(process.pid) }, stdin: JSON.stringify({ session_id: "s1", cwd: wt(), hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "ls" } }) });
  const mid2 = ids(); L("after crash-sim + live hook: exit " + fired.exit + ", lines " + mid2.length);
  g.clock.advance(10_000); const d3 = await days(() => g.tick());
  const fin = ids();
  L("RESUME TICK opened day files: " + d3.join(",") + "; lines " + fin.length + " unique " + new Set(fin).size + "; set == 400 + live hook: " + (JSON.stringify([...fin].sort()) === JSON.stringify([...want, mid2.at(-1)].sort())));
  L("backfill.json: " + g.read(bf()));
  g.clock.advance(10_000); const d4 = await days(() => g.tick());
  L("NEXT TICK opened day files: [" + d4.join(",") + "] lines " + ids().length);
});
