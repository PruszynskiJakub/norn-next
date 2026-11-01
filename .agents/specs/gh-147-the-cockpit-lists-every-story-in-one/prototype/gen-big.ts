/**
 * PROTOTYPE (throwaway): a synthetic but realistic big cockpit model (~70 stories, ~18 need you) built from
 * the live model.json's rows as templates, like the screenshot's repo a few weeks on. `bun gen-big.ts`
 */
import { readFileSync, writeFileSync } from "node:fs";
import type { CockpitModel, CockpitRow } from "./shared.ts";

const live: CockpitModel = JSON.parse(readFileSync(new URL("./model.json", import.meta.url), "utf8"));
const tmplStory = live.rows.find((r) => r.kind === "story") as CockpitRow;
const tmplApprove = live.rows.find((r) => r.group === "approve") as CockpitRow;
const tmplTurn = live.rows.find((r) => r.group === "your_turn") as CockpitRow;
const tmplSliced = live.rows.find((r) => r.kind === "story" && r.preview.report.slices.length) as CockpitRow;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

const TITLES = [
  "Remove the Claude Code plugin and the sync:plugin release step", "Pin the norn version a repo expects", "norn init run from a git worktree sets up the main checkout",
  "norn init should create the workflows folder", "Triage posts its findings on the issue", "Rename story.md to spec.md", "Approving triage's confirm gate starts the next workflow",
  "A workflow can merge its own PR", "An issue body edited after intake is not seen", "Rename the core noun \"story\" in the CLI help", "Regroup the CLI around status, story and run",
  "Claim renewals push one ref per tick", "A check runs inside the tick and blocks it", "A tick mid-rebase acts on a half-written tree", "Integrate's rebase drops the slice's last commit",
  "Split the test command so slices run only their tier", "A story merged while parked stays parked", "Release 0.11.0", "A new unit worktree has no dependencies installed",
  "A second agent session in a worktree double-reports", "quick and story check fast before the slow tiers", "Intake: triage stays the default for features", "Release: drop confirm-version and the local test",
  "Cockpit: filter by workflow", "The handoff top is regenerated on every brief", "norn doctor flags a stale shim", "Herdr tab bar shows the oldest wait", "Ask from a slice reaches the story's orient",
  "Corrupt state.json names the field that failed", "Headless runner: stream the agent's last line", "Notes survive a rework of the step that wrote them", "Gate reject keeps the PR draft",
  "GitLab: open-pr sets the MR's labels", "Mailbox answers survive a holder switch", "Slices wait for their dependencies' integrate", "Base sync skips a story with a dirty worktree",
  "Trace view shows the decision's facts on demand", "Release 0.12.0", "Release 0.13.0", "Release 0.14.0", "Story chat opens in the story worktree", "A stuck check shows its last 20 lines",
  "Workflow lint: an unreachable step is an error", "status --segment orders orient workspaces", "Codex adapter: hook facts from its transcript", "Gemini adapter: permission prompts park the unit",
  "Lease files carry the pid's start time", "tidy removes worktrees of closed stories", "Auto mode recovery reopens the session", "norn story edit --at refuses a step of another workflow",
  "Explain why a unit is waiting in story view", "The brief lists the open notes of the unit", "Cockpit: approve from the preview", "QA evidence pack links screenshots",
  "Human-qa gate shows the criteria report", "Plan step writes the coverage table", "Golden harvest skips duplicate cases", "Effect transcript normalises pids", "Observe snapshot at a parked ask",
  "Contract suite for the opencode runner", "Story list --json carries the phase", "Stale heartbeat warning in the header", "Retry a failed push with backoff", "Prune old receipts on done",
  "Cockpit mouse wheel over the list", "Release 0.15.0", "Release 0.16.0", "Dependabot PRs skip the process check",
];

