import { expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { createHarness, issue, sh } from "/Users/jakubpruszynski/Projects/norn-worktrees/gh-75-regroup-the-cli-around-status-story-and--11-story-reopen/packages/cli/test/harness.ts";

setDefaultTimeout(180_000);
const OUT = process.env.QA_OUT as string;
const log = (f: string, s: string) => appendFileSync(join(OUT, f), s + "\n");

const SLICE = `name: slice
start: implement
steps:
  implement:
    type: agent
    skill: norn-implement
    outcomes: { done: { to: review, means: "tests pass" } }
  review:
    type: gate
    prompt: "Look at it"
    outcomes: { approve: integrate, reject: { to: implement, counter: loop } }
  integrate:
    type: git
    action: integrate
    outcomes: { done: $done, conflict: { to: implement, counter: loop } }
counters: { loop: { max: 3 } }
`;
const MINI = `name: mini
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
const BASED = `name: based
start: build
steps:
  build:
    type: agent
    skill: norn-implement
    outcomes: { done: { to: update, means: "built" } }
  update:
    type: git
    action: update
    outcomes: { done: ready, conflict: $stuck }
  ready:
    type: gate
    prompt: "merge it"
    outcomes: { approve: $done }
`;
const cfg = (wf: string) => `agents:
  claude: { adapter: claude }
runner: { adapter: headless }
remote: { provider: gh, label: norn }
default_workflow: ${wf}
default_mode: auto
notifiers: []
`;

async function setup(wf: string, text: string, extra?: [string, string]) {
  const h = await createHarness();
  expect((await h.norn("init")).exit).toBe(0);
  h.write(join(h.root, ".agents/norn/config.yaml"), cfg(wf));
  h.write(join(h.root, `.agents/norn/workflows/${wf}.yaml`), text);
  if (extra) h.write(join(h.root, `.agents/norn/workflows/${extra[0]}.yaml`), extra[1]);
  h.git(["add", "-A"]); h.git(["commit", "-q", "-m", "init"]); h.git(["push", "-q", "origin", "main"]);
  h.remote.issues = [issue(7, "Add login form")];
  return h;
}

test("AC6: close with a running slice, reopen; status and story view", async () => {
  const h = await setup("mini", MINI, ["slice", SLICE]);
  const SPEC = ".agents/specs/gh-7-add-login-form", B = "gh-7-add-login-form";
  const sw = `${h.root}-worktrees/${B}`, sl = (n: string) => `${sw}--${n}`;
  const tick = async () => { h.clock.advance(10_000); return h.tick(); };
  const until = async (ok: () => boolean) => { for (let i = 0; i < 12 && !ok(); i++) await tick(); expect(ok()).toBe(true); };
  const show = async (title: string) => {
    log("AC6.md", `\n## ${title}\n`);
    for (const argv of [["status"], ["story", "view", "gh-7"]]) {
      const r = await h.norn(...argv);
      log("AC6.md", `$ norn ${argv.join(" ")}   (exit ${r.exit})\n\`\`\`\n${r.stdout.replaceAll(h.dir, "<tmp>")}\n\`\`\``);
    }
    log("AC6.md", `worktrees: story=${existsSync(sw)} 01=${existsSync(sl("01-form"))} 02=${existsSync(sl("02-list"))}`);
  };
  await until(() => h.state(join(sw, SPEC, "runs/_story"))?.run?.session != null);
  await tick();
  for (const [nn, t] of [["01-form", "Login form"], ["02-list", "User list"]])
    h.write(join(sw, SPEC, `slices/${nn}.md`), `---\nid: gh-7/${nn.slice(0, 2)}\ntitle: ${t}\ndepends_on: []\nstatus: planned\n---\n\nAcceptance: it renders.\n`);
  h.report(join(sw, SPEC, "runs/_story"), "done", { outcome: "done", handoff: "planned" });
  await until(() => h.state(join(sl("01-form"), SPEC, "runs/01-form"))?.run?.session != null && h.state(join(sl("02-list"), SPEC, "runs/02-list"))?.run?.session != null);
  h.write(join(sl("01-form"), "form.txt"), "v1\n");
  h.report(join(sl("01-form"), SPEC, "runs/01-form"), "done", { outcome: "done", handoff: "built" });
  await until(() => h.state(join(sl("01-form"), SPEC, "runs/01-form"))?.step === "review");
  await show("Before close (01 at review gate, 02 running implement)");
  const c = await h.norn("story", "close", "gh-7", "--yes");
  log("AC6.md", `\n$ norn story close gh-7 --yes  (exit ${c.exit})\n\`\`\`\n${c.stdout.replaceAll(h.dir, "<tmp>")}\n\`\`\``);
  await show("After close");
  h.git(["fetch", "-q", "origin"]);
  const closedAt = h.git(["rev-parse", `origin/${B}`]);
  const r = await h.norn("story", "reopen", "gh-7");
  log("AC6.md", `\n$ norn story reopen gh-7  (exit ${r.exit})\n\`\`\`\n${r.stdout.replaceAll(h.dir, "<tmp>")}\n\`\`\``);
  h.git(["fetch", "-q", "origin"]);
  log("AC6.md", `\ncommits on story branch since close:\n${h.git(["log", "--format=%s", `${closedAt}..origin/${B}`])}\nstory.md status: ${h.git(["show", `origin/${B}:${SPEC}/story.md`]).match(/status: \w+/)?.[0]}\nclaim: ${sh(h.root, ["cat-file", "-p", "refs/norn/claims/gh-7"])}`);
  await show("After reopen, before any tick");
  const launches = h.runner.launches.length;
  await tick(); await tick();
  await show("After reopen + 2 ticks");
  log("AC6.md", `\nlaunches after reopen: ${h.runner.launches.length - launches}`);
  const rr = await h.norn("run", "rerun", "gh-7/02");
  log("AC6.md", `\n$ norn run rerun gh-7/02 (exit ${rr.exit})`);
  await until(() => h.state(join(sl("02-list"), SPEC, "runs/02-list"))?.status === "running");
  await show("After run rerun gh-7/02 + tick");
  h.cleanup();
});

