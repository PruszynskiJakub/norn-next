import { describe, expect, test } from "bun:test";
import type { Pack } from "@norn/plugin-api";
import { collectStepKinds, findProvided, loadPackWorkflows } from "@norn/runtime";
import { BUNDLED_PLUGINS } from "../../src/index.ts";
import { beatOf, forStory, labAgentBeats, labScript, type LabUnit, nextCommand, personCommand } from "../../src/lab/script.ts";

const script = labScript();

/** The workflow the lab plays, as the runtime loads it from the bundled pack. */
function loadedGraph() {
  const kinds = collectStepKinds(BUNDLED_PLUGINS);
  const pack = findProvided<Pack>(BUNDLED_PLUGINS, "packs", "sdlc");
  if (!kinds.ok || !pack.ok) throw new Error("the bundled pack does not load");
  const loaded = loadPackWorkflows(pack.value, kinds.value);
  if (!loaded.ok) throw new Error(loaded.failure.message);
  const w = loaded.value[script.workflow];
  if (w === undefined || !w.ok) throw new Error(`${script.workflow} does not load`);
  return w.workflow.graph;
}

const unit = (over: Partial<LabUnit> = {}): LabUnit => ({ id: "lt-1", step: "sync", waiting: null, counters: {}, ...over });
const spent = (name: string, value = 1) => ({ [name]: { value, max: 5 } });

describe("the lab's beat script", () => {
  test("plays eight beats, numbered 1 to 8, each with a caption and a place to look", () => {
    expect(script.beats.map((b) => b.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const b of script.beats) {
      expect(b.caption.length).toBeGreaterThan(40);
      expect(b.look).toMatch(/`[^`]+`/);
    }
  });

  test("names only steps and counters of the workflow it plays, as the runtime loads it", () => {
    const graph = loadedGraph();
    const steps = script.beats.flatMap((b) => b.when.steps ?? []);
    const counters = script.beats.flatMap((b) => b.when.counters ?? []);
    expect(steps.filter((s) => graph.steps[s] === undefined)).toEqual([]);
    expect(counters.filter((c) => graph.counters[c] === undefined)).toEqual([]);
    const agent = labAgentBeats();
    expect(agent.filter((b) => b.workflow !== script.workflow || graph.steps[b.step]?.kind !== "agent").map((b) => b.step)).toEqual([]);
    // every agent step the story passes on its way has a beat for the stand-in
    for (const s of ["implement", "review", "describe"]) expect(agent.some((b) => b.step === s && b.attempt === undefined)).toBe(true);
  });

  test("places a story in its beat from its state alone", () => {
    expect(beatOf(script, null).n).toBe(1);
    expect(beatOf(script, unit({ step: "sync" })).n).toBe(1);
    expect(beatOf(script, unit({ step: "implement" })).n).toBe(2);
    expect(beatOf(script, unit({ step: "check" })).n).toBe(2);
    expect(beatOf(script, unit({ step: "implement", counters: spent("check.fail") })).n).toBe(3);
    expect(beatOf(script, unit({ step: "review", counters: spent("check.fail") })).n).toBe(4);
    expect(beatOf(script, unit({ step: "implement", counters: { ...spent("check.fail"), ...spent("review.changes_requested") } })).n).toBe(4);
    expect(beatOf(script, unit({ step: "describe", counters: spent("review.changes_requested") })).n).toBe(5);
    expect(beatOf(script, unit({ step: "open-pr" })).n).toBe(6);
    expect(beatOf(script, unit({ step: "checks" })).n).toBe(6);
    expect(beatOf(script, unit({ step: "ready" })).n).toBe(7);
    // a reject sends the work back through implement, and the lab stays at the gate's beat
    expect(beatOf(script, unit({ step: "implement", counters: { ...spent("check.fail"), ...spent("land.rejected") } })).n).toBe(7);
    expect(beatOf(script, unit({ step: "merge", counters: spent("land.rejected") })).n).toBe(8);
    expect(beatOf(script, unit({ step: "merge", ended: "done" })).n).toBe(8);
  });

  test("the next command is what the story waits on the person for, else the beat's act, else a tick; none once it ended", () => {
    const at = (u: LabUnit | null) => nextCommand(script, beatOf(script, u), u === null ? null : "lt-1", u);
    expect(at(null)).toBe(script.act);
    expect(at(unit({ step: "implement" }))).toBe(script.act);
    expect(at(unit({ step: "ready", waiting: { for: "gate", text: "ready?", next: "norn story approve lt-1" } }))).toBe("norn story approve lt-1");
    expect(at(unit({ step: "merge" }))).toBe("git merge --no-ff --no-edit norn/lt-1 && git push -q origin main");
    expect(at(unit({ step: "merge", ended: "done" }))).toBeNull();
    expect(forStory("branch norn/{key}", "lt-7")).toBe("branch norn/lt-7");
  });

  test("names the person's own command at each beat that needs them, and none elsewhere", () => {
    const at = (u: LabUnit) => personCommand(beatOf(script, u), u, "lt-1");
    const gate = { for: "gate", text: "ready?", next: "norn story approve lt-1" };
    expect(at(unit({ step: "implement", counters: spent("check.fail"), waiting: { for: "answer", text: "comma?" } }))).toBe('norn story answer lt-1 "Keep the comma."');
    expect(at(unit({ step: "ready", waiting: gate }))).toBe('norn story reject lt-1 --reason "Name the greeting in the README too."');
    expect(at(unit({ step: "ready", waiting: gate, counters: spent("land.rejected") }))).toBe("norn story approve lt-1");
    expect(at(unit({ step: "merge" }))).toBe("git merge --no-ff --no-edit norn/lt-1 && git push -q origin main");
    expect(at(unit({ step: "implement", counters: spent("check.fail") }))).toBeNull();
    expect(at(unit({ step: "implement", counters: spent("land.rejected") }))).toBeNull();
    expect(at(unit({ step: "merge", ended: "done" }))).toBeNull();
    expect(at(unit({ step: "sync" }))).toBeNull();
  });
});
