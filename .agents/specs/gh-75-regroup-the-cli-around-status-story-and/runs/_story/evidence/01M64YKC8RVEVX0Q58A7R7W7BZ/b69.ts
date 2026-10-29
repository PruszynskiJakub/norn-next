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
const tick = async () => { h.clock.advance(10_000); return h.tick(); };
const until = async (what: string, done: () => boolean) => { for (let i = 0; i < 10 && !done(); i++) await tick(); if (!done()) throw new Error(`never: ${what} ${JSON.stringify([1,2,3,4,5,6].map((i) => [i, st(runs(i))]))} ${JSON.stringify(st(sliceRuns()))}`); };
const st = (d: string) => { const s = h.state(d); return s && { step: s.step, attempt: s.attempt, status: s.status, park: s.park ?? null, mode: (s as any).mode }; };
const show = (label: string, d: string) => log(`state ${label}: ${JSON.stringify(st(d))}`);
const term = (o: Partial<{ answers: (string | null)[]; confirms: boolean[]; lines: (string | null)[]; edited: (string | null)[] }> = {}) => Object.assign(new FakeInteraction(), o);

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
    outcomes: { approve: $done, reject: $stuck }
`;
const BASED = `name: based
start: update
steps:
  update:
    type: git
    action: update
    outcomes: { done: test, conflict: $stuck }
  test:
    type: check
    run: "true"
    timeout: 1m
    outcomes: { pass: ready, fail: $stuck }
  ready:
    type: gate
    outcomes: { approve: $done, reject: $stuck }
`;
try {
  h.write(join(h.home, "config.yaml"), "max_agents: 6\n"); await n(["init"]);
  h.write(join(h.root, ".agents/norn/config.yaml"), CONFIG);
  h.write(join(h.root, ".agents/norn/workflows/upd.yaml"), UPD);
  const STK = UPD.replace("name: upd", "name: stk");
  h.write(join(h.root, ".agents/norn/workflows/stk.yaml"), STK);
  h.git(["add", "-A"]); h.git(["commit", "-q", "-m", "norn init"]); h.git(["push", "-q", "origin", "main"]);
  h.remote.issues = [issue(1, "Pay invoices", ["norn", "norn:wf:upd"]), issue(2, "Send receipts", ["norn", "norn:wf:stk"])];
  await h.tick("--sync");
  for (let i = 0; i < 3 && !(h.state(runs(1)) && h.state(runs(2))); i++) await tick();
  to("B69.md"); const a = { cwd: wt(1) }; const A = "(agent in gh-1 worktree) ";
  const b = await n(["brief"], a, A); log(`(brief printed ${b.stdout.length} chars)`);
  const bj = await n(["brief", "--json"], a, A); log(`brief --json keys: ${Object.keys(bj.value as object).join(",")}`);
  await n(["done", "approve", "--handoff", "x"], a, A);
  await n(["ask", "Which API?"], a, A); await tick(); show("gh-1", runs(1));
  await n(["story", "answer", "gh-1", "v2"]); await tick(); show("gh-1", runs(1));
  await n(["done", "done", "--handoff", "form renders"], a, A); await tick(); show("gh-1", runs(1));
  await n(["hook", "stop"], a, "(agent hook) ");
  const a2 = { cwd: wt(2) }; await n(["brief"], a2, "(agent in gh-2 worktree) ").then((r) => log(`(brief printed ${r.stdout.length} chars)`));
  await n(["stuck", "no access to the API"], a2, "(agent in gh-2 worktree) "); await tick(); show("gh-2", runs(2));
} catch (e) { log(`!!! ${(e as Error).stack}`); } finally { await h.cleanup?.(); }
