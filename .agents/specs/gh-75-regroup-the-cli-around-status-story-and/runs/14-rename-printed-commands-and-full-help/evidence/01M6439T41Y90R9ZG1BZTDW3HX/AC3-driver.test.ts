import { test, expect, setDefaultTimeout } from "bun:test";
import { join } from "node:path";
import { readdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
const W = "/Users/jakubpruszynski/Projects/norn-worktrees/gh-75-regroup-the-cli-around-status-story-and--14-rename-printed-commands-and-full-help/packages/cli";
const { createHarness, issue } = await import(`${W}/test/harness.ts`);
const { runCli } = await import(`${W}/src/index.ts`);
setDefaultTimeout(120_000);
const LOG = process.env.QA_LOG!; writeFileSync(LOG, "");
const log = (s: string) => appendFileSync(LOG, s + "\n");
test("AC3 live", async () => {
  const h = await createHarness();
  await h.norn("init");
  h.write(join(h.root, ".agents/norn/config.yaml"), "agents:\n  claude: { adapter: claude }\nrunner: { adapter: headless }\nremote: { provider: gh, label: norn }\ndefault_workflow: story\ndefault_mode: auto\nnotifiers: []\n");
  h.git(["add", "-A"]); h.git(["commit", "-q", "-m", "i"]); h.git(["push", "-q", "origin", "main"]);
  h.remote.issues = [issue(5, "Pay invoices")];
  const runs = join(`${h.root}-worktrees/gh-5-pay-invoices`, ".agents/specs/gh-5-pay-invoices/runs/_story");
  for (let i = 0; i < 4; i++) { h.clock.advance(10_000); await h.tick(); }
  h.report(runs, "stuck", { reason: "no database" });
  h.clock.advance(10_000); await h.tick(); h.clock.advance(10_000); const t = await h.tick();
  const dir = join(h.root, ".agents/norn/trace");
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".jsonl"))) {
    const p = join(dir, f);
    writeFileSync(p, readFileSync(p, "utf8").split("\n").map((l) => { if (!l) return l; const ev = JSON.parse(l); if (ev.type !== "tick" || ev.tick_id !== t.tick_id) return l; ev.norn_version = "0.9.0"; return JSON.stringify(ev).replaceAll("norn run rerun gh-5", "norn unstick gh-5"); }).join("\n"));
  }
  log(`tick ${t.tick_id} rewritten: norn_version 0.9.0, 'norn run rerun gh-5' -> 'norn unstick gh-5'`);
  for (const argv of [["run", "view", "gh-5", "--why", "--tick", t.tick_id], ["run", "view", "gh-5", "--why", "--tick", t.tick_id, "--json"]]) {
    const r = await runCli(argv, h.deps);
    log(`\n$ norn ${argv.join(" ")}\nexit ${r.exit}\n${r.stdout}`);
  }
  const rr = await h.norn("run", "rerun", "gh-5"); log(`\n$ norn run rerun gh-5\nexit ${rr.exit}`);
  h.clock.advance(10_000); await h.tick(); h.clock.advance(10_000); await h.tick();
  log(`state after 2 ticks: ${JSON.stringify({ step: h.state(runs)?.step, status: h.state(runs)?.status })}`);
  h.cleanup();
});
