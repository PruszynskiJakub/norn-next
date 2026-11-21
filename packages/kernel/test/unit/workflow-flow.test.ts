import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_KERNEL_CONFIG, type LoadedWorkflow, type LoadWorkflowOptions, loadWorkflow, producedOn, type StepKindInfo, validateWorkflowGraph, type WorkflowError, type WorkflowLoad } from "../../src/index.ts";
import { GOLDEN_DIR, type GoldenCase } from "../golden.ts";
import { kind, shipped, STEP_KINDS } from "../shipped.ts";

const HOST = ["spec", "handoff", "diff", "last_findings"];
const KINDS: Record<string, StepKindInfo> = {
  ...STEP_KINDS,
  publish: { ...kind("publish", ["done"]), reads: ["notes"] },
  announce: { ...kind("announce", ["done"]), reads: [{ name: "notes", fallback: "announces with no notes" }, "diff"] },
};
const opts = (over: Partial<LoadWorkflowOptions> = {}): LoadWorkflowOptions => ({ stepKinds: KINDS, sharedFiles: {}, config: DEFAULT_KERNEL_CONFIG, inputs: HOST, ...over });
const agent = (outcomes: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ agent: "Do the work.", outcomes, ...extra });
const wf = (steps: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ name: "t", start: Object.keys(steps)[0], steps, ...extra });

function loaded(r: WorkflowLoad): LoadedWorkflow {
  if (!r.ok) throw new Error(JSON.stringify(r.errors, null, 2));
  return r.workflow;
}
const errorsOf = (r: WorkflowLoad): WorkflowError[] => (r.ok ? [] : r.errors);

const NOTES = { notes: { file: "notes.md" } };

describe("produces: what an agent step writes for the steps after it", () => {
  test("compiles into the step's spec, by default on every outcome it reports but one that hands findings back", () => {
    const doc = wf({
      write: agent({ done: "review", partial: "review", changes_requested: "write", stuck: "$stuck" }, { produces: { ...NOTES, summary: { file: "out/summary.md", on: ["partial"] } }, hand_back: { changes_requested: "findings" } }),
      review: agent({ approve: "$done", rework: { to: "write", max: 2 } }, { inputs: ["spec", "notes"] }),
    });
    const w = loaded(loadWorkflow(doc, opts()));
    expect(w.graph.steps.write?.agent?.produces).toEqual({ notes: { file: "notes.md", on: ["done", "partial"] }, summary: { file: "out/summary.md", on: ["partial"] } });
    expect(w.graph.steps.review?.agent?.produces).toBeUndefined();
    expect(w.graph.steps.review?.agent?.inputs).toEqual(["spec", "notes"]);
    expect(validateWorkflowGraph(w.graph).ok).toBe(true);
    // the pinned document keeps the key as written, so it loads again to the same hash
    expect(loaded(loadWorkflow(structuredClone(w.pinned.doc), opts({ inputs: undefined }))).pinned.hash).toBe(w.pinned.hash);
    expect(producedOn(w.pinned.doc.steps.write ?? {}, "partial")).toEqual([
      { name: "notes", file: "notes.md" },
      { name: "summary", file: "out/summary.md" },
    ]);
    expect(producedOn(w.pinned.doc.steps.write ?? {}, "changes_requested")).toEqual([]);
    expect(producedOn(w.pinned.doc.steps.review ?? {}, "approve")).toEqual([]);
  });

  test("a produced name that is a host input, a file outside the spec folder, an outcome the step does not report, two files for one name: each refused at its key", () => {
    const doc = wf({
      a: agent({ done: "b", stuck: "$stuck" }, { produces: { spec: { file: "spec2.md" }, up: { file: "../x.md" }, abs: { file: "/etc/x.md" }, mid: { file: "a/../../x.md" }, odd: { file: "o.md", on: ["stuck", "nope"] }, notes: { file: "notes.md" } } }),
      b: agent({ done: "$done" }, { produces: { notes: { file: "other.md" } } }),
    });
    expect(errorsOf(loadWorkflow(doc, opts()))).toEqual([
      { path: "/steps/a/produces/spec", message: "`spec` is an input norn provides: a step produces a name of its own" },
      { path: "/steps/a/produces/up/file", message: "`../x.md` leaves the story's spec folder: name a path inside it, without `..`, with `/` between folders and no drive letter" },
      { path: "/steps/a/produces/abs/file", message: "`/etc/x.md` leaves the story's spec folder: name a path inside it, without `..`, with `/` between folders and no drive letter" },
      { path: "/steps/a/produces/mid/file", message: "`a/../../x.md` leaves the story's spec folder: name a path inside it, without `..`, with `/` between folders and no drive letter" },
      { path: "/steps/a/produces/odd/on/0", message: "produces names 'stuck', a route the kernel takes, never one an agent reports" },
      { path: "/steps/a/produces/odd/on/1", message: "produces names outcome 'nope', but the step declares no route for it in outcomes" },
      { path: "/steps/b/produces/notes/file", message: "`notes` is produced as notes.md by step a and as other.md here: a produced name names one file" },
    ]);
  });

  test("a file with a backslash or a drive letter is refused as one that may leave the spec folder", () => {
    const doc = wf({ a: agent({ done: "$done" }, { produces: { win: { file: "out\\x.md" }, drive: { file: "C:x.md" }, abs: { file: "c:/x.md" } } }) });
    expect(errorsOf(loadWorkflow(doc, opts()))).toEqual([
      { path: "/steps/a/produces/win/file", message: "`out\\x.md` leaves the story's spec folder: name a path inside it, without `..`, with `/` between folders and no drive letter" },
      { path: "/steps/a/produces/drive/file", message: "`C:x.md` leaves the story's spec folder: name a path inside it, without `..`, with `/` between folders and no drive letter" },
      { path: "/steps/a/produces/abs/file", message: "`c:/x.md` leaves the story's spec folder: name a path inside it, without `..`, with `/` between folders and no drive letter" },
    ]);
  });

  test("a file norn itself writes in the spec folder, as the host names them, is refused; a pinned revision loads without the check", () => {
    const specFiles = [".gitignore", "spec.md", "handoffs/", "slices/"];
    const doc = wf({
      a: agent(
        { done: "$done" },
        { produces: { ig: { file: ".gitignore" }, sp: { file: "./Spec.md" }, ho: { file: "handoffs/a.md" }, sl: { file: "slices" }, ok: { file: "slices-notes.md" } } },
      ),
    });
    const refusal = (name: string, file: string) => ({ path: `/steps/a/produces/${name}/file`, message: `\`${file}\` is a file norn writes in the spec folder itself: name another (norn keeps .gitignore, spec.md, handoffs/, slices/)` });
    expect(errorsOf(loadWorkflow(doc, opts({ specFiles })))).toEqual([refusal("ig", ".gitignore"), refusal("sp", "./Spec.md"), refusal("ho", "handoffs/a.md"), refusal("sl", "slices")]);
    expect(loadWorkflow(doc, opts({ inputs: undefined })).ok).toBe(true);
  });

  test("produces is a key of an agent step only", () => {
    const doc = wf({ t: { check: "x", timeout: "1m", produces: NOTES, outcomes: { pass: "$done", fail: "$stuck" } } });
    expect(errorsOf(loadWorkflow(doc, opts()))).toEqual([{ path: "/steps/t/produces", message: "`produces` is not a key of a check step" }]);
  });
});