test("AC4: base moved while closed; reopen, rerun, then git:update merges the base without error", async () => {
  const h = await setup("based", BASED);
  const SPEC = ".agents/specs/gh-7-add-login-form", B = "gh-7-add-login-form";
  const sw = `${h.root}-worktrees/${B}`, runs = join(sw, SPEC, "runs/_story");
  const tick = async () => { h.clock.advance(10_000); return h.tick("--sync"); };
  const until = async (ok: () => boolean) => { for (let i = 0; i < 12 && !ok(); i++) await tick(); expect(ok()).toBe(true); };
  await until(() => h.state(runs)?.run?.session != null);
  await tick();
  expect((await h.norn("story", "close", "gh-7", "--yes")).exit).toBe(0);
  const other = join(h.dir, "other");
  sh(h.dir, ["clone", "-q", h.remoteDir, other]); sh(other, ["config", "user.email", "o@e.com"]); sh(other, ["config", "user.name", "O"]);
  h.write(join(other, "CHANGES.md"), "moved\n"); sh(other, ["add", "-A"]); sh(other, ["commit", "-q", "-m", "base moves"]); sh(other, ["push", "-q", "origin", "main"]);
  const base = sh(other, ["rev-parse", "HEAD"]);
  const r = await h.norn("story", "reopen", "gh-7");
  log("AC4.md", `$ norn story reopen gh-7 (exit ${r.exit})\n${r.stdout.replaceAll(h.dir, "<tmp>")}`);
  log("AC4.md", `base in story branch right after reopen: ${Bun.spawnSync(["git", "merge-base", "--is-ancestor", base, "HEAD"], { cwd: sw }).exitCode === 0}`);
  log("AC4.md", `story state after reopen+tick: `);
  await tick();
  log("AC4.md", JSON.stringify({ step: h.state(runs)?.step, status: h.state(runs)?.status, park: h.state(runs)?.park }));
  expect((await h.norn("run", "rerun", "gh-7")).exit).toBe(0);
  await until(() => h.state(runs)?.status === "running");
  h.report(runs, "done", { outcome: "done", handoff: "built" });
  const bad: unknown[] = [];
  for (let i = 0; i < 6 && h.state(runs)?.step !== "ready"; i++) { const t = await tick(); bad.push(...t.decisions.filter((d) => !d.ok)); }
  log("AC4.md", `after build done: step=${h.state(runs)?.step} status=${h.state(runs)?.status}; failed decisions: ${JSON.stringify(bad)}`);
  log("AC4.md", `base merged into story worktree HEAD: ${Bun.spawnSync(["git", "merge-base", "--is-ancestor", base, "HEAD"], { cwd: sw }).exitCode === 0}; CHANGES.md present: ${existsSync(join(sw, "CHANGES.md"))}`);
  log("AC4.md", h.git(["log", "--format=%s", "-5"], sw));
  h.cleanup();
});

test("AC4 control: same flow without close/reopen", async () => {
  const h = await setup("based", BASED);
  const SPEC = ".agents/specs/gh-7-add-login-form", B = "gh-7-add-login-form";
  const sw = `${h.root}-worktrees/${B}`, runs = join(sw, SPEC, "runs/_story");
  const tick = async () => { h.clock.advance(10_000); return h.tick("--sync"); };
  const until = async (ok: () => boolean) => { for (let i = 0; i < 12 && !ok(); i++) await tick(); expect(ok()).toBe(true); };
  await until(() => h.state(runs)?.run?.session != null);
  await tick();
  const other = join(h.dir, "other");
  sh(h.dir, ["clone", "-q", h.remoteDir, other]); sh(other, ["config", "user.email", "o@e.com"]); sh(other, ["config", "user.name", "O"]);
  h.write(join(other, "CHANGES.md"), "moved\n"); sh(other, ["add", "-A"]); sh(other, ["commit", "-q", "-m", "base moves"]); sh(other, ["push", "-q", "origin", "main"]);
  const base = sh(other, ["rev-parse", "HEAD"]);
  h.report(runs, "done", { outcome: "done", handoff: "built" });
  for (let i = 0; i < 6 && h.state(runs)?.step !== "ready"; i++) await tick();
  log("AC4-control.md", `control: step=${h.state(runs)?.step}; base merged: ${Bun.spawnSync(["git", "merge-base", "--is-ancestor", base, "HEAD"], { cwd: sw }).exitCode === 0}`);
  log("AC4-control.md", h.git(["log", "--format=%s", "-5"], sw));
  h.cleanup();
});
