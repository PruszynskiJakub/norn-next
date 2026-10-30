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

try {
  h.write(join(h.home, "config.yaml"), "max_agents: 6\n"); await n(["init"]);
  h.write(join(h.root, ".agents/norn/config.yaml"), CONFIG);
  h.write(join(h.root, ".agents/norn/workflows/gated.yaml"), GATED);
  h.write(join(h.root, ".agents/norn/workflows/sliced.yaml"), SLICED);
  h.write(join(h.root, ".agents/norn/workflows/sliceqa.yaml"), SLICE_QA);
  h.git(["add", "-A"]); h.git(["commit", "-q", "-m", "norn init"]); h.git(["push", "-q", "origin", "main"]);
  h.remote.issues = [issue(1, "Pay invoices"), issue(2, "Send receipts"), issue(3, "Pick an API"), issue(4, "Split work", ["norn", "norn:wf:sliced"]), issue(6, "Close me")];
  await h.tick("--sync");
await until("1-4,6 running", () => [1, 2, 3, 4, 6].every((i) => h.state(runs(i))?.status === "running"));

  // --- run list / view / why on a running unit
  to("B43.md"); await n(["run", "list", "gh-1"]); await n(["run", "list", "gh-1", "--json"]);
  to("B44.md"); await n(["run", "view", "gh-1"]); const rv = await n(["run", "view", "gh-1", "--json"]);
  const runId = (rv.value as any)?.run_id ?? (rv.value as any)?.run?.run_id; if (runId) await n(["run", "view", String(runId)]);
  to("B45.md"); await n(["run", "view", "gh-1", "--why"]); const rcpt = rc(runs(1))[0]; if (rcpt) await n(["run", "view", "gh-1", "--receipt", rcpt.slice(0, 4)]);

  // --- cancel gh-1 (running): receipt then kill; stays stuck; work kept
  to("B51.md");
  h.write(join(wt(1), "pay.ts"), "export const pay = 1;\n"); sh(wt(1), ["add", "pay.ts"]); sh(wt(1), ["commit", "-q", "-m", "pay"]);
  const head = sh(wt(1), ["rev-parse", "HEAD"]); h.write(join(wt(1), "draft.ts"), "wip\n");
  let atKill: string[] = []; const kill = h.runner.kill.bind(h.runner);
  h.runner.kill = async (s: any) => { atKill = rc(runs(1)); return kill(s); };
  const launches0 = h.runner.launches.length;
  await n(["run", "cancel", "gh-1"]);
  h.runner.kill = kill;
  log(`receipts when kill was called: ${atKill.join(", ")}`); log(`runner.killed: ${JSON.stringify(h.runner.killed.map((k: any) => k.session_id))}`);
  await tick(); await tick(); show("gh-1 after 2 ticks", runs(1)); log(`launches since cancel: ${h.runner.launches.length - launches0}`);
  await n(["status"]);
  to("B52.md");
  log(`commit ${head} still in log: ${sh(wt(1), ["log", "--format=%H"]).includes(head)}; draft.ts exists: ${existsSync(join(wt(1), "draft.ts"))}`);
  log(`branch: ${sh(h.root, ["branch", "--list", SL[1]])}; claim ref: ${h.git(["ls-remote", "origin", "refs/norn/claims/gh-1"])}`);
  to("B50.md"); await n(["run", "rerun", "gh-2"]);
  to("B48.md"); await n(["run", "rerun", "gh-1", "--reason", "try again"]); await tick(); await tick(); show("gh-1 after rerun", runs(1));
  log(`launches since cancel: ${h.runner.launches.length - launches0}`);
  to("B53.md"); // after gh-2 at gate
  // --- gh-2 to gate, gh-3 to ask, gh-4 slices
  h.report(runs(2), "done", { outcome: "done", handoff: "ready" });
  h.report(runs(3), "ask", { question: "Which API?" });
  h.write(join(wt(4), `.agents/specs/${SL[4]}/slices/01-part.md`), "---\nid: gh-4/01\ntitle: First part\nworkflow: sliceqa\ndepends_on: []\nstatus: planned\n---\n\nAcceptance: it works.\n");
  h.report(runs(4), "done", { outcome: "done", handoff: "one slice" });
  await until("gates", () => h.state(runs(2))?.park?.kind === "gate" && h.state(runs(3))?.park?.kind === "ask" && h.state(sliceRuns())?.park?.kind === "gate");
  to("B53.md"); await n(["run", "cancel", "gh-2"]); await n(["run", "cancel", "gh-2", "--json"]);
  { const b = join(h.dir, "colleague"), bh = join(h.dir, "colleague-home"); mkdirSync(bh); sh(h.dir, ["clone", "-q", h.remoteDir, b]);
    await n(["run", "cancel", "gh-1"], { cwd: b, env: { ...h.deps.env, NORN_HOME_DIR: bh, USER: "colleague", NORN_MACHINE: "laptop" } }, "(other machine) ");
    to("B38.md"); await n(["story", "close", "gh-1", "--yes"], { cwd: b, env: { ...h.deps.env, NORN_HOME_DIR: bh, USER: "colleague", NORN_MACHINE: "laptop" } }, "(other machine) ");
    to("B33.md"); await n(["story", "checkout", "gh-1"], { cwd: b, env: { ...h.deps.env, NORN_HOME_DIR: bh, USER: "colleague", NORN_MACHINE: "laptop" } }, "(other machine) ");
  }

  // --- status: groups and printed commands
  to("B9.md"); await n(["status"]); await n(["status", "--json"]);
  to("B10.md"); await n(["status", "--details"]); await n(["status", "--notes"]); await n(["status", "--history", "--since", "1d"]); await n(["status", "--history", "--since", "1d", "--json"]);
  to("B15.md"); await n(["story", "list"]);
  to("B16.md"); await n(["story", "view", "gh-4"]); await n(["story", "view", "gh-2", "--json"]);
  to("B6.md"); for (const a of [["story", "list"], ["story", "view", "gh-2"], ["run", "list", "gh-2"], ["run", "view", "gh-2"], ["status"]]) { const r = await runCli([...a, "--json"], h.deps); let ok = true; try { JSON.parse(r.stdout); } catch { ok = false; } log(`norn ${a.join(" ")} --json → exit ${r.exit}, one JSON value: ${ok}`); }

  // --- targets and prompts
  to("B57.md"); { const t = term({ answers: [null] }); await n(["story", "approve"], { interaction: t }, "(tty, main checkout, Esc) "); log(`offered: ${JSON.stringify(t.picks.map((p: any) => ({ q: p.question, choices: p.choices.map((c: any) => c.value), preselect: p.preselect })))}`);
    const t2 = term({ answers: [null] }); await n(["story", "answer", "x"], { interaction: t2 }, "(tty, Esc) "); log(`offered: ${JSON.stringify(t2.picks.map((p: any) => p.choices.map((c: any) => c.value)))}`); }
  to("B60.md"); await n(["story", "approve", "--json"]); await n(["story", "approve"], { interaction: null }, "(no tty) "); await n(["story", "approve"], { interaction: term(), env: { ...h.deps.env, NORN_ORIENT: "1" }, cwd: h.root }, "(orient agent session env NORN_ORIENT=1, tty) ");
  log(`gh-2 receipts unchanged (no approve): ${rc(runs(2)).filter((f) => f.endsWith("approve.json")).length === 0}`);
  to("B54.md"); { const before = rc(sliceRuns()); await n(["story", "approve"], { cwd: sliceWt(), interaction: term() }, "(cwd: gh-4/01 slice worktree) "); log(`new receipts in gh-4/01: ${rc(sliceRuns()).filter((f) => !before.includes(f)).join(", ")}`); }
  to("B26.md"); await n(["story", "reject", "gh-2"]); await n(["story", "reject", "gh-2", "--json"]);
  to("B56.md"); { const before = rc(runs(2)); await n(["story", "reject", "gh-2", "--reason", "misses B4"], { cwd: wt(1) }, "(cwd: gh-1 worktree) "); const add = rc(runs(2)).filter((f) => !before.includes(f)); log(`new receipts in gh-2: ${add.join(", ")}`); for (const f of add) log(h.read(join(runs(2), "receipts", f))); }
  await tick(); show("gh-2 after reject + tick", runs(2));
  to("B24.md"); { const before = rc(runs(3)); await n(["story", "answer", "gh-3", "Use the v2 API"]); const add = rc(runs(3)).filter((f) => !before.includes(f)); log(`new receipts in gh-3: ${add.join(", ")}`); for (const f of add) log(h.read(join(runs(3), "receipts", f))); await tick(); show("gh-3 after tick", runs(3)); }
  // gh-2 back to gate, then approve via pick with one candidate preselected
  h.report(runs(2), "done", { outcome: "done", handoff: "fixed" }); await until("gh-2 gate", () => h.state(runs(2))?.park?.kind === "gate");
  to("B58.md"); { const t = term(); const before = rc(runs(2)); await n(["story", "approve"], { interaction: t }, "(tty, Enter) "); log(`offered: ${JSON.stringify(t.picks.map((p: any) => ({ choices: p.choices.map((c: any) => c.value), preselect: p.preselect })))}`); log(`new receipts in gh-2: ${rc(runs(2)).filter((f) => !before.includes(f)).join(", ")}`); }
  to("B25.md"); log("(the approve above wrote the receipt; next tick:)"); await tick(); show("gh-2", runs(2)); await n(["story", "list"]);
  to("B59.md"); await n(["story", "approve"], { interaction: term() }, "(tty, nothing at a gate) "); await n(["story", "answer", "x"], { interaction: term() }, "(tty) ");

  // --- edit
  to("B30.md"); await n(["story", "edit", "gh-3", "--manual"]); await tick(); show("gh-3", runs(3)); await n(["story", "edit", "gh-3", "--auto", "--manual"]); await n(["story", "edit", "gh-3", "--auto"]); await tick(); show("gh-3", runs(3));
  to("B55.md"); await n(["story", "edit", "--manual"], { cwd: sliceWt() }, "(cwd: gh-4/01 slice worktree) "); await n(["story", "view", "--json"], { cwd: sliceWt() }, "(cwd: gh-4/01) ").then((r) => log(`view key: ${(r.value as any)?.key ?? (r.value as any)?.story?.key}`));
  await n(["story", "edit", "--auto"], { cwd: sliceWt() }, "(cwd: gh-4/01 slice worktree) ");
  to("B31.md"); h.remote.issues.push(issue(5, "Later")); await n(["story", "edit", "gh-5", "--workflow", "sliced"]); await n(["sync"]); await n(["story", "edit", "gh-5", "--manual"]); await n(["story", "edit", "gh-5", "--workflow", "sliced"]); await n(["story", "list", "--json"]).then((r) => log(`gh-5 listed: ${JSON.stringify((r.value as any).stories.find((s: any) => s.key === "gh-5"))?.slice(0, 600)}`));
  to("B28.md"); await tick(); show("gh-5 (manual)", runs(5)); await n(["story", "start", "gh-5", "--print"]); await n(["story", "start", "gh-5", "--print", "--json"]);
  to("B32.md"); await n(["story", "edit", "gh-3", "--workflow", "sliced"]); await n(["story", "edit", "gh-3", "--workflow", "sliced", "--at", "plan"]); await tick(); show("gh-3", runs(3));
  to("B49.md"); h.report(runs(3), "stuck", { reason: "blocked" }); await tick(); show("gh-3 stuck", runs(3)); await n(["run", "rerun", "gh-3", "--step", "slices"]); await n(["run", "rerun", "gh-3", "--step", "nope"]); await tick(); show("gh-3", runs(3));
  to("B27.md"); await n(["story", "update-branch", "gh-1"]); await n(["story", "update-branch", "gh-6"]);
  h.report(runs(6), "stuck", { reason: "x" }); await tick(); await n(["story", "update-branch", "gh-6"]); await tick(); show("gh-6", runs(6));

  // --- handoff / checkout
  to("B34.md"); await n(["story", "handoff"], { cwd: sliceWt() }, "(cwd: gh-4/01 slice worktree) "); log(`claim ref gh-4: '${h.git(["ls-remote", "origin", "refs/norn/claims/gh-4"])}'`); log(`remote branches: ${h.git(["ls-remote", "--heads", "origin"])}`);
  to("B33.md"); await n(["story", "checkout", "gh-4"]); log(`claim ref gh-4: '${h.git(["ls-remote", "origin", "refs/norn/claims/gh-4"])}'`);

  // --- close / reopen (gh-1 running, gh-2 approved-done?, use gh-1)
  to("B36.md"); { const t = term({ confirms: [false] }); const wts = h.git(["worktree", "list"]); await n(["story", "close", "gh-4"], { interaction: t }, "(tty, answer N) "); log(`asked: ${JSON.stringify(t.questions)}`); log(`worktrees unchanged: ${wts === h.git(["worktree", "list"])}`); }
  to("B37.md"); await n(["story", "close", "gh-4", "--json"]); await n(["story", "close", "gh-4"], { interaction: null }, "(no tty) ");
  to("B35.md"); show("gh-1 before close", runs(1)); { const wt1 = wt(1); await n(["story", "close", "gh-1", "--yes"]); log(`worktree exists: ${existsSync(wt1)}; local branch: '${h.git(["branch", "--list", SL[1]])}'; claim: '${h.git(["ls-remote", "origin", "refs/norn/claims/gh-1"])}'; remote branch: '${h.git(["ls-remote", "--heads", "origin", SL[1]])}'; issue state: ${h.remote.issues.find((i: any) => i.number === 1)?.state}; remote calls touching #1: ${h.remote.calls.filter((c: string) => /close|edit/.test(c)).join(",")}`); }
  await n(["story", "list"]);
  to("B39.md"); await n(["story", "close", "gh-1", "--yes"]);
  to("B42.md"); await n(["story", "reopen", "gh-3"]);
  to("B40.md"); await n(["story", "reopen", "gh-1"]); log(`worktree exists: ${existsSync(wt(1))}; claim: '${h.git(["ls-remote", "origin", "refs/norn/claims/gh-1"])}'; draft-free commit kept: ${sh(wt(1), ["log", "--format=%H"]).includes(head)}`); show("gh-1 after reopen", runs(1));
  to("B41.md"); show("gh-1 after reopen", runs(1)); await tick(); show("gh-1 after tick", runs(1)); await n(["status"]); log(`last receipt: ${h.read(join(runs(1), "receipts", rc(runs(1)).at(-1)!))}`); await n(["run", "rerun", "gh-1"]); await tick(); await tick(); show("gh-1 after rerun", runs(1));
  to("B40b.md"); // a gate-waiting slice closed and reopened goes back to its gate
  show("gh-4/01 before", sliceRuns()); await n(["story", "close", "gh-4", "--yes"]); await n(["story", "reopen", "gh-4"]); await tick(); show("gh-4/01 after reopen+tick", sliceRuns()); show("gh-4 after", runs(4));
  to("B42.md"); await n(["story", "close", "gh-6", "--yes"]); h.git(["push", "-q", "origin", "--delete", SL[6]]); await n(["story", "reopen", "gh-6"]);
  await n(["story", "close", "gh-3", "--yes"]); h.remote.issues.find((i: any) => i.number === 3).state = "closed"; await n(["story", "reopen", "gh-3"]);

  // --- create
  to("B18-harness.md"); await n(["story", "create", "--title", "Fix login timeout", "--workflow", "gated"]); log(`remote issue: ${JSON.stringify(h.remote.issues.at(-1))}`); await n(["status"]);
  to("B19-harness.md"); { const t = term({ lines: [""] }); const c = h.remote.calls.length; await n(["story", "create"], { interaction: t }, "(tty, empty title) "); log(`asked: ${JSON.stringify(t.asks)}; remote calls: ${JSON.stringify(h.remote.calls.slice(c))}`);
    const t2 = term({ lines: ["Add export"], edited: ["Body from the editor"] }); await n(["story", "create"], { interaction: t2 }, "(tty, title + editor) "); log(`asked: ${JSON.stringify(t2.asks)}; editor opened with: ${JSON.stringify(t2.edits)}; issue body: ${JSON.stringify(h.remote.issues.at(-1)?.body)}`); }
  to("B22-harness.md"); { h.remote.createError = new Error("gh: could not connect"); const before = h.git(["for-each-ref"]); await n(["story", "create", "--title", "Offline", "--workflow", "gated"]); log(`refs unchanged: ${before === h.git(["for-each-ref"])}`); h.remote.createError = null; }
  to("B21-harness.md"); { const c = h.remote.calls.length; await n(["story", "create", "--title", "x", "--workflow", "nope"]); log(`remote calls: ${JSON.stringify(h.remote.calls.slice(c))}`); }
  to("B7.md"); await n(["status"]); await n(["status", "--json"]);
} catch (e) {
  log(`!!! ${String((e as Error).stack ?? e)}`);
} finally {
  h.cleanup();
}
