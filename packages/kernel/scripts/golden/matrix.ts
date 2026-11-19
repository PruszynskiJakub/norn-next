/**
 * Golden scenarios for the moments a whole story rarely passes through: claims held elsewhere,
 * corrupt records, a store shared between machines, stories ended from outside, workflows and slice
 * plans that fail, and every way an agent run can stall, each set up the way a host would find it.
 */
import { loadWorkflow, type RunState } from "../../src/index.ts";
import type { GoldenCase } from "../../test/golden.ts";
import { STEP_KINDS } from "../../test/shipped.ts";
import { capabilities, caseOf, claim, config, DEPLOY_DOC, executor, item, ROUTED_DOC, type Seed, seed, shippedFiles, type WorldSetup, world } from "./catalog.ts";
import type { Scenario } from "./journeys.ts";
import { session, type World } from "./world.ts";

/** Seed several stories, tick `ticks` times, and keep every tick, checking each expected rule fired somewhere. */
function scenario(name: string, description: string, setup: WorldSetup, build: (w: World) => void, expected: string[], ticks = 1): Scenario {
  return {
    name,
    build(): GoldenCase[] {
      const w = world(setup);
      build(w);
      for (let i = 0; i < ticks; i++) w.tick();
      const fired = new Set(w.ticks.flatMap((t) => t.decisions.map((d) => d.rule)));
      const missing = expected.filter((r) => !fired.has(r));
      if (missing.length) throw new Error(`${name}: expected ${missing.join(", ")} to fire; fired ${[...fired].join(", ")}`);
      return w.ticks.map((t) => caseOf(w, t, w.ticks.length > 1 ? `${name}-${t.n}` : name, w.ticks.length > 1 ? `${description} Tick ${t.n}.` : description));
    },
  };
}

const SLICE = (): WorldSetup => ({ files: shippedFiles("slice") });

/** The run state as seeded, for a scenario to adjust before the first tick. */
function adjust(w: World, id: string, patch: (s: RunState) => RunState): void {
  const u = w.unit(id);
  if (u.state) u.state = patch(u.state);
}

function quietStory(w: World, key: string, s: Partial<Seed>, sess: ReturnType<typeof session>): void {
  seed(w, key, { workflow: "slice", step: "implement", run: {}, ...s });
  w.unit(key).session = sess;
}

/** A step that routes `stalled` apart from `silent`: an agent with no activity goes to a person, one that ended its turn quietly is sent back. */
const STALLED_DOC = {
  name: "stalled",
  description: "An agent step that routes a stalled agent to a person and a silent one back to work.",
  start: "work",
  steps: {
    work: {
      agent: "Do the work.",
      skills: ["norn-implement"],
      outcomes: { done: "$done", stalled: "triage", silent: "work" },
      means: { done: "the work is done" },
    },
    triage: { gate: "The agent stalled. Approve to end the round, or reject to leave it stuck.", outcomes: { approve: "$done", reject: "$stuck" } },
  },
};

const later = (w: World, minutes: number) => new Date(w.now + minutes * 60_000).toISOString();
const earlier = (w: World, minutes: number) => new Date(w.now - minutes * 60_000).toISOString();