// [workflow, unit status, step, story_status, slices?, pr?, need-you group?]
type Spec = [string, string, string | null, "active" | "done", number, boolean, string | null];
const SPECS: Spec[] = [];
const add = (n: number, s: Spec) => { for (let i = 0; i < n; i++) SPECS.push(s); };
add(26, ["quick", "not_started", null, "done", 0, true, null]); // closed history
add(6, ["release", "not_started", null, "done", 0, true, null]);
add(3, ["story", "done", "$done", "done", 4, true, null]);
add(8, ["triage", "ready", "explore", "active", 0, false, "your_turn"]); // manual starts pile up
add(2, ["triage", "parked", "confirm", "active", 0, false, "approve"]);
add(1, ["reproduce", "running", "reproduce", "active", 0, false, null]);
add(1, ["reproduce", "parked", "confirm", "active", 0, false, "approve"]);
add(2, ["story", "parked", "refine", "active", 0, false, "your_turn"]);
add(1, ["story", "parked", "clarify", "active", 0, false, "answer"]);
add(1, ["story", "running", "plan", "active", 0, false, null]);
add(1, ["story", "parked", "approve-plan", "active", 0, false, "approve"]);
add(2, ["story", "running", "slices", "active", 6, false, null]);
add(1, ["story", "stuck", "slices", "active", 5, false, "unblock"]);
add(3, ["quick", "running", "implement", "active", 0, false, null]);
add(1, ["quick", "stuck", "test", "active", 0, false, "unblock"]);
add(1, ["quick", "running", "ci", "active", 0, true, null]);
add(4, ["quick", "parked", "ready", "active", 0, true, "approve"]);
add(1, ["story", "parked", "human-qa", "active", 3, true, "check"]);
add(1, ["release", "parked", "ready", "active", 0, true, "approve"]);
add(2, ["story", "not_started", null, "active", 0, false, null]); // unclaimed backlog

