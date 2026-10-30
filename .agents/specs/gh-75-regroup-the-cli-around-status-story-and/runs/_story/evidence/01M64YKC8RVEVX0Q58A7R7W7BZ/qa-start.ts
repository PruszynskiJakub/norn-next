// QA driver for gh-75: runs norn commands through runCli against the harness's temp repo (fake remote/runner),
// writing every command, exit code and output to evidence files.
import { appendFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const W = "/Users/jakubpruszynski/Projects/norn-worktrees/gh-75-regroup-the-cli-around-status-story-and/packages/cli";
const { createHarness, FakeInteraction, issue, sh } = await import(`${W}/test/harness.ts`);
const { runCli } = await import(`${W}/src/index.ts`);

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
const SLICED = `name: sliced
start: plan
steps:
  plan:
    type: agent
    skill: norn-plan
    outcomes: { done: { to: slices, means: "slice files written" } }
  slices:
    type: slices
    outcomes: { done: $done, stuck: $stuck }
`;
const SLICE_QA = `name: sliceqa
start: qa
steps:
  qa:
    type: gate
    prompt: "Try the slice"
    outcomes: { approve: $done, reject: $stuck }
`;
const CONFIG = `agents:
  claude: { adapter: claude }
runner: { adapter: headless }
remote: { provider: gh, label: norn }
default_workflow: gated
default_mode: auto
max_agents: 6
notifiers: []
`;
const E = process.env.EVID!;
const h = await createHarness();
const log = (s: string) => appendFileSync(join(E, "B28-open.md"), s + "\n");
const tick = async () => { h.clock.advance(10_000); return h.tick(); };
const ATT = `name: att
start: work
steps:
  work:
    type: agent
    skill: norn-implement
    attended: true
    outcomes: { done: $done }
`;
const wt1 = `${h.root}-worktrees/gh-1-pay-invoices`; const runs1 = join(wt1, ".agents/specs/gh-1-pay-invoices/runs/_story");
try {
  await runCli(["init"], h.deps);
  h.write(join(h.root, ".agents/norn/config.yaml"), CONFIG);
  h.write(join(h.root, ".agents/norn/workflows/att.yaml"), ATT);
  h.git(["add", "-A"]); h.git(["commit", "-q", "-m", "norn init"]); h.git(["push", "-q", "origin", "main"]);
  h.remote.issues = [issue(1, "Pay invoices", ["norn", "norn:wf:att"])];
  await h.tick("--sync"); for (let i = 0; i < 4 && h.state(runs1)?.park?.kind !== "attended"; i++) await tick();
  log(`gh-1 park: ${JSON.stringify(h.state(runs1)?.park)}`);
  const opened: unknown[] = [];
  h.runner.capabilities = { ...h.runner.capabilities, open: true };
  { const r = await runCli(["status"], h.deps); log(`$ norn status   (runner that opens terminals)\n${r.stdout.trim()}\n[exit ${r.exit}]`); }
  Object.assign(h.runner, { openForPerson: async (spec: unknown) => (opened.push(spec), { pane_id: "p-9" }) });
  for (const a of [["story", "start", "gh-1"], ["story", "start", "gh-1", "--print"]]) {
    const r = await runCli(a, h.deps); log(`$ norn ${a.join(" ")}   (runner can open a pane: records openForPerson)\n${r.stdout.trim()}\n[exit ${r.exit}]`);
    log(`panes opened so far: ${JSON.stringify(opened)}`);
  }
} catch (e) { log(`!!! ${(e as Error).stack}`); } finally { h.cleanup(); }