describe("the flow: a step reads only what every path to it produced", () => {
  test("an input with a producer on every path loads, a route back included", () => {
    const doc = wf({
      plan: agent({ done: "write", skip: "write" }, {}),
      write: agent({ done: "review" }, { produces: NOTES }),
      review: agent({ approve: "$done", again: { to: "plan", max: 2 } }, { inputs: ["notes"] }),
    });
    expect(errorsOf(loadWorkflow(doc, opts()))).toEqual([]);
  });

  test("an input one path reaches without its producer is refused, naming the step and that path", () => {
    const doc = wf({
      plan: agent({ done: "write", skip: "review" }),
      write: agent({ done: "review" }, { produces: NOTES }),
      review: agent({ approve: "$done" }, { inputs: ["spec", "notes"] }),
    });
    expect(errorsOf(loadWorkflow(doc, opts()))).toEqual([
      { path: "/steps/review/inputs/1", message: "step 'review' reads `notes`, but no step produces it on the path plan.skip → review: give a step on that path produces: notes" },
    ]);
  });

  test("a producer counts only by the outcomes it produces on", () => {
    const doc = wf({
      write: agent({ done: "review", partial: "review" }, { produces: { notes: { file: "notes.md", on: ["done"] } } }),
      review: agent({ approve: "$done" }, { inputs: ["notes"] }),
    });
    expect(errorsOf(loadWorkflow(doc, opts()))).toEqual([
      { path: "/steps/review/inputs/0", message: "step 'review' reads `notes`, but no step produces it on the path write.partial → review: give a step on that path produces: notes" },
    ]);
  });

  test("a step's own output is never its input, even on a route back to itself", () => {
    const doc = wf({ write: agent({ done: "$done", again: { to: "write", max: 2 } }, { produces: NOTES, inputs: ["notes"] }) });
    expect(errorsOf(loadWorkflow(doc, opts()))).toEqual([
      { path: "/steps/write/inputs/0", message: "step 'write' reads `notes`, but no step produces it on the path write: give a step on that path produces: notes" },
    ]);
  });

  test("a step kind's read is checked the same way; an optional read with its fallback, or a host input, needs no producer", () => {
    const doc = wf({
      plan: agent({ done: "write", skip: "ship" }),
      write: agent({ done: "ship" }, { produces: NOTES }),
      ship: { publish: null, outcomes: { done: "tell" } },
      tell: { announce: null, outcomes: { done: "$done" } },
    });
    expect(errorsOf(loadWorkflow(doc, opts()))).toEqual([
      { path: "/steps/ship/publish", message: "step 'ship' (publish) reads `notes`, but no step produces it on the path plan.skip → ship: give a step on that path produces: notes" },
    ]);
    const optional = wf({ plan: agent({ done: "write", skip: "tell" }), write: agent({ done: "tell" }, { produces: NOTES }), tell: { announce: null, outcomes: { done: "$done" } } });
    expect(errorsOf(loadWorkflow(optional, opts()))).toEqual([]);
  });

  test("shared files are checked once flattened, and a refusal inside one names it", () => {
    const sharedFiles = {
      ship: { start: "out", steps: { out: { publish: null, outcomes: { done: { exit: "shipped" } } } } },
      draft: { start: "write", steps: { write: agent({ done: { exit: "written" } }, { produces: NOTES }) } },
    };
    const good = wf({ plan: agent({ done: "draft" }), draft: { use: "draft", outcomes: { written: "ship" } }, ship: { use: "ship", outcomes: { shipped: "$done" } } });
    expect(errorsOf(loadWorkflow(good, opts({ sharedFiles })))).toEqual([]);
    const bad = wf({ plan: agent({ done: "draft", skip: "ship" }), draft: { use: "draft", outcomes: { written: "ship" } }, ship: { use: "ship", outcomes: { shipped: "$done" } } });
    expect(errorsOf(loadWorkflow(bad, opts({ sharedFiles })))).toEqual([
      { path: "/steps/out/publish", message: "shared/ship.yaml: step 'out' (publish) reads `notes`, but no step produces it on the path plan.skip → out: give a step on that path produces: notes", shared: "ship" },
    ]);
  });

  test("without the host's inputs, as a pinned revision loads, the flow is not checked: it was when the revision was pinned", () => {
    const doc = wf({ ship: { publish: null, outcomes: { done: "$done" } } });
    expect(errorsOf(loadWorkflow(doc, opts()))).toHaveLength(1);
    expect(errorsOf(loadWorkflow(doc, opts({ inputs: undefined })))).toEqual([]);
  });
});

