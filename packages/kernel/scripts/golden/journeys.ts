/**
 * Golden scenarios told as whole stories over many ticks: a story from intake to its merged pull
 * request through the shipped `story` workflow and its slices, a `quick` story in manual mode, a red
 * check looping until its counter runs out, a gate rejected until its counter runs out, and the
 * troubles an agent run meets (a question, silence, a dead session, a usage limit).
 */
import type { GoldenCase } from "../../test/golden.ts";
import { caseOf, config, item, seed, shippedFiles, world } from "./catalog.ts";
import { session, type Tick, type World } from "./world.ts";

export interface Scenario {
  name: string;
  build(): GoldenCase[];
}

const rulesOf = (t: Tick): string => [...new Set(t.decisions.map((d) => d.rule))].sort().join(",");

/** Rules that recur beside whatever a tick is about; a tick is kept for the rest of its rules. */
const BACKGROUND = new Set(["claim.renew", "claim.pending", "slices.wait", "unit.ended.done", "unit.ended.stuck", "unit.parked", "agent.running", "agent.limited.wait"]);
/** A tick's own rules, plus each unit it ends and how, so the tick a counter runs out is kept even when its rule is not new. */
function salient(t: Tick): string {
  const ends = t.decisions.flatMap((d) => (d.kind === "apply_receipts" && d.state.ended ? [`${d.unit}→${d.state.ended}`] : []));
  return [...rulesOf(t).split(",").filter((r) => !BACKGROUND.has(r)), ...ends].join(",");
}

/**
 * The ticks worth keeping from a journey: the first tick of each distinct set of rules, so a long
 * story yields one case per kind of moment rather than one per minute.
 */
function distinct(w: World, scenario: string, description: string): GoldenCase[] {
  const seen = new Set<string>();
  const out: GoldenCase[] = [];
  for (const t of w.ticks) {
    const key = salient(t);
    if (seen.has(key) && !w.kept.has(t.n)) continue;
    seen.add(key);
    out.push(caseOf(w, t, `${scenario}-${String(t.n).padStart(3, "0")}`, `${description} Tick ${t.n}: ${rulesOf(t) || "nothing to decide"}.`));
  }
  return out;
}

const stateOf = (w: World, id: string) => w.stories.find((s) => s.key === id.split("/")[0])?.units.find((u) => u.id === id)?.state ?? null;
const ended = (id: string) => (w: World) => stateOf(w, id)?.ended !== undefined;
const at = (id: string, step: string) => (w: World) => stateOf(w, id)?.step === step;
const parkedAt = (id: string, step: string) => (w: World) => at(id, step)(w) && stateOf(w, id)?.parked !== undefined;

function storyJourney(): GoldenCase[] {
  const w = world({ files: shippedFiles("story", "slice") });
  const key = "gh-12";
  w.intake.push(item(12, "Sign in with a passkey"));
  Object.assign(w.script.step, { sync: ["done"], update: ["done"], "open-pr": ["done"], checks: ["pass"], merge: ["waiting", "waiting", "merged"], integrate: ["done"], [`${key}/02:integrate`]: ["conflict", "done"] });
  Object.assign(w.script.check, { [`${key}/01:test`]: ["fail", "pass"], test: ["pass"] });
  Object.assign(w.script.agent, { slice: ["done"], implement: ["done"], review: ["approve"], [`${key}/03:review`]: ["changes_requested", "approve"], merge: ["done"], qa: ["pass"], describe: ["done"] });
  w.tick();
  w.run(parkedAt(key, "approve-slices"));
  const story = w.story(key);
  story.plan = {
    slices: [
      { unit: `${key}/01`, depends_on: [] },
      { unit: `${key}/02`, depends_on: [`${key}/01`] },
      { unit: `${key}/03`, depends_on: [] },
    ],
  };
  w.tick();
  w.advance(20);
  w.decideGate(key, "approve");
  w.run(at(key, "update"), 80);
  w.run(parkedAt(key, "ready"));
  w.tick();
  w.decideGate(key, "approve");
  w.run(ended(key));
  story.change = { id: 41, url: "https://forge.example/pr/41", state: "merged", draft: false, head_branch: "gh-12-passkey", base_branch: "main", head_sha: "a1", merge_sha: "m1", merged_at: w.iso(), title: "Sign in with a passkey" };
  w.run((x) => x.story(key).claim === null);
  w.tick();
  return distinct(w, "story-journey", "A story from intake through sync, slicing, an approved slice plan, three slices (a red check, a review sent back, an integration conflict), the story's base update, QA, PR, CI, the ready gate and the merge, to the claim's release.");
}

