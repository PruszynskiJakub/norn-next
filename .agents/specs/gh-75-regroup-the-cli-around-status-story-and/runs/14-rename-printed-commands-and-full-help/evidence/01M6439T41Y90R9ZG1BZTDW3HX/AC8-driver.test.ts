import { test, expect, setDefaultTimeout } from "bun:test";
import { join } from "node:path";
import { appendFileSync, writeFileSync } from "node:fs";
const W = "/Users/jakubpruszynski/Projects/norn-worktrees/gh-75-regroup-the-cli-around-status-story-and--14-rename-printed-commands-and-full-help/packages/cli/test";
const { createHarness, issue, runChecked } = await import(`${W}/harness.ts`);
setDefaultTimeout(240_000);
const LOG = process.env.QA_LOG!;
const log = (s: string) => appendFileSync(LOG, s + "\n");
const GATED = `name: gated
start: work
steps:
  work:
    type: agent
    skill: norn-implement
    outcomes: { done: { to: review, means: "ready" } }
  review:
    type: gate
    prompt: "Look at it"
    outcomes: { approve: $done, reject: { to: work, counter: loop } }
counters: { loop: { max: 2 } }
`;
const CONFIG = `agents:
  claude: { adapter: claude }
runner: { adapter: headless }
remote: { provider: gh, label: norn }
default_workflow: gated
default_mode: auto
notifiers: []
`;
function split(s: string): string[] {
  const out: string[] = []; let cur = ""; let q: string | null = null; let any = false;
  for (const ch of s) {
    if (q) { if (ch === q) q = null; else cur += ch; continue; }
    if (ch === '"' || ch === "'") { q = ch; any = true; continue; }
    if (ch === " ") { if (cur || any) out.push(cur); cur = ""; any = false; continue; }
    cur += ch;
  }
  if (cur || any) out.push(cur);
  return out;
}
const harvest = (text: string) => [...text.matchAll(/`(norn [^`]+)`/g)].map((m) => m[1]!).concat([...text.matchAll(/"(norn [^"\\]*(?:\\"[^"\\]*)*)"/g)].map((m) => m[1]!.replace(/\\"/g, '"')));

test("AC8 drive", async () => {
  writeFileSync(LOG, "");
  const h = await createHarness();
  const slug: Record<number, string> = { 5: "gh-5-pay-invoices", 6: "gh-6-export-report", 7: "gh-7-sync-ledger", 8: "gh-8-audit-log", 9: "gh-9-dark-mode" };
  const wt = (n: number) => `${h.root}-worktrees/${slug[n]}`;
  const runs = (n: number) => join(wt(n), `.agents/specs/${slug[n]}/runs/_story`);
  expect((await h.norn("init")).exit).toBe(0);
  h.write(join(h.root, ".agents/norn/config.yaml"), CONFIG);
  h.write(join(h.root, ".agents/norn/workflows/gated.yaml"), GATED);
  h.git(["add", "-A"]); h.git(["commit", "-q", "-m", "norn init"]); h.git(["push", "-q", "origin", "main"]);
  h.remote.issues = [issue(5, "Pay invoices"), issue(6, "Export report"), issue(7, "Sync ledger"), issue(8, "Audit log"), issue(9, "Dark mode")];
  for (let i = 0; i < 3; i++) { h.clock.advance(60_000); await h.tick(); }
  const agent = (n: number) => ({ ...h.deps, cwd: wt(n), env: { ...h.deps.env, NORN_AGENT_PID: String(process.pid) } });
  for (const n of [5, 6, 7, 8]) { const b = await runChecked(["brief", "--json"], agent(n)); log(`brief gh-${n} exit ${b.exit}`); }
  h.clock.advance(1000);
  // real agent-protocol verbs from the unit worktree
  const d = await runChecked(["done", "done", "--handoff", "ready"], agent(5)); log(`done exit ${d.exit}\n${d.stdout}`);
  const a = await runChecked(["ask", "CSV only, or CSV and PDF?"], agent(6)); log(`ask exit ${a.exit}\n${a.stdout}`);
  const s = await runChecked(["stuck", "no API key"], agent(7)); log(`stuck exit ${s.exit}\n${s.stdout}`);
  h.clock.advance(1000); await h.tick(); h.clock.advance(1000); await h.tick();
  // gh-8 corrupt
  writeFileSync(join(runs(8), "state.json"), "{ not json");
  h.clock.advance(1000); await h.tick();
  const views: Array<[string, string[]]> = [["status", ["status"]], ["status --json", ["status", "--json"]], ["cockpit", ["status", "--watch", "--json"]]];
  for (const n of [5, 6, 7, 8, 9]) { views.push([`story view gh-${n}`, ["story", "view", `gh-${n}`]]); views.push([`story view gh-${n} --json`, ["story", "view", `gh-${n}`, "--json"]]); }
  const cmds = new Map<string, string>();
  for (const [name, argv] of views) {
    const r = await h.norn(...argv);
    log(`\n===== $ norn ${argv.join(" ")} (exit ${r.exit})\n${r.stdout}`);
    for (const c of harvest(r.stdout)) if (!cmds.has(c)) cmds.set(c, name);
  }
  log(`\n===== harvested ${cmds.size} distinct commands`);
  // paste read-only/ non-decision ones first, then the decisions
  const decision = /story (approve|reject|answer)|run (rerun|cancel)|story (close|handoff|edit|update-branch|checkout|reopen)/;
  const ordered = [...cmds.keys()].filter((c) => !c.endsWith("--web")).sort((x, y) => Number(decision.test(x)) - Number(decision.test(y)) || Number(/reject/.test(y)) - Number(/reject/.test(x)));
  for (const c of ordered) {
    const argv = split(c).slice(1);
    const r = await h.norn(...argv);
    const v = r.value as { error?: string; code?: string };
    log(`\n----- PASTE (from ${cmds.get(c)}): ${c}\nexit ${r.exit}${v?.error ? ` error: ${v.error} code: ${v.code}` : ""}\n${r.stdout.slice(0, 600)}`);
  }
  h.clock.advance(1000); await h.tick(); h.clock.advance(1000); await h.tick();
  const after = await h.norn("story", "list");
  log(`\n===== after paste + 2 ticks: $ norn story list\n${after.stdout}`);
  h.cleanup();
});
