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
let file = "B11-harness.md";
const log = (s: string) => appendFileSync(join(E, file), s + "\n");
const rc = (d: string) => (existsSync(join(d, "receipts")) ? readdirSync(join(d, "receipts")).sort() : []);
const tick = async () => { h.clock.advance(10_000); return h.tick(); };
async function* keys(...ks: string[]) { for (const k of ks) yield k; }
const wt2 = `${h.root}-worktrees/gh-2-send-receipts`; const runs2 = join(wt2, ".agents/specs/gh-2-send-receipts/runs/_story");
try {
  await runCli(["init"], h.deps);
  h.write(join(h.root, ".agents/norn/config.yaml"), CONFIG);
  h.write(join(h.root, ".agents/norn/workflows/gated.yaml"), GATED);
  h.git(["add", "-A"]); h.git(["commit", "-q", "-m", "norn init"]); h.git(["push", "-q", "origin", "main"]);
  h.remote.issues = [issue(2, "Send receipts")];
  await h.tick("--sync");
  for (let i = 0; i < 5 && h.state(runs2)?.status !== "running"; i++) await tick();
  h.report(runs2, "done", { outcome: "done", handoff: "ready" });
  for (let i = 0; i < 5 && h.state(runs2)?.park?.kind !== "gate"; i++) await tick();
  log(`gh-2 park: ${JSON.stringify(h.state(runs2)?.park)}`);
  const frames: string[] = []; const before = rc(runs2);
  const r = await runCli(["status", "--watch", "--interval", "5s"], { ...h.deps, herdr: null, env: { ...h.deps.env, COLUMNS: "140", LINES: "40" }, input: keys("y", "q"), log: (l: string) => frames.push(l) });
  log(`$ norn status --watch --interval 5s   (keys: y, q)\n[exit ${r.exit}]`);
  const strip = (s: string) => s.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "");
  log(`--- first frame:\n${strip(frames[0] ?? "")}`);
  log(`--- last frame:\n${strip(frames.at(-1) ?? "")}`);
  const add = rc(runs2).filter((f) => !before.includes(f)); log(`new receipts in gh-2 after pressing y: ${add.join(", ")}`);
  for (const f of add) log(h.read(join(runs2, "receipts", f)));
} catch (e) { log(`!!! ${(e as Error).stack}`); } finally { h.cleanup(); }
