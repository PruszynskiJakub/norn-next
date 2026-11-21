/**
 * The floor a workflow is checked against when it loads: every path to a step whose kind has an
 * effect a person must stand before (`outward`, `cost`, `forge-write`) passes a `by: person` step that
 * no policy grant delegates. Paths start where a round can start by itself: `start`, and the entry
 * `norn story update-branch` re-enters.
 */
import { describe, expect, test } from "bun:test";
import { DEFAULT_KERNEL_CONFIG, type LoadWorkflowOptions, loadWorkflow, type WorkflowLoad } from "../../src/index.ts";
import { kind, STEP_KINDS, shipped } from "../shipped.ts";

const KINDS = {
  ...STEP_KINDS,
  deploy: { ...kind("deploy", ["done"]), namespace: "vercel", effects: ["outward", "cost"] as const },
  watch: { ...kind("watch", ["seen"], "wait"), namespace: "vercel" },
};
const opts = (over: Partial<LoadWorkflowOptions> = {}): LoadWorkflowOptions => ({ stepKinds: KINDS, sharedFiles: {}, config: DEFAULT_KERNEL_CONFIG, floor: { delegated: [] }, ...over });
const wf = (steps: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ name: "t", start: Object.keys(steps)[0], steps, ...extra });
const refusals = (r: WorkflowLoad) => (r.ok ? [] : r.errors.map(({ path, message }) => ({ path, message })));

const build = { by: "builder", do: "Build it.", outcomes: { done: "ready" } };
const ready = { by: "person", do: "Approve to merge.", outcomes: { approve: "merge", reject: { to: "build", max: 2 } } };
const merge = { by: "forge.await-merge", outcomes: { merged: "$done", unpushed: "build" } };

describe("the floor: a person stands before every effect they cannot take back", () => {
  test("a gate on every path to a forge write loads; with nothing before it, the step is refused with the path that reaches it", () => {
    expect(loadWorkflow(wf({ build, ready, merge }), opts()).ok).toBe(true);
    expect(refusals(loadWorkflow(wf({ build: { ...build, outcomes: { done: "merge" } }, merge }), opts()))).toEqual([
      {
        path: "/steps/merge",
        message: "step merge (forge.await-merge) writes to the forge, and start reaches it through build → merge with no `by: person` step on the way: put a person's step no policy grant delegates on every path to it",
      },
    ]);
  });

  test("one path around the gate is enough to refuse: a route back, or a signal's route under on:", () => {
    const around = wf({ build: { ...build, outcomes: { done: "ready", skip: "merge" } }, ready, merge });
    expect(refusals(loadWorkflow(around, opts())).map((e) => e.message)).toEqual([expect.stringContaining("through build → merge")]);
    const viaSignal = wf({
      build: { ...build, outcomes: { done: "watch" } },
      watch: { by: "vercel.watch", outcomes: { seen: "ready" }, on: { "vcs.stale": "ship" } },
      ready: { ...ready, outcomes: { approve: "ship", reject: { to: "build", max: 2 } } },
      ship: { by: "vercel.deploy", outcomes: { done: "$done" } },
    });
    expect(refusals(loadWorkflow(viaSignal, opts()))).toEqual([expect.objectContaining({ path: "/steps/ship", message: expect.stringContaining("through build → watch → ship") })]);
  });

  test("a gate the policy grants to a stand-in is no person's step, and the refusal says the grant is why", () => {
    const r = refusals(loadWorkflow(wf({ build, ready, merge }), opts({ floor: { delegated: ["ready"] } })));
    expect(r.map((e) => e.path)).toEqual(["/steps/merge"]);
    expect(r[0]?.message).toContain("through build → ready → merge");
    expect(r[0]?.message).toContain("the policy grants ready to a stand-in (policy.stand_in.gates)");
  });

  test("a refusal the grant alone causes names the granted gates, so a host tells the person's policy from a broken file", () => {
    const granted = loadWorkflow(wf({ build, ready, merge }), opts({ floor: { delegated: ["ready"] } }));
    expect(granted.ok ? [] : granted.errors.map((e) => e.granted)).toEqual([["ready"]]);
    // a path around the gate refuses the file whatever the policy grants, even when the path shown passes the granted gate: that is the file's to fix
    const around = wf({ build: { ...build, outcomes: { done: "ready", skip: "lint" } }, lint: { by: "builder", do: "Lint it.", outcomes: { done: "merge" } }, ready, merge });
    const r = loadWorkflow(around, opts({ floor: { delegated: ["ready"] } }));
    expect(r.ok ? [] : r.errors.map((e) => ({ granted: e.granted, shown: e.message.includes("build → ready → merge") }))).toEqual([{ granted: undefined, shown: true }]);
  });

  test("the entry norn story update-branch re-enters starts a path too", () => {
    const doc = wf(
      { build, ready: { ...ready, outcomes: { approve: "update", reject: { to: "build", max: 2 } } }, update: { by: "vcs.update-branch", outcomes: { done: "merge", conflict: "build", clean: "merge", resolved: "merge" } }, merge },
      { entries: { "update-branch": "update" } },
    );
    expect(refusals(loadWorkflow(doc, opts()))).toEqual([expect.objectContaining({ path: "/steps/merge", message: expect.stringContaining("the entry update-branch reaches it through update → merge") })]);
  });

  test("every effect is named: outward and cost on a plugin's kind", () => {
    const r = refusals(loadWorkflow(wf({ build: { ...build, outcomes: { done: "ship" } }, ship: { by: "vercel.deploy", outcomes: { done: "$done" } } }), opts()));
    expect(r[0]?.message).toStartWith("step ship (vercel.deploy) reaches outside the repo and spends money, and start reaches it");
  });

  test("a unit's pinned revision loads without the floor, so a grant made since never takes a round's workflow away", () => {
    expect(loadWorkflow(wf({ build: { ...build, outcomes: { done: "merge" } }, merge }), opts({ floor: undefined })).ok).toBe(true);
  });

  test("every shipped workflow stands on the floor with nothing granted; granting story's ready gate takes its merge off it", () => {
    const { workflows, shared } = shipped();
    for (const [file, doc] of Object.entries(workflows)) {
      const r = loadWorkflow(doc, opts({ stepKinds: STEP_KINDS, sharedFiles: shared }));
      expect({ file, errors: refusals(r) }).toEqual({ file, errors: [] });
    }
    const story = refusals(loadWorkflow(workflows["story.yaml"], opts({ stepKinds: STEP_KINDS, sharedFiles: shared, floor: { delegated: ["ready"] } })));
    expect(story.map((e) => e.path)).toEqual(["/steps/merge"]);
    expect(story[0]?.message).toStartWith("shared/ship.yaml: step merge (forge.await-merge) writes to the forge");
  });
});
