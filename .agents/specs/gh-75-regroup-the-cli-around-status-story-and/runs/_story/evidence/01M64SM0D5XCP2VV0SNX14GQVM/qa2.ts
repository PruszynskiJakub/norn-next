// QA driver for gh-75: runs norn commands through runCli against the harness's temp repo (fake remote/runner),
// writing every command, exit code and output to evidence files.
import { appendFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const W = "/Users/jakubpruszynski/Projects/norn-worktrees/gh-75-regroup-the-cli-around-status-story-and/packages/cli";
const { createHarness, FakeInteraction, issue, sh } = await import(`${W}/test/harness.ts`);
const { runCli } = await import(`${W}/src/index.ts`);

const E = process.env.EVID!;
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

const h = await createHarness();
let file = "setup.md";
const log = (s: string) => appendFileSync(join(E, file), s + "\n");
const to = (f: string) => { file = f; };
async function n(argv: string[], deps: Record<string, unknown> = {}, label = "") {
  const r = await runCli(argv, { ...h.deps, ...deps });
  log(`$ ${label}norn ${argv.map((a) => (a.includes(" ") ? JSON.stringify(a) : a)).join(" ")}\n${r.stdout.trimEnd()}${r.stderr ? `\n[stderr] ${r.stderr.trimEnd()}` : ""}\n[exit ${r.exit}]\n`);
  return r;
}
const SL: Record<number, string> = { 1: "gh-1-pay-invoices", 2: "gh-2-send-receipts", 3: "gh-3-pick-an-api", 4: "gh-4-split-work", 5: "gh-5-later", 6: "gh-6-close-me" };
const wt = (i: number) => `${h.root}-worktrees/${SL[i]}`;
const runs = (i: number) => join(wt(i), `.agents/specs/${SL[i]}/runs/_story`);
const sliceWt = () => `${wt(4)}--01-part`;
const sliceRuns = () => join(sliceWt(), `.agents/specs/${SL[4]}/runs/01-part`);
const rc = (d: string) => (existsSync(join(d, "receipts")) ? readdirSync(join(d, "receipts")).sort() : []);
const UPD = `name: upd
start: work
steps:
  work:
    type: agent
    skill: norn-implement
    attended: true
    outcomes: { done: { to: review, means: "ready" } }
  review:
    type: gate
    prompt: "Look"
    outcomes: { approve: $done, reject: work }
  update:
    type: git
    action: update
    outcomes: { done: review, conflict: $stuck }
`;
try {
  h.write(join(h.home, "config.yaml"), "max_agents: 6\n"); await n(["init"]);
  h.write(join(h.root, ".agents/norn/config.yaml"), CONFIG);
  h.write(join(h.root, ".agents/norn/workflows/gated.yaml"), GATED);
  h.write(join(h.root, ".agents/norn/workflows/sliced.yaml"), SLICED);
  h.write(join(h.root, ".agents/norn/workflows/sliceqa.yaml"), SLICE_QA);
  h.write(join(h.root, ".agents/norn/workflows/upd.yaml"), UPD);
  h.git(["add", "-A"]); h.git(["commit", "-q", "-m", "norn init"]); h.git(["push", "-q", "origin", "main"]);
  h.remote.issues = [issue(1, "Pay invoices", ["norn", "norn:wf:upd"]), issue(4, "Split work", ["norn", "norn:wf:sliced"])];
  await h.tick("--sync");
  await until("gh-4 running", () => h.state(runs(4))?.status === "running");
  h.write(join(wt(4), `.agents/specs/${SL[4]}/slices/01-part.md`), "---\nid: gh-4/01\ntitle: First part\nworkflow: sliceqa\ndepends_on: []\nstatus: planned\n---\n\nAcceptance: it works.\n");
  h.report(runs(4), "done", { outcome: "done", handoff: "one slice" });
  await until("slice gate", () => h.state(sliceRuns())?.park?.kind === "gate" && !!h.state(runs(1)));
  to("B28.md"); show("gh-1 (attended work)", runs(1)); await n(["status"]); await n(["story", "start", "gh-1", "--print"]); await n(["story", "start", "gh-1"]); log(`runner launches: ${JSON.stringify(h.runner.launches.map((l: any) => l.cwd))}`);
  to("B55.md"); log(`slice worktree exists: ${existsSync(sliceWt())}`);
  await n(["story", "view"], { cwd: sliceWt() }, "(cwd: gh-4/01 slice worktree) ");
  await n(["story", "edit", "--manual"], { cwd: sliceWt() }, "(cwd: gh-4/01 slice worktree) "); show("gh-4 story", runs(4));
  await n(["story", "update-branch"], { cwd: sliceWt() }, "(cwd: gh-4/01 slice worktree) ");
  await n(["story", "handoff"], { cwd: sliceWt() }, "(cwd: gh-4/01 slice worktree) "); log(`claim ref gh-4 after handoff: '${h.git(["ls-remote", "origin", "refs/norn/claims/gh-4"])}'`);
  to("B34.md"); log("(see B55.md: story handoff from the gh-4/01 slice worktree)"); log(`claim ref gh-4: '${h.git(["ls-remote", "origin", "refs/norn/claims/gh-4"])}'`); log(`remote heads: ${h.git(["ls-remote", "--heads", "origin"])}`);
  to("B33.md"); await n(["story", "checkout", "gh-4"]); log(`claim ref gh-4: '${h.git(["ls-remote", "origin", "refs/norn/claims/gh-4"])}'`);
  to("B45.md"); { const f = rc(runs(4))[0]; const id = JSON.parse(h.read(join(runs(4), "receipts", f))).receipt_id; await n(["run", "view", "gh-4", "--receipt", id]); }
  to("B27.md"); h.report(runs(1), "done", { outcome: "done", handoff: "ok" }); await until("gh-1 gate", () => h.state(runs(1))?.park?.kind === "gate"); show("gh-1", runs(1));
  await n(["story", "update-branch", "gh-1"]); await tick(); await tick(); show("gh-1 after update-branch + ticks", runs(1)); await n(["run", "list", "gh-1"]);
} catch (e) { log(`!!! ${String((e as Error).stack ?? e)}`); } finally { h.cleanup(); }
