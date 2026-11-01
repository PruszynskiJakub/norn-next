import { appendFileSync, cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repoConfigPath, workflowsDir, storyUnitDir } from "/Users/jakubpruszynski/Projects/norn-worktrees/gh-71-approving-triage-s-confirm-gate-ends-the/packages/store/src/index.ts";
import { createHarness, type Harness, issue } from "/Users/jakubpruszynski/Projects/norn-worktrees/gh-71-approving-triage-s-confirm-gate-ends-the/test/support/harness.ts";
export { issue, storyUnitDir };
export const R = "/Users/jakubpruszynski/Projects/norn-worktrees/gh-71-approving-triage-s-confirm-gate-ends-the";
export const EV = process.env.EV!;
export const CONFIG = `agents:
  claude: { adapter: claude }
runner: { adapter: headless }
remote: { provider: gh, label: norn }
default_workflow: triage
default_mode: auto
notifiers: []
`;
export async function setup(): Promise<Harness> {
  const t = await createHarness();
  const i = await t.norn("init");
  if (i.exit !== 0) throw new Error(i.stdout);
  t.write(repoConfigPath(t.root), CONFIG);
  for (const [w, y] of Object.entries(WF)) writeFileSync(join(workflowsDir(t.root), w + ".yaml"), y);
  t.git(["add", "-A"]); t.git(["commit", "-q", "-m", "norn init"]); t.git(["push", "-q", "origin", "main"]);
  return t;
}
export function log(file: string, title: string, body: unknown) {
  mkdirSync(EV, { recursive: true });
  const text = typeof body === "string" ? body : JSON.stringify(body, null, 2);
  appendFileSync(join(EV, file), "\n### " + title + "\n\n```\n" + text.replace(/\/[^ \n"']*norn-cli-[A-Za-z0-9]+/g, "<TMP>") + "\n```\n");
}
export async function cmd(t: Harness, file: string, ...argv: string[]) {
  const r = await t.norn(...argv);
  log(file, "$ norn " + argv.join(" ") + "   (exit " + r.exit + ")", r.stdout + (r.stderr ? "\nSTDERR: " + r.stderr : ""));
  return r;
}
export function tree(t: Harness, file: string, dir: string, title = "files") {
  const out = Bun.spawnSync(["find", ".", "-type", "f", "-not", "-path", "*/logs/*"], { cwd: dir }).stdout.toString().split("\n").sort().join("\n");
  log(file, title + " under " + dir.replace(t.dir, "<TMP>"), out);
}

export const WF: Record<string, string> = {
triage: `name: triage
start: explore
steps:
  explore:
    type: agent
    skill: norn-qa
    outcomes: { story: { to: confirm, means: "deliver it as a story" }, close: { to: confirm, means: "close it" } }
  confirm:
    type: gate
    prompt: "Confirm the triage"
    outcomes: { approve: $done, reject: { to: explore, counter: triage_loop } }
counters: { triage_loop: { max: 2 } }
`,
story: `name: story
start: refine
steps:
  refine:
    type: agent
    skill: norn-refine
    outcomes: { done: { to: plan, means: "spec written" } }
  plan:
    type: agent
    skill: norn-plan
    outcomes: { done: { to: slices, means: "planned" } }
  slices:
    type: slices
    outcomes: { done: open-pr, stuck: $stuck }
  open-pr:
    type: git
    action: open-pr
    outcomes: { done: ready }
  ready:
    type: gate
    prompt: "Merge the PR"
    outcomes: { approve: $done, reject: { to: refine, counter: fix } }
counters: { fix: { max: 3 } }
`,
quick: `name: quick
start: sync
steps:
  sync:
    type: agent
    skill: norn-implement
    outcomes: { done: { to: work, means: "synced" } }
  work:
    type: agent
    skill: norn-implement
    outcomes: { done: { to: open-pr, means: "changed" }, stuck: $stuck }
  open-pr:
    type: git
    action: open-pr
    outcomes: { done: ready }
  ready:
    type: gate
    prompt: "Merge the PR"
    outcomes: { approve: $done, reject: { to: work, counter: back } }
counters: { back: { max: 2 } }
`,
slice: `name: slice
start: build
steps:
  build:
    type: agent
    skill: norn-implement
    outcomes: { done: { to: $done, means: "built" } }
`,
};
