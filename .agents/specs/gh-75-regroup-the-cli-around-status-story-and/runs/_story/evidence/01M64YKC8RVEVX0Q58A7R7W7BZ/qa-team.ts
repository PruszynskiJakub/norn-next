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
let file = "setup-team.md";
const log = (s: string) => appendFileSync(join(E, file), s + "\n");
const to = (f: string) => { file = f; };
async function n(argv: string[], deps: Record<string, unknown> = {}, label = "") {
  const r = await runCli(argv, { ...h.deps, ...deps });
  log(`$ ${label}norn ${argv.map((a) => (a.includes(" ") ? JSON.stringify(a) : a)).join(" ")}\n${r.stdout.trimEnd().slice(0, 900)}${r.stderr ? `\n[stderr] ${r.stderr.trimEnd()}` : ""}\n[exit ${r.exit}]\n`);
  return r;
}
const SL: Record<number, string> = { 2: "gh-2-send-receipts", 4: "gh-4-split-work" };
const wt = (i: number) => `${h.root}-worktrees/${SL[i]}`;
const runs = (i: number) => join(wt(i), `.agents/specs/${SL[i]}/runs/_story`);
const sliceWt = () => `${wt(4)}--01-part`;
const sliceRuns = () => join(sliceWt(), `.agents/specs/${SL[4]}/runs/01-part`);
const tick = async () => { h.clock.advance(10_000); return h.tick(); };
const until = async (what: string, done: () => boolean) => { for (let i = 0; i < 10 && !done(); i++) await tick(); if (!done()) throw new Error(`never: ${what}`); };
const st = (d: string) => { const s = h.state(d); return s && { step: s.step, attempt: s.attempt, status: s.status, park: s.park ?? null }; };
const show = (label: string, d: string) => log(`state ${label}: ${JSON.stringify(st(d))}`);
try {
  await runCli(["init"], h.deps);
  h.write(join(h.root, ".agents/norn/config.yaml"), CONFIG);
  h.write(join(h.root, ".agents/norn/workflows/gated.yaml"), GATED);
  h.write(join(h.root, ".agents/norn/workflows/sliced.yaml"), SLICED);
  h.write(join(h.root, ".agents/norn/workflows/sliceqa.yaml"), SLICE_QA);
  h.git(["add", "-A"]); h.git(["commit", "-q", "-m", "norn init"]); h.git(["push", "-q", "origin", "main"]);
  h.remote.issues = [issue(2, "Send receipts"), issue(4, "Split work", ["norn", "norn:wf:sliced"])];
  await h.tick("--sync");
  await until("running", () => h.state(runs(2))?.status === "running" && h.state(runs(4))?.status === "running");
  h.report(runs(2), "done", { outcome: "done", handoff: "ready" });
  h.write(join(wt(4), `.agents/specs/${SL[4]}/slices/01-part.md`), "---\nid: gh-4/01\ntitle: First part\nworkflow: sliceqa\ndepends_on: []\nstatus: planned\n---\n\nAcceptance: it works.\n");
  h.report(runs(4), "done", { outcome: "done", handoff: "one slice" });
  await until("gates", () => h.state(runs(2))?.park?.kind === "gate" && h.state(sliceRuns())?.park?.kind === "gate");

  to("B40-gate.md");
  show("gh-2 before close", runs(2)); show("gh-4/01 before close", sliceRuns()); show("gh-4 before close", runs(4));
  await n(["story", "close", "gh-2", "--yes"]); await n(["story", "close", "gh-4", "--yes"]);
  log(`worktrees after close: gh-2 ${existsSync(wt(2))}, gh-4 ${existsSync(wt(4))}, gh-4/01 ${existsSync(sliceWt())}`);
  await n(["story", "reopen", "gh-2"]); await n(["story", "reopen", "gh-4"]);
  log(`worktrees after reopen: gh-2 ${existsSync(wt(2))}, gh-4 ${existsSync(wt(4))}, gh-4/01 ${existsSync(sliceWt())}`);
  log(`claims: ${h.git(["ls-remote", "origin", "refs/norn/claims/*"])}`);
  await tick(); await tick();
  show("gh-2 after reopen + 2 ticks", runs(2)); show("gh-4/01 after reopen + 2 ticks", sliceRuns()); show("gh-4 after", runs(4));
  await n(["status"]);

  // another machine
  const b = join(h.dir, "colleague"), bh = join(h.dir, "colleague-home"); mkdirSync(bh); sh(h.dir, ["clone", "-q", h.remoteDir, b]);
  const other = { cwd: b, env: { ...h.deps.env, NORN_HOME_DIR: bh, USER: "ann", NORN_MACHINE: "laptop" } };
  to("B33-cross.md");
  await n(["story", "checkout", "gh-2"], other, "(ann@laptop) ");
  await n(["story", "checkout", "gh-2", "--force"], other, "(ann@laptop) ");
  log(`claim gh-2 now: ${h.git(["ls-remote", "origin", "refs/norn/claims/gh-2"])}`);
  log(`ann's worktree for gh-2 exists: ${existsSync(`${b}-worktrees/${SL[2]}`)}`);
  to("B34-cross.md");
  await n(["story", "handoff", "gh-4"]);
  log(`claim gh-4 after handoff: '${h.git(["ls-remote", "origin", "refs/norn/claims/gh-4"])}'`);
  await n(["story", "checkout", "gh-4"], other, "(ann@laptop) ");
  log(`claim gh-4 after ann's checkout: ${h.git(["ls-remote", "origin", "refs/norn/claims/gh-4"])}`);
  log(`ann's worktrees: gh-4 ${existsSync(`${b}-worktrees/${SL[4]}`)}, gh-4/01 ${existsSync(`${b}-worktrees/${SL[4]}--01-part`)}`);
  await n(["story", "list"], other, "(ann@laptop) ");
} catch (e) { log(`!!! ${(e as Error).stack}`); } finally { h.cleanup(); }