export const MATRIX: Scenario[] = [
  scenario(
    "claims",
    "Claims as a host finds them: a story another machine holds, one whose other holder let its claim expire (left to a person), one in progress with no claim at all, and one whose claim this machine let expire.",
    SLICE(),
    (w) => {
      seed(w, "gh-60", { workflow: "slice", step: "implement", claim: claim(w, "gh-60", { holder: "machine-b" }) });
      seed(w, "gh-61", { workflow: "slice", step: "test", claim: claim(w, "gh-61", { holder: "machine-b", expires_at: earlier(w, 5) }) });
      seed(w, "gh-62", { workflow: "slice", step: "review", claim: null });
      seed(w, "gh-63", { workflow: "slice", step: "implement", claim: claim(w, "gh-63", { expires_at: earlier(w, 1) }) });
    },
    ["claim.held_elsewhere", "claim.none", "claim.reacquire", "claim.pending"],
  ),
  scenario(
    "shared-store",
    "A store shared between machines: each held story's run data is flushed after its decisions; another machine's gate decision arrives through the mailbox and is imported, a letter that fails validation is refused, and the imported decision is applied on the next tick.",
    { files: shippedFiles("quick"), capabilities: capabilities({ store: { shared: true, claims: "distributed" } }) },
    (w) => {
      seed(w, "gh-50", { workflow: "quick", step: "ready" });
      w.tick();
      w.story("gh-50").mailbox = [
        { id: "m-1", from: "machine-b", at: w.iso(), data: { unit: "gh-50", receipt: { kind: "gate.decided", outcome: "approve", by: "person", step: "ready", attempt: 1 } } },
        { id: "m-2", from: "machine-b", at: w.iso(), data: { unit: "gh-50", receipt: { kind: "gate.decided", outcome: "lgtm" } } },
      ];
    },
    ["store.flush", "gate.park", "mailbox.import", "mailbox.reject", "receipts.apply", "step.run"],
    3,
  ),
  scenario(
    "corrupt",
    "Records decide never guesses at: a unit whose record failed validation, one already marked corrupt, and one pinning a workflow version no longer loaded, which is marked corrupt and then held.",
    SLICE(),
    (w) => {
      seed(w, "gh-70", { workflow: "slice", step: "implement" });
      w.unit("gh-70").corrupt = "receipt 4 (01JD...): /data/outcome must be string";
      seed(w, "gh-71", { workflow: "slice", step: "test", state: { ended: "corrupt", ended_reason: "run state v3: /step must match pattern" } });
      seed(w, "gh-72", { workflow: "slice", step: "test" });
      const files = shippedFiles("slice") as { slice: { steps: { test: { timeout: string } } } };
      files.slice.steps.test.timeout = "5m";
      const older = loadWorkflow(files.slice, { stepKinds: STEP_KINDS, sharedFiles: {}, config: config() });
      if (!older.ok) throw new Error("the older slice workflow fails to load");
      adjust(w, "gh-72", (s) => ({ ...s, workflow: older.workflow.pinned }));
    },
    ["unit.corrupt", "unit.corrupt.held", "unit.workflow_missing"],
    2,
  ),
  scenario(
    "corrupt-marked",
    "A record that fails validation is marked once: the mark is a receipt the record keeps beside what failed, read back as corrupt_marked, so the next tick holds the unit instead of marking it again.",
    SLICE(),
    (w) => {
      seed(w, "gh-73", { workflow: "slice", step: "implement" });
      w.unit("gh-73").corrupt = "run state v2: /attempt must be >= 1";
    },
    ["unit.corrupt", "unit.corrupt.held"],
    2,
  ),
  scenario(
    "ended-while-running",
    "Stories ended from outside while a run is live: a merged change with an agent at work and a closed item with a check running each stop the run first, the order recorded, then mark the unit the tick after with the order applied; a run already over is marked at once.",
    SLICE(),
    (w) => {
      w.manual.add("gh-83");
      seed(w, "gh-83", { workflow: "slice", step: "implement", run: {} });
      w.unit("gh-83").session = session("working");
      w.story("gh-83").change = { id: 7, url: "https://forge.example/pr/7", state: "merged", draft: false, head_branch: "gh-83-x", base_branch: "main", head_sha: "c7", merge_sha: "m7", merged_at: w.iso(), title: "Story 83" };
      seed(w, "gh-84", { workflow: "slice", step: "test", run: { executor: "check" }, item: item(84, "Story 84", { open: false }) });
      w.unit("gh-84").step_run = { kind: "check", running: true };
      seed(w, "gh-85", { workflow: "slice", step: "implement", run: {}, item: item(85, "Story 85", { open: false }) });
      w.unit("gh-85").session = session("ended");
      w.manual.add("gh-85");
    },
    ["story.change_merged.stop", "story.item_closed.stop", "story.change_merged", "story.item_closed"],
    3,
  ),
  scenario(
    "park-once",
    "Parks are receipts: a story whose workflow fails to load keeps the park's receipt alone and is held on the next tick rather than parked again; a gate's park commits the state that applies its receipt, and the next tick holds it.",
    { files: { ...shippedFiles("quick"), deploy: DEPLOY_DOC }, config: config({ workflow: "deploy" }) },
    (w) => {
      w.stories.push({ key: "gh-96", item: item(96, "Deploy the docs site"), change: null, claim: claim(w, "gh-96"), units: [], mailbox: [] });
      seed(w, "gh-97", { workflow: "quick", step: "ready" });
    },
    ["round.workflow_invalid", "gate.park", "unit.parked"],
    2,
  ),
  scenario(
    "refusal-recorded",
    "A refusal is written in the act that refused it and applied with it: a report from a run already replaced is refused onto the record, and the next tick has nothing left to apply.",
    { files: shippedFiles("quick") },
    (w) => {
      w.manual.add("gh-107");
      seed(w, "gh-107", { workflow: "quick", step: "review", run: {} });
      w.unit("gh-107").session = session("working");
      w.append("gh-107", { kind: "run.reported", run_id: "run-replaced", verb: "done", outcome: "approve", step: "review", attempt: 1 });
    },
    ["receipts.reject", "agent.running"],
    2,
  ),
  scenario(
    "agent-stalled-route",
    "A step that routes stalled: an agent with no activity takes the stalled route to a person, while one that ended its turn without a report takes the silent route back to work.",
    { files: { stalled: STALLED_DOC } },
    (w) => {
      quietStory(w, "gh-136", { workflow: "stalled", step: "work" }, session("working", { silent: true }));
      quietStory(w, "gh-137", { workflow: "stalled", step: "work" }, session("turn_ended"));
    },
    ["agent.stalled.route", "agent.turn_ended.route"],
  ),
  scenario(
    "story-ended-outside",
    "Stories ended from outside the workflow: an item closed mid-round marks the unit stuck, a change closed without merging parks the story for a person, and a story whose item closed before it started has nothing to do.",
    SLICE(),
    (w) => {
      seed(w, "gh-80", { workflow: "slice", step: "implement", item: item(80, "Story 80", { open: false }) });
      seed(w, "gh-81", { workflow: "slice", step: "review" });
      w.story("gh-81").change = { id: 3, url: "https://forge.example/pr/3", state: "closed", draft: true, head_branch: "gh-81-x", base_branch: "main", head_sha: "c3", title: "Story 81" };
      w.stories.push({ key: "gh-82", item: item(82, "Story 82", { open: false }), change: null, claim: claim(w, "gh-82"), units: [{ id: "gh-82", state: null, version: null, receipts: [], session: null }], mailbox: [] });
    },
    ["story.item_closed", "story.change_closed", "story.ended"],
  ),
  scenario(
    "workflow-invalid",
    "A story taken in while the configured workflow names a step kind no plugin provides: its round does not start, and the story waits for a person with the missing kind named.",
    { files: { ...shippedFiles("slice"), deploy: DEPLOY_DOC }, config: config({ workflow: "deploy" }) },
    (w) => {
      w.stories.push({ key: "gh-90", item: item(90, "Deploy the docs site"), change: null, claim: claim(w, "gh-90"), units: [], mailbox: [] });
    },
    ["round.workflow_invalid"],
  ),
  scenario(
    "slice-plans",
    "The story's slices step against slice plans that cannot run: no slice files, files that fail validation, slices that wait on each other, a slice naming a workflow that fails to load, and a planned slice not started yet.",
    { files: { ...shippedFiles("story", "slice"), deploy: DEPLOY_DOC } },
    (w) => {
      for (const key of ["gh-91", "gh-92", "gh-93", "gh-94", "gh-95"]) seed(w, key, { step: "slices" });
      w.story("gh-91").plan = { slices: [] };
      w.story("gh-92").plan = { slices: [], invalid: "slices/02-export.md: depends_on names 07, which is no slice" };
      w.story("gh-93").plan = {
        slices: [
          { unit: "gh-93/01", depends_on: ["gh-93/02"] },
          { unit: "gh-93/02", depends_on: ["gh-93/01"] },
        ],
      };
      w.story("gh-94").plan = { slices: [{ unit: "gh-94/01", depends_on: [], workflow: "deploy" }] };
      w.story("gh-95").plan = {
        slices: [
          { unit: "gh-95/01", depends_on: [] },
          { unit: "gh-95/02", depends_on: ["gh-95/01"] },
        ],
      };
      seed(w, "gh-95", { workflow: "slice", step: "implement", unit: "gh-95/01", run: {} });
      w.unit("gh-95/01").session = session("working");
      w.story("gh-95").units.push({ id: "gh-95/02", state: null, version: null, receipts: [], session: null });
    },
    ["slices.none", "slices.plan_invalid", "slices.blocked", "slices.workflow_invalid", "slice.not_started", "slices.wait"],
  ),
  scenario(
    "steps-in-flight",
    "Checks, plugin steps and gates mid-flight: a check still running, one recorded but never answered (run again under its run), an effect step running and one cut short, a gate whose base moved, a park whose cause is gone, and a report from a run already replaced.",
    { files: shippedFiles("quick") },
    (w) => {
      seed(w, "gh-100", { workflow: "quick", step: "test", run: { executor: "check" } });
      w.unit("gh-100").step_run = { kind: "check", running: true };
      seed(w, "gh-101", { workflow: "quick", step: "test", run: { executor: "check" } });
      seed(w, "gh-102", { workflow: "quick", step: "open-pr", run: { executor: "open-pr" } });
      w.unit("gh-102").step_run = { kind: "open-pr", running: true };
      seed(w, "gh-103", { workflow: "quick", step: "update", run: { executor: "update-branch" } });
      seed(w, "gh-104", { workflow: "quick", step: "ready" });
      w.story("gh-104").base_stale = true;
      seed(w, "gh-105", { workflow: "quick", step: "implement", run: {}, state: { parked: { reason: "agent.asking.park", since: earlier(w, 10) } } });
      w.unit("gh-105").session = session("working");
      seed(w, "gh-106", { workflow: "quick", step: "review", run: {} });
      w.unit("gh-106").session = session("working");
      w.append("gh-106", { kind: "run.reported", run_id: "run-replaced", verb: "done", outcome: "approve", step: "review", attempt: 1 });
    },
    ["check.running", "check.rerun", "step.running", "step.resume", "gate.stale", "unit.unpark", "receipts.reject"],
  ),
  scenario(
    "agent-capacity",
    "Agent capacity: with room for one agent run, the first ready story starts and the second waits its turn.",
    { files: shippedFiles("slice"), config: config({ maxAgents: 1 }) },
    (w) => {
      seed(w, "gh-110", { workflow: "slice", step: "implement" });
      seed(w, "gh-111", { workflow: "slice", step: "implement" });
    },
    ["agent.start", "agent.queued"],
  ),
  scenario(
    "check-capacity",
    "Check capacity: with room for one run, a check takes the slot and the next due check waits its turn.",
    { files: shippedFiles("slice"), config: config({ maxAgents: 1 }) },
    (w) => {
      seed(w, "gh-112", { workflow: "slice", step: "test" });
      seed(w, "gh-113", { workflow: "slice", step: "test" });
    },
    ["check.run", "check.queued"],
  ),
  scenario(
    "agent-no-executor",
    "A ready agent step whose executor is configured nowhere: the story waits for a person rather than starting on a guess.",
    { files: shippedFiles("slice"), config: config({ executor: "codex" }) },
    (w) => seed(w, "gh-112", { workflow: "slice", step: "implement" }),
    ["agent.no_executor"],
  ),
  scenario(
    "agent-not-headless",
    "An executor that cannot run headless: in auto mode a ready step waits for a person, and a run that died cannot be retried in a fresh session without one.",
    { files: shippedFiles("slice"), capabilities: capabilities({ executors: { claude: executor({ headless: false }) } }) },
    (w) => {
      seed(w, "gh-113", { workflow: "slice", step: "implement" });
      quietStory(w, "gh-114", {}, session("ended"));
    },
    ["agent.ready.no_headless", "agent.retry.no_headless"],
  ),
  scenario(
    "agent-attended",
    "Attended steps: refinement's refine step always waits for a person, whatever the mode.",
    { files: shippedFiles("refinement") },
    (w) => seed(w, "gh-115", { workflow: "refinement", step: "refine" }),
    ["agent.ready.attended"],
  ),
  scenario(
    "agent-sessions",
    "Agent runs a session holds up: a permission prompt parks for a person, a run past its deadline is stopped, the order recorded, and then retried as a dead session, and in manual mode a dead session waits for the person driving it.",
    SLICE(),
    (w) => {
      quietStory(w, "gh-120", {}, session("permission", { permission: { id: "p-1", prompt: "Allow `rm -rf dist`?" } }));
      quietStory(w, "gh-121", { run: { minutesAgo: 70 } }, session("working"));
      quietStory(w, "gh-122", { state: { mode: "manual" } }, session("ended"));
    },
    ["agent.permission.park", "agent.timeout", "agent.died.retry", "agent.died.manual"],
    3,
  ),
  scenario(
    "agent-silent-pane",
    "An agent alive in its pane that has sent no event past the silent window (its hooks never loaded, as behind a trust dialog) parks for a person rather than being retried into the same dialog in a fresh pane; one whose process is gone is dead and retried as before.",
    { files: shippedFiles("slice"), capabilities: capabilities({ executors: { claude: executor({ paneInput: true, dialogKeys: true }) } }) },
    (w) => {
      seed(w, "gh-123", { workflow: "slice", step: "implement", run: { minutesAgo: 20 } });
      w.unit("gh-123").run_alive = true;
      seed(w, "gh-124", { workflow: "slice", step: "implement", run: { minutesAgo: 20 } });
      w.unit("gh-124").run_alive = false;
    },
    ["agent.no_events.park", "agent.died.retry"],
  ),
  scenario(
    "agent-answer-undelivered",
    "An answer to a headless session that ended after asking, on an executor that cannot resume a session: the answer is applied without delivery (so the unit unparks rather than refusing delivery every tick), and the next tick retries the run in a fresh session. An executor that resumes sessions gets the answer delivered as usual (the model host resumes nothing, so its ended session is retried on the next tick too).",
    { files: shippedFiles("slice"), capabilities: capabilities({ executors: { claude: executor(), resumer: executor({ resume: true }) } }) },
    (w) => {
      const parked = { parked: { reason: "implement: the agent asks a question", since: earlier(w, 10) } };
      quietStory(w, "gh-118", { run: { session: "h-118" }, state: parked }, session("ended"));
      w.append("gh-118", { kind: "answer.sent", input_id: "q-118", text: "Use the main branch.", by: "person" });
      quietStory(w, "gh-119", { run: { session: "h-119", executor: "resumer" }, state: parked }, session("ended"));
      w.append("gh-119", { kind: "answer.sent", input_id: "q-119", text: "Use the main branch.", by: "person" });
    },
    ["receipts.apply.undelivered", "receipts.apply", "agent.died.retry"],
    2,
  ),
  scenario(
    "agent-routed",
    "A step that routes the outcomes norn classifies: a question, a dead session, a run past its deadline and a silent agent each take the step's route to a person's gate instead of the built-in handling.",
    { files: { routed: ROUTED_DOC } },
    (w) => {
      quietStory(w, "gh-130", { workflow: "routed", step: "work" }, session("asking", { ask: { id: "q-2", question: "Which branch?" } }));
      quietStory(w, "gh-131", { workflow: "routed", step: "work" }, session("ended"));
      quietStory(w, "gh-132", { workflow: "routed", step: "work", run: { minutesAgo: 75 } }, session("working"));
      quietStory(w, "gh-133", { workflow: "routed", step: "work" }, session("working", { silent: true }));
      quietStory(w, "gh-134", { workflow: "routed", step: "work" }, session("turn_ended"));
      quietStory(w, "gh-135", { workflow: "routed", step: "work" }, session("limited", { limit: { kind: "usage", resets_at: earlier(w, 1) } }));
    },
    ["agent.ask.route", "agent.died.route", "agent.timeout.route", "agent.silent.route", "agent.turn_ended.route", "agent.limited.route"],
  ),
  scenario(
    "agent-quiet",
    "Quiet agents, each way: a silent agent, one that ended its turn without a report, and one back from a usage limit are nudged while nudges last, left alone while a nudge is on its way, handed to a person in manual mode, retried in a fresh session when the executor takes no input, and ended stuck once nudges run out; a limit not reset yet has its reset recorded.",
    { files: shippedFiles("slice"), capabilities: capabilities({ executors: { claude: executor(), plain: executor({ injectContext: false, paneInput: false }) } }) },
    (w) => {
      const kinds = {
        silent: () => session("working", { silent: true }),
        turn_ended: () => session("turn_ended"),
        limited: () => session("limited", { limit: { kind: "usage", resets_at: earlier(w, 2) } }),
      };
      let n = 140;
      for (const make of Object.values(kinds)) {
        quietStory(w, `gh-${n++}`, {}, make());
        quietStory(w, `gh-${n++}`, { run: { nudges: 1, last_nudge_at: earlier(w, 3) } }, make());
        quietStory(w, `gh-${n++}`, { state: { mode: "manual" } }, make());
        quietStory(w, `gh-${n++}`, { run: { nudges: 2, last_nudge_at: earlier(w, 30) } }, make());
        quietStory(w, `gh-${n++}`, { run: { executor: "plain" } }, make());
      }
      quietStory(w, `gh-${n++}`, {}, session("limited", { limit: { kind: "usage", resets_at: later(w, 30) } }));
    },
    [
      ...["agent.silent", "agent.turn_ended", "agent.limited"].flatMap((b) => [`${b}.nudge`, `${b}.nudged`, `${b}.manual`, `${b}.exhausted`, `${b}.retry`]),
      "agent.limited.record",
    ],
  ),
  scenario(
    "intake-labels",
    "Intake reads a workflow label once, as the person's choice: an item labelled with a loaded workflow takes it, one labelled with a workflow that is not loaded and one with no label take the config's.",
    { files: shippedFiles("story", "quick") },
    (w) => {
      w.intake.push(item(160, "Fix the typo", { labels: ["norn", "norn:wf:quick"] }), item(161, "Try a deploy", { labels: ["norn:wf:deploy"] }), item(162, "Sign in with a passkey"));
    },
    ["intake.story"],
  ),
  scenario(
    "unpushed",
    "A story whose branch holds commits its change lacks: waiting at the ready gate or polled at merge, it goes back to open-pr to push them; a slice is never sent, since only the story pushes its change.",
    { files: shippedFiles("quick", "slice") },
    (w) => {
      seed(w, "gh-170", { workflow: "quick", step: "ready" });
      w.story("gh-170").unpushed = true;
      seed(w, "gh-171", { workflow: "quick", step: "merge", run: { executor: "await-merge" } });
      w.unit("gh-171").step_run = { kind: "await-merge", running: false, outcome: "waiting" };
      w.story("gh-171").unpushed = true;
    },
    ["gate.unpushed", "step.unpushed"],
  ),
  scenario(
    "base-stale-at-merge",
    "A story polled at merge whose base the host reads as stale (a conflicting move, or a clean one that failed base.verify) goes back through its stale route; one whose base only moved clean keeps waiting.",
    { files: shippedFiles("quick") },
    (w) => {
      seed(w, "gh-175", { workflow: "quick", step: "merge", run: { executor: "await-merge" } });
      w.unit("gh-175").step_run = { kind: "await-merge", running: false, outcome: "waiting" };
      w.story("gh-175").base_stale = true;
      seed(w, "gh-176", { workflow: "quick", step: "merge", run: { executor: "await-merge" } });
      w.unit("gh-176").step_run = { kind: "await-merge", running: false, outcome: "waiting" };
      w.story("gh-176").base_stale = false;
    },
    ["step.stale", "step.poll"],
  ),
  scenario(
    "change-closed-at-merge",
    "A person closes the story's change while it is polled at merge: the story parks for them, once, rather than polling a closed change forever or opening a new one.",
    { files: shippedFiles("quick") },
    (w) => {
      seed(w, "gh-177", { workflow: "quick", step: "merge", run: { executor: "await-merge" } });
      w.unit("gh-177").step_run = { kind: "await-merge", running: false, outcome: "waiting" };
      w.story("gh-177").change = { id: 77, state: "closed", draft: false, head_branch: "norn/gh-177", base_branch: "main", head_sha: "a77", title: "Story 177" };
    },
    ["story.change_closed", "unit.parked"],
    2,
  ),
  scenario(
    "steps-cut-short",
    "Runs that keep ending without an answer decide accepts: a check and an effect step cut short with their retries spent end the unit stuck, naming the limit; a check, a plugin step and an agent answering an outcome the step does not declare park the unit for a person, and the next tick writes nothing again.",
    { files: shippedFiles("quick") },
    (w) => {
      seed(w, "gh-180", { workflow: "quick", step: "test", run: { executor: "check", resumes: 1 } });
      seed(w, "gh-181", { workflow: "quick", step: "open-pr", run: { executor: "open-pr", resumes: 1 } });
      w.unit("gh-181").step_run = { kind: "open-pr", running: false, error: "forge: 401 bad credentials" };
      seed(w, "gh-182", { workflow: "quick", step: "test", run: { executor: "check" } });
      w.unit("gh-182").step_run = { kind: "check", running: false, outcome: "flaky" };
      seed(w, "gh-183", { workflow: "quick", step: "open-pr", run: { executor: "open-pr" } });
      w.unit("gh-183").step_run = { kind: "open-pr", running: false, outcome: "opened" };
      seed(w, "gh-184", { workflow: "quick", step: "implement", run: {} });
      w.manual.add("gh-184");
      w.unit("gh-184").session = session("reported", { report: { verb: "done", outcome: "bogus" } });
    },
    ["check.rerun.exhausted", "step.resume.exhausted", "check.finished.rejected", "step.finished.rejected", "agent.reported.rejected", "unit.parked"],
    2,
  ),
  scenario(
    "agent-stalled-runs",
    "Agent runs that never settle by themselves: a launch on the record with no session is waited on for the silent window and then retried as dead; a run past its deadline is stopped once and, its session outliving the order, judged dead; a usage limit outranks the deadline and is waited out, its reset recorded; a limit with no reset time parks for a person.",
    { files: shippedFiles("slice"), config: config({ maxNudges: 2 }) },
    (w) => {
      for (const id of ["gh-190", "gh-191", "gh-192", "gh-193", "gh-194", "gh-195"]) w.manual.add(id);
      seed(w, "gh-190", { workflow: "slice", step: "implement", run: { minutesAgo: 3 } });
      seed(w, "gh-191", { workflow: "slice", step: "implement", run: { minutesAgo: 20 } });
      quietStory(w, "gh-192", { run: { minutesAgo: 75 } }, session("working"));
      w.unstoppable.add("gh-192");
      quietStory(w, "gh-193", { run: { minutesAgo: 90, stopped_at: earlier(w, 20) } }, session("working"));
      quietStory(w, "gh-194", { run: { minutesAgo: 120 } }, session("limited", { limit: { kind: "usage", resets_at: later(w, 60) } }));
      quietStory(w, "gh-195", {}, session("limited", { limit: { kind: "usage" } }));
    },
    ["agent.unobserved", "agent.died.retry", "agent.timeout", "agent.timeout.stopping", "agent.limited.record", "agent.limited.wait", "agent.limited.unknown"],
    3,
  ),
  scenario(
    "unit-moved",
    "A person's move to a step: a unit stuck on a spent counter goes back to implement with the counter reset and its agent starts the tick after; a rerun of a step whose agent is still at work stops the run first, the order recorded, then applies the move with that order; a move on a unit that ended done, and one to a step the pinned workflow lacks, are refused onto the record.",
    SLICE(),
    (w) => {
      seed(w, "gh-210", { workflow: "slice", step: "test", state: { counters: { "test.fail": 5, "integrate.conflict": 0, "review.changes_requested": 0 }, ended: "stuck", ended_reason: "counter test.fail ran out (5/5) at test.fail", exhausted: "test.fail" } });
      w.append("gh-210", { kind: "step.moved", to: "implement", reset: ["test.fail"], by: "person", step: "test", attempt: 1 });
      seed(w, "gh-211", { workflow: "slice", step: "implement", run: {} });
      w.unit("gh-211").session = session("working");
      w.append("gh-211", { kind: "step.moved", to: "implement", by: "person", reason: "the agent misread the slice", step: "implement", attempt: 1 });
      seed(w, "gh-212", { workflow: "slice", step: "integrate", state: { ended: "done" } });
      w.append("gh-212", { kind: "step.moved", to: "implement", by: "person", step: "integrate", attempt: 1 });
      seed(w, "gh-213", { workflow: "slice", step: "review", state: { ended: "stuck", ended_reason: "review: the agent reported stuck" } });
      w.append("gh-213", { kind: "step.moved", to: "deploy", by: "person", step: "review", attempt: 1 });
    },
    ["unit.move", "unit.move.stop", "receipts.reject", "agent.start"],
    3,
  ),
  {
    name: "agent-manual-start",
    build(): GoldenCase[] {
      const name = "agent-manual-start";
      const description =
        "A person starts the agent of a step manual mode holds: the park lifts on their `run.requested`, the agent starts on the next tick, and its run is retried as an auto run would be; a request at a step that runs no agent is refused on the record.";
      const w = world({ files: shippedFiles("slice"), config: config({ mode: "manual" }) });
      seed(w, "gh-196", { workflow: "slice", step: "implement" });
      w.manual.add("gh-196");
      seed(w, "gh-197", { workflow: "slice", step: "test", run: { executor: "check" } });
      w.unit("gh-197").step_run = { kind: "check", running: true };
      w.tick();
      w.append("gh-196", { kind: "run.requested", by: "person", step: "implement", attempt: 1 });
      w.append("gh-197", { kind: "run.requested", by: "person", step: "test", attempt: 1 });
      w.tick();
      w.tick();
      const fired = new Set(w.ticks.flatMap((t) => t.decisions.map((d) => d.rule)));
      const missing = ["agent.ready.manual", "receipts.apply", "receipts.reject", "agent.start"].filter((r) => !fired.has(r));
      if (missing.length) throw new Error(`${name}: expected ${missing.join(", ")} to fire; fired ${[...fired].join(", ")}`);
      return w.ticks.map((t) => caseOf(w, t, `${name}-${t.n}`, `${description} Tick ${t.n}.`));
    },
  },
];