function quickJourney(): GoldenCase[] {
  const w = world({ files: shippedFiles("quick"), config: config({ mode: "manual", workflow: "quick" }) });
  const key = "gh-7";
  w.intake.push(item(7, "Fix the typo in the help text"));
  Object.assign(w.script.step, { sync: ["done"], update: ["done"], "open-pr": ["done"], checks: ["fail", "pass"], merge: ["waiting"] });
  Object.assign(w.script.check, { test: ["pass"] });
  Object.assign(w.script.agent, { implement: ["done"], review: ["changes_requested", "approve"], describe: ["done"] });
  w.run(parkedAt(key, "implement"));
  w.tick();
  // a person switches the story to auto mode; the park manual mode derived lifts
  const st = w.unit(key).state;
  if (st) w.append(key, { kind: "mode.changed", mode: "auto", by: "person" });
  w.run(parkedAt(key, "ready"), 80);
  w.decideGate(key, "approve");
  w.run(at(key, "merge"));
  w.tick();
  w.tick();
  w.story(key).change = { id: 9, state: "merged", draft: false, head_branch: "gh-7-typo", base_branch: "main", head_sha: "b2", merge_sha: "m2", title: "Fix the typo in the help text" };
  w.run((x) => x.story(key).claim === null);
  w.tick();
  return distinct(w, "quick-journey", "A quick story in manual mode: the ready agent step waits for a person until they switch the story to auto; a review sends the change back once and CI fails once; the change merges on the forge, which ends the story.");
}

function checkExhausted(): GoldenCase[] {
  const w = world({ files: shippedFiles("story", "slice") });
  seed(w, "gh-30", { step: "implement" });
  const slice = seed(w, "gh-30", { workflow: "slice", step: "implement", unit: "gh-30/01" });
  w.unit("gh-30").state = { ...(w.unit("gh-30").state as NonNullable<typeof slice.state>), step: "slices", visits: { slices: 1 } };
  w.story("gh-30").plan = { slices: [{ unit: "gh-30/01", depends_on: [] }] };
  Object.assign(w.script.agent, { implement: ["done"] });
  Object.assign(w.script.check, { test: ["fail"] });
  w.run(ended("gh-30/01"), 60);
  w.run(ended("gh-30"));
  w.tick();
  return distinct(w, "check-exhausted", "A slice whose test check fails every time: each red check sends it back to implement until the counter test.fail (5) runs out and the slice ends stuck, naming it; the story's slices step then ends stuck too.");
}

function gateRejected(): GoldenCase[] {
  const w = world({ files: shippedFiles("quick") });
  const key = "gh-31";
  seed(w, key, { workflow: "quick", step: "describe" });
  Object.assign(w.script.step, { update: ["done"], "open-pr": ["done"], checks: ["pass"] });
  Object.assign(w.script.check, { test: ["pass"] });
  Object.assign(w.script.agent, { implement: ["done"], review: ["approve"], describe: ["done"] });
  for (let i = 1; i <= 3; i++) {
    w.run(parkedAt(key, "ready"), 60);
    w.tick();
    w.decideGate(key, "reject", `round ${i}: the PR body misses the migration note`);
    w.keepNext();
    w.tick();
  }
  w.run(ended(key));
  w.tick();
  return distinct(w, "gate-rejected", "A ready gate a person rejects three times: the first two send the story back to implement and through review and CI again, the third runs the counter land.rejected (2) out and the story ends stuck.");
}

function agentTroubles(): GoldenCase[] {
  const w = world({ files: shippedFiles("story") });
  // a question, answered by a person
  seed(w, "gh-40", { step: "slice", run: {} });
  // silence, nudged until the nudges run out
  seed(w, "gh-41", { step: "slice", run: {} });
  // a session that dies, retried once, then dies again
  seed(w, "gh-42", { step: "qa", run: {} });
  // a usage limit, waited out, then nudged
  seed(w, "gh-43", { step: "describe", run: {} });
  for (const id of ["gh-40", "gh-41", "gh-42", "gh-43"]) w.manual.add(id);
  w.unit("gh-40").session = session("asking", { ask: { id: "q-1", question: "Split the login form into its own slice?", options: ["yes", "no"] } });
  w.unit("gh-41").session = session("working", { silent: true });
  w.unit("gh-42").session = session("ended");
  w.unit("gh-43").session = session("limited", { limit: { kind: "usage", resets_at: new Date(w.now + 30 * 60_000).toISOString() } });
  w.tick();
  w.tick();
  w.append("gh-40", { kind: "answer.sent", input_id: "q-1", text: "yes", by: "person" });
  w.unit("gh-40").session = session("working");
  w.tick();
  w.unit("gh-41").session = session("working", { silent: true });
  w.unit("gh-42").session = session("ended");
  w.tick();
  w.tick();
  w.unit("gh-42").session = session("ended");
  // the nudge's window passes with the agent still quiet, a tick a minute
  for (let i = 0; i < 16; i++) w.tick();
  w.unit("gh-41").session = session("working", { silent: true });
  w.tick();
  w.tick();
  for (let i = 0; i < 16; i++) w.tick();
  w.unit("gh-41").session = session("working", { silent: true });
  w.report("gh-40", "done", "done");
  w.tick();
  w.tick();
  w.tick();
  return distinct(w, "agent-troubles", "Four stories whose agent runs meet trouble at once: one asks a question and a person answers it, one goes silent and is nudged until its nudges run out, one dies, is retried once and dies again, and one hits a usage limit and waits for its reset before being nudged.");
}

export const JOURNEYS: Scenario[] = [
  { name: "story-journey", build: storyJourney },
  { name: "quick-journey", build: quickJourney },
  { name: "check-exhausted", build: checkExhausted },
  { name: "gate-rejected", build: gateRejected },
  { name: "agent-troubles", build: agentTroubles },
];
