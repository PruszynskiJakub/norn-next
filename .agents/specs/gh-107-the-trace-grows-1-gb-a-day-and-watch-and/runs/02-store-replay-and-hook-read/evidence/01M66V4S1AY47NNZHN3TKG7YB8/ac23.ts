// Differential scenario through runCli: same steps on base and branch code, normalised record out.
const tree = process.argv[2];
const { createHarness, issue } = await import(`${tree}/packages/cli/test/harness.ts`);
const { runCli } = await import(`${tree}/packages/cli/src/index.ts`);
const { readFileSync, readdirSync, existsSync } = await import("node:fs");
const { join } = await import("node:path");
const DUO = `name: duo
start: implement
steps:
  implement:
    type: agent
    skill: norn-implement
    outcomes: { done: { to: review, means: "every criterion has a passing test" } }
  review:
    type: agent
    skill: norn-review
    outcomes: { approve: $done }
`;
const PAIR = `name: pair
start: refine
steps:
  refine:
    type: agent
    skill: norn-refine
    attended: true
    outcomes: { done: { to: $done, means: "agreed" } }
`;
const CONFIG = `agents:
  claude: { adapter: claude }
remote: { provider: gh, label: norn }
default_workflow: duo
default_mode: manual
notifiers: []
`;
const h = await createHarness();
const log: unknown[] = [];
const rec = (label: string, v: unknown) => log.push({ label, v });
try {
  await h.norn("init");
  h.write(join(h.root, ".agents/norn/config.yaml"), CONFIG);
  h.write(join(h.root, ".agents/norn/workflows/duo.yaml"), DUO);
  h.write(join(h.root, ".agents/norn/workflows/pair.yaml"), PAIR);
  h.git(["add", "-A"]); h.git(["commit", "-q", "-m", "init"]); h.git(["push", "-q", "origin", "main"]);
  h.remote.issues = [issue(9, "Manual thing"), issue(10, "Pair on it", ["norn", "norn:wf:pair"])];
  const wt9 = `${h.root}-worktrees/gh-9-manual-thing`, wt10 = `${h.root}-worktrees/gh-10-pair-on-it`;
  const runs9 = join(wt9, ".agents/specs/gh-9-manual-thing/runs/_story"), runs10 = join(wt10, ".agents/specs/gh-10-pair-on-it/runs/_story");
  const env = () => { const e = { ...h.deps.env, NORN_AGENT_PID: String(process.pid) }; for (const k of ["NORN_AGENT","NORN_RUN","NORN_STORY","NORN_SLICE","NORN_AGENT_SESSION_ID","NORN_RUN_ID","NORN_HOME"]) delete e[k]; return e; };
  const inWt = (cwd: string, ...argv: string[]) => runCli(argv, { ...h.deps, cwd, env: env() });
  const hook = (cwd: string, ev: string, p: Record<string, unknown>) => runCli(["hook", ev], { ...h.deps, cwd, env: env(), stdin: JSON.stringify({ session_id: "sess-x", transcript_path: "/tmp/t.jsonl", cwd, ...p }) });
  const stop = (cwd: string) => hook(cwd, "stop", { hook_event_name: "Stop", stop_hook_active: false });
  const tool = (cwd: string, session_id: string) => hook(cwd, "pre-tool-use", { hook_event_name: "PreToolUse", session_id, tool_name: "Bash", tool_input: { command: "ls" } });
  const tick = async () => { h.clock.advance(10_000); const r = await h.tick(); rec("tick", r.decisions.map((d: any) => [d.unit, d.rule, d.action?.kind])); };
  for (let i = 0; i < 6; i++) await tick();
  rec("state9", h.state(runs9)); rec("state10", h.state(runs10));
  // B10: hook facts of two units, each its own session
  await tool(wt9, "sess-nine"); h.clock.advance(1000);
  await tool(wt10, "sess-ten"); h.clock.advance(1000);
  await tool(wt9, "sess-nine-later"); h.clock.advance(1000);
  for (const [n, wt] of [["9", wt9], ["10", wt10]] as const) {
    const b = await inWt(wt, "brief");
    rec(`brief${n}.exit`, b.exit); rec(`brief${n}.md`, b.stdout);
  }
  const started = (dir: string) => { const f = readdirSync(join(dir, "receipts")).filter((x: string) => x.endsWith("-started.json")).sort().at(-1); return f ? JSON.parse(readFileSync(join(dir, "receipts", f), "utf8")) : null; };
  rec("started9", started(runs9)); rec("started10", started(runs10));
  await tick(); rec("state9b", h.state(runs9)); rec("state10b", h.state(runs10));
  // A4: unattended gh-9 Stop five times; attended gh-10 Stop twice
  for (let i = 0; i < 5; i++) { const r = await stop(wt9); rec(`stop9.${i}`, [r.exit, r.value]); h.clock.advance(500); }
  for (let i = 0; i < 2; i++) { const r = await stop(wt10); rec(`stop10.${i}`, [r.exit, r.value]); }
  await tick(); await tick();
  rec("state9c", h.state(runs9));
  rec("inbox", (await h.norn("inbox", "--json")).stdout);
  rec("done9", (await inWt(wt9, "done", "done", "--handoff", "x")).exit);
  await tick(); await tick();
  rec("state9d", h.state(runs9));
  // why on every recorded tick for gh-9
  rec("why9", (await h.norn("why", "gh-9", "--json")).stdout);
  rec("why10", (await h.norn("why", "gh-10", "--json")).stdout);
  let s = JSON.stringify(log, null, 1);
  s = s.split(h.dir).join("<DIR>").replace(/[0-9A-HJKMNP-TV-Z]{26}/g, "<ULID>").replace(/\b[0-9a-f]{40}\b/g, "<SHA>").replace(/"pid":\s*\d+/g, '"pid":<PID>').replace(/"start(ed)?_?time"?:\s*"[^"]*"/g, '"starttime":<T>');
  console.log(s);
} finally { h.cleanup(); }