const AGES = ["58s", "7m", "32m", "1h", "3h", "5h", "16h", "21h", "22h", "23h", "1d", "2d", "4d"];
const rows: CockpitRow[] = [];
const items: CockpitRow[] = [];
SPECS.forEach(([wf, status, step, storyStatus, nSlices, hasPr, group], i) => {
  const n = 40 + i * 2;
  const key = `gh-${n}`;
  const title = TITLES[i % TITLES.length] as string;
  const r = clone(tmplStory);
  r.id = `story:${key}`; r.story = key; r.unit = key; r.title = title; r.step = step;
  const rep = r.preview.report;
  Object.assign(rep, { key, story: key, title, story_status: storyStatus, url: `https://github.com/PruszynskiJakub/norn-next/issues/${n}`, claim: status === "not_started" ? "unclaimed" : "held here", mode: group === "your_turn" && wf === "triage" ? "manual" : "auto" });
  rep.branch = `${key}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}`;
  rep.unit = { ...rep.unit, key, title, status: status as any, workflow: wf, step, attempt: status === "not_started" ? null : 1, last_outcome: null };
  rep.pr = hasPr ? { number: n + 300, url: `https://github.com/PruszynskiJakub/norn-next/pull/${n + 300}`, state: storyStatus === "done" ? "merged" : "open", is_draft: storyStatus !== "done", seen_at: new Date(Date.now() - 3600e3).toISOString() } as any : null;
  rep.slices = nSlices ? Array.from({ length: nSlices }, (_, j) => {
    const base = clone(tmplSliced.preview.report.slices[j % tmplSliced.preview.report.slices.length]) as any;
    const done = storyStatus === "done" || j < nSlices - 3;
    return { ...base, key: `${key}/0${j + 1}`, status: done ? "done" : j === nSlices - 3 ? (status === "stuck" ? "stuck" : "running") : j === nSlices - 2 ? "ready" : "not_started", step: done ? "$done" : j === nSlices - 3 ? "review" : null };
  }) : [];
  rep.running = status === "running" ? [{ group: "running", unit: nSlices ? `${key}/0${nSlices - 2}` : key, step: nSlices ? "review" : step, title: `${step} #1 (auto)`, command: `norn run list ${key}`, age: AGES[i % 5] as string }] : [];
  rep.waiting = [];
  r.actions = r.actions.filter((a) => a.id !== "take" || status === "not_started");
  if (rep.pr) r.actions.push({ id: "pr", label: "PR", key: "o", effect: { kind: "link", url: rep.pr.url } });
  rows.push(r);
  if (group) {
    const t = clone(group === "your_turn" ? tmplTurn : tmplApprove);
    const age = AGES[(i * 7) % AGES.length] as string;
    t.id = `${group}:${key}:${step}#1`; t.group = group as any; t.story = key; t.unit = key; t.step = step; t.age = age;
    t.title = {
      your_turn: step === "explore" ? "explore is ready (manual): start an agent in the worktree" : `${step}: attended step — work with the agent in its pane`,
      answer: "clarify asks: should the cockpit hide closed stories by default, or behind a key?",
      approve: step === "ready" ? "Read the draft PR. Approve to mark the story finished (a person still merges the PR), or reject with what to change." : step === "approve-plan" ? "Read the plan and the slices. Approve to start building, or reject with what to change." : "Read the triage findings and the recommendation. Approve to move on, or reject.",
      unblock: `${step} is stuck: the check failed 3 times — read the trace, fix, then unstick`,
      check: "Check the QA evidence pack against the criteria; pass or fail each one.",
    }[group] as string;
    t.preview.report = rep; t.preview.item = { ...t.preview.item!, title: t.title, command: { your_turn: `norn story start ${key}`, answer: `norn story answer ${key} "…"`, approve: `norn story approve ${key}`, unblock: `norn run rerun ${key}`, check: `norn story view ${key}` }[group] as string };
    rep.waiting = [{ group: group as any, unit: key, step, title: t.title, command: t.preview.item.command, age }];
    t.actions = [r.actions[0]!, ...(group === "approve" ? [{ id: "approve", label: "approve", key: "y", effect: { kind: "verb", argv: ["story", "approve", key] } }, { id: "reject", label: "reject", key: "x", input: { prompt: "What to change", required: true }, effect: { kind: "verb", argv: ["story", "reject", key, "--reason", "{input}"] } }] : group === "answer" ? [{ id: "answer", label: "answer", key: "a", input: { prompt: "Your answer", required: true }, effect: { kind: "verb", argv: ["story", "answer", key, "{input}"] } }] : group === "unblock" ? [{ id: "unstick", label: "unstick", key: "u", effect: { kind: "verb", argv: ["run", "rerun", key] } }] : group === "your_turn" ? [{ id: "start", label: "start", key: "s", effect: { kind: "verb", argv: ["story", "start", key] } }] : []), ...r.actions.slice(1).filter((a) => a.id !== "take")] as any;
    items.push(t);
  }
});
// inbox order: by group as O1, then oldest first is how the real one reads; keep group order
// the templates' text and actions name their own stories: point every one at its row's story
const retarget = (r: CockpitRow) => {
  const k = r.story, n = k.slice(3);
  r.actions = JSON.parse(JSON.stringify(r.actions).replace(/gh-\d+/g, k).replace(/issues\/\d+/g, `issues/${n}`));
  const it = r.preview.item;
  if (it) {
    it.detail = r.group === "approve" ? `step ${r.step === "ready" ? "ci" : "explore"}#1 reported pass · or reject: norn story reject ${k} --reason "…"` : r.group === "your_turn" ? `by hand: cd ~/Projects/norn-worktrees/${r.preview.report.branch} && claude -- 'Use the norn skill, then run \`norn brief\`.'` : undefined;
    delete it.full;
  }
};
rows.forEach(retarget); items.forEach(retarget);
const ORDER = ["your_turn", "answer", "approve", "unblock", "check"];
items.sort((a, b) => ORDER.indexOf(a.group!) - ORDER.indexOf(b.group!));
rows.sort((a, b) => Number(a.story.slice(3)) - Number(b.story.slice(3)));
const model: CockpitModel = { ...live, header: { ...live.header, pending: items.length }, rows: [...items, ...rows] };
writeFileSync(new URL("./big.json", import.meta.url), JSON.stringify(model, null, 1));
console.log(`big.json: ${rows.length} stories, ${items.length} need you`);