describe("revisions pinned before produces and reads", () => {
  /** every pinned workflow a golden case's facts hold, as a unit recorded it before this change */
  function pinnedIn(value: unknown, out: Array<{ hash: string; doc: unknown }> = []): Array<{ hash: string; doc: unknown }> {
    if (Array.isArray(value)) for (const v of value) pinnedIn(v, out);
    else if (value !== null && typeof value === "object") {
      const o = value as Record<string, unknown>;
      if (typeof o.hash === "string" && typeof o.name === "string" && o.doc !== null && typeof o.doc === "object") out.push({ hash: o.hash, doc: o.doc });
      else for (const v of Object.values(o)) pinnedIn(v, out);
    }
    return out;
  }

  test("each loads to the hash it was pinned under, with no produces in its graph", () => {
    const pinned = new Map<string, { doc: unknown; kinds: Record<string, StepKindInfo> }>();
    for (const f of readdirSync(GOLDEN_DIR).filter((n) => n.endsWith(".json"))) {
      const c = JSON.parse(readFileSync(join(GOLDEN_DIR, f), "utf8")) as GoldenCase;
      const kinds = Object.fromEntries(Object.entries(c.step_kinds).map(([name, k]) => [name, { name, ...k } as StepKindInfo]));
      for (const p of pinnedIn(c.facts)) pinned.set(p.hash, { doc: p.doc, kinds });
    }
    expect(pinned.size).toBeGreaterThan(5);
    for (const [hash, { doc, kinds }] of pinned) {
      const w = loaded(loadWorkflow(structuredClone(doc), { stepKinds: kinds, sharedFiles: {}, config: DEFAULT_KERNEL_CONFIG }));
      expect(w.pinned.hash).toBe(hash);
      for (const step of Object.values(w.graph.steps)) expect(step.agent === undefined || !("produces" in step.agent)).toBe(true);
    }
  });

  test("a shipped workflow without its produces declarations loads to the graph it had, less the declarations", () => {
    const { workflows, shared } = shipped();
    // the runtime's HOST_INPUTS, which the kernel cannot import
    const inputs = ["spec", "handoff", "last_check", "last_findings", "signal", "diff", "slice", "slices", "record", "resolution", "base_side"];
    const strip = (doc: unknown) => {
      const d = structuredClone(doc) as { steps: Record<string, Record<string, unknown>> };
      for (const s of Object.values(d.steps)) delete s.produces;
      return d;
    };
    for (const file of ["quick.yaml", "story.yaml"]) {
      const now = loaded(loadWorkflow(workflows[file], opts({ stepKinds: STEP_KINDS, sharedFiles: shared, inputs })));
      const before = loaded(loadWorkflow(strip(workflows[file]), opts({ stepKinds: STEP_KINDS, sharedFiles: shared, inputs })));
      expect(now.graph.steps.describe?.agent?.produces).toEqual({ pr_body: { file: "pr.md", on: ["done"] } });
      const less = structuredClone(now.graph);
      delete less.steps.describe?.agent?.produces;
      expect({ ...less, hash: "" }).toEqual({ ...before.graph, hash: "" });
    }
  });
});
