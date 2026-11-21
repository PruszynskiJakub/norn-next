/**
 * What of a workflow the person confirms: its person's steps, who stays beside each agent step
 * (`attended:`) and what each may write (`allow:`). A change to any of these is held for the person;
 * any other change is not.
 */
import { describe, expect, test } from "bun:test";
import { DEFAULT_KERNEL_CONFIG, guardChanges, type LoadedWorkflow, loadWorkflow, type WorkflowDocument } from "../../src/index.ts";
import { STEP_KINDS } from "../shipped.ts";

type Steps = Record<string, Record<string, unknown>>;
const BASE: { name: string; start: string; steps: Steps } = {
  name: "t",
  start: "build",
  steps: {
    build: { by: "builder", do: "Build it.", outcomes: { done: "review" } },
    review: { by: "reviewer", do: "Review it.", allow: ["docs:write"], outcomes: { approve: "ready", changes_requested: { to: "build", max: 2 } } },
    ready: { by: "person", do: "Approve to merge.", outcomes: { approve: "$done", reject: { to: "build", max: 2 } } },
  },
};

/** The base workflow with each step's keys open to an edit; every step the edits name exists. */
type Editable = { steps: Record<"build" | "review" | "ready", Record<string, unknown>> & Steps };

function doc(edit: (d: Editable) => void = () => {}): WorkflowDocument {
  const d = structuredClone(BASE) as unknown as Editable;
  edit(d);
  const r = loadWorkflow(d, { stepKinds: STEP_KINDS, sharedFiles: {}, config: DEFAULT_KERNEL_CONFIG });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return (r.workflow as LoadedWorkflow).pinned.doc;
}

describe("guardChanges", () => {
  test("an agent's instruction, a route, a new step without attended or allow: nothing the person confirms", () => {
    const after = doc((d) => {
      d.steps.build.do = "Build it test-first.";
      d.steps.build.outcomes = { done: "check" };
      d.steps.check = { by: "shell", do: "make test", limits: { timeout: "5m" }, outcomes: { pass: "review", fail: "build" } };
    });
    expect(guardChanges(doc(), after)).toEqual([]);
  });

  test("a person's step added, removed, or with its decision or routes changed", () => {
    expect(guardChanges(doc(), doc((d) => void (d.steps.ready.do = "Merge it.")))).toEqual(["person step ready changed"]);
    expect(guardChanges(doc(), doc((d) => void (d.steps.ready.outcomes = { approve: "$done", reject: "$stuck" })))).toEqual(["person step ready changed"]);
    const without = doc((d) => {
      d.steps.review.outcomes = { approve: "$done", changes_requested: { to: "build", max: 2 } };
      delete (d.steps as Steps).ready;
    });
    expect(guardChanges(doc(), without)).toEqual(["person step ready removed"]);
    expect(guardChanges(without, doc())).toEqual(["person step ready added"]);
  });

  test("who stays beside an agent step, and what it may write", () => {
    expect(guardChanges(doc(), doc((d) => void (d.steps.build.attended = "person")))).toEqual(["step build: attended none → person"]);
    expect(guardChanges(doc((d) => void (d.steps.build.attended = "person")), doc((d) => void (d.steps.build.attended = "agent")))).toEqual(["step build: attended person → agent"]);
    expect(guardChanges(doc(), doc((d) => void delete d.steps.review.allow))).toEqual(["step review: allow [docs:write] → its role's"]);
    expect(guardChanges(doc(), doc((d) => void (d.steps.review.allow = ["docs:write", "exec:checks"])))).toEqual(["step review: allow [docs:write] → [docs:write, exec:checks]"]);
  });

  test("the role a step names, as it grants the step's capabilities", () => {
    expect(guardChanges(doc(), doc((d) => void (d.steps.review.by = "builder")))).toEqual(["step review: by reviewer → builder"]);
  });

  test("an agent step added or removed counts only for an attended: or allow: of its own", () => {
    const extra = (d: Editable, over: Record<string, unknown>) => {
      d.steps.build.outcomes = { done: "plan" };
      d.steps.plan = { by: "writer", do: "Plan it.", outcomes: { done: "review" }, ...over };
    };
    expect(guardChanges(doc(), doc((d) => extra(d, {})))).toEqual([]);
    expect(guardChanges(doc(), doc((d) => extra(d, { attended: "person", allow: ["docs:write"] })))).toEqual(["step plan added: attended person, allow [docs:write]"]);
    expect(guardChanges(doc((d) => extra(d, { allow: ["docs:write"] })), doc())).toEqual(["step plan removed: allow [docs:write]"]);
  });
});
