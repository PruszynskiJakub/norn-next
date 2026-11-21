import { describe, expect, test } from "bun:test";
import { DEFAULT_KERNEL_CONFIG, type LoadedWorkflow, type LoadWorkflowOptions, loadWorkflow, type WorkflowError, type WorkflowLoad } from "../../src/index.ts";
import { STEP_KINDS } from "../shipped.ts";

const HOST = ["spec", "handoff", "diff", "last_findings"];
const opts = (over: Partial<LoadWorkflowOptions> = {}): LoadWorkflowOptions => ({ stepKinds: STEP_KINDS, sharedFiles: {}, config: DEFAULT_KERNEL_CONFIG, inputs: HOST, ...over });
const agent = (outcomes: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ agent: "Do the work.", outcomes, ...extra });
const wf = (steps: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ name: "t", start: Object.keys(steps)[0], steps, ...extra });

function loaded(r: WorkflowLoad): LoadedWorkflow {
  if (!r.ok) throw new Error(JSON.stringify(r.errors, null, 2));
  return r.workflow;
}
const errorsOf = (r: WorkflowLoad): WorkflowError[] => (r.ok ? [] : r.errors);

/** A file written with outcome objects pins exactly the document its older spelling pins, so a unit's pin and the golden cases never see the difference. */
function pinsAlike(written: unknown, older: unknown, o: Partial<LoadWorkflowOptions> = {}): void {
  const a = loaded(loadWorkflow(written, opts(o))).pinned;
  const b = loaded(loadWorkflow(older, opts(o))).pinned;
  expect(a.doc).toEqual(b.doc);
  expect(a.hash).toBe(b.hash);
}

describe("an outcome written as an object", () => {
  test("carries its route, its means and its verdict, and pins the document the separate maps pin", () => {
    pinsAlike(
      wf({
        qa: agent(
          {
            pass: { to: "$done", verdict: "pass", means: "every criterion observed" },
            fail: { to: "fix", max: 2, verdict: "fail", means: "a criterion fails", produces: ["criteria", "findings"] },
            unverified: { to: "$stuck", verdict: "unverified" },
          },
          { produces: ["criteria"] },
        ),
        fix: agent({ done: { to: "qa" } }),
      }),
      wf({
        qa: agent(
          { pass: "$done", fail: { to: "fix", max: 2 }, unverified: "$stuck" },
          {
            criteria: "required",
            hand_back: { fail: "findings" },
            means: { pass: "every criterion observed", fail: "a criterion fails" },
            verdict: { pass: "pass", fail: "fail", unverified: "unverified" },
          },
        ),
        fix: agent({ done: "qa" }),
      }),
    );
  });

  test("names a shared counter, and leaves a shared file through an exit with its means", () => {
    const shared = {
      review: {
        start: "review",
        steps: {
          review: agent({ approve: { exit: "approved", means: "no blocking findings" }, changes_requested: { exit: "rework", produces: ["findings"] } }),
        },
      },
    };
    const older = {
      review: {
        start: "review",
        steps: {
          review: agent({ approve: { exit: "approved" }, changes_requested: { exit: "rework" } }, { means: { approve: "no blocking findings" }, hand_back: { changes_requested: "findings" } }),
        },
      },
    };
    const doc = wf(
      {
        work: agent({ done: "check", stuck: { to: "$stuck" } }),
        check: { use: "review", outcomes: { approved: "$done", rework: { to: "work", counter: "loop" } } },
      },
      { counters: { loop: { max: 4 } } },
    );
    const a = loaded(loadWorkflow(doc, opts({ sharedFiles: shared }))).pinned;
    const b = loaded(loadWorkflow(doc, opts({ sharedFiles: older }))).pinned;
    expect(a.hash).toBe(b.hash);
    expect(a.doc.steps.review?.means).toEqual({ approve: "no blocking findings" });
  });
});

describe("produces on the step and on each outcome", () => {
  test("the step's list is every outcome's default; an outcome that hands findings back says so and drops the file", () => {
    pinsAlike(
      wf({
        describe: agent({ done: { to: "review" } }, { produces: [{ name: "pr_body", file: "pr.md" }] }),
        review: agent({ approve: "$done", changes_requested: { to: "describe", produces: ["findings"] } }, { inputs: ["pr_body"] }),
      }),
      wf({
        describe: agent({ done: "review" }, { produces: { pr_body: { file: "pr.md" } } }),
        review: agent({ approve: "$done", changes_requested: "describe" }, { inputs: ["pr_body"], hand_back: { changes_requested: "findings" } }),
      }),
    );
  });

  test("an outcome's own list replaces the step's whole, so a file due on fewer outcomes than the old default names them", () => {
    pinsAlike(
      wf({
        write: agent({ done: "$done", partial: { to: "$done", produces: [] }, rework: { to: "write", max: 2, produces: ["notes", "findings"] } }, { produces: [{ name: "notes", file: "notes.md" }] }),
      }),
      wf({
        write: agent({ done: "$done", partial: "$done", rework: { to: "write", max: 2 } }, { produces: { notes: { file: "notes.md", on: ["done", "rework"] } }, hand_back: { rework: "findings" } }),
      }),
    );
  });

  test("a file may be declared on the outcome it is due on alone, and evidence is handed back as findings are", () => {
    pinsAlike(
      wf({ write: agent({ done: { to: "$done", produces: [{ name: "notes", file: "notes.md" }] }, shown: { to: "$done", produces: ["evidence"] } }) }),
      wf({ write: agent({ done: "$done", shown: "$done" }, { produces: { notes: { file: "notes.md", on: ["done"] } }, hand_back: { shown: "evidence" } }) }),
    );
  });

  test("criteria on the outcomes a verdict gates only needs no criteria: required", () => {
    pinsAlike(
      wf({ qa: agent({ pass: { to: "$done", verdict: "pass", produces: ["criteria"] }, blocked: "$stuck" }) }),
      wf({ qa: agent({ pass: "$done", blocked: "$stuck" }, { verdict: { pass: "pass" } }) }),
    );
  });
});

describe("refusals of the outcome form", () => {
  const refused = (doc: unknown, o: Partial<LoadWorkflowOptions> = {}) => errorsOf(loadWorkflow(doc, opts(o)));

  test("a step that writes means both as a map and on an outcome is told to keep one", () => {
    expect(refused(wf({ a: agent({ done: { to: "$done", means: "x" } }, { means: { done: "y" } }) }))).toEqual([
      { path: "/steps/a/means", message: "step 'a' writes means on its outcomes: move these onto the outcomes too (`done: { to: …, means: … }`)" },
    ]);
  });

  test("the old report keys beside an outcome's produces are refused with the spelling to use", () => {
    expect(refused(wf({ a: agent({ done: { to: "$done", produces: ["criteria"] } }, { hand_back: { done: "findings" }, criteria: "required" }) }))).toEqual([
      { path: "/steps/a/criteria", message: "step 'a' lists what its outcomes produce: a criteria report is listed there too (`produces: [criteria]`)" },
      { path: "/steps/a/hand_back", message: "step 'a' lists what its outcomes produce: findings or evidence handed back are listed there too (`produces: [findings]`)" },
    ]);
    expect(refused(wf({ a: agent({ done: { to: "$done", produces: [] } }, { produces: { notes: { file: "n.md" } } }) }))).toEqual([
      { path: "/steps/a/produces", message: "step 'a' lists what its outcomes produce: list the step's files too (`produces: [{ name: notes, file: n.md }]`)" },
    ]);
  });

  test("means, verdict and produces sit on an agent step's outcomes only", () => {
    expect(refused(wf({ a: agent({ done: "g" }), g: { gate: "ok?", outcomes: { approve: { to: "$done", means: "fine" }, reject: { to: "a", produces: ["findings"] } } } }))).toEqual([
      { path: "/steps/g/outcomes/approve/means", message: "`means` describes an outcome an agent reports, and step 'g' is not an agent step" },
      { path: "/steps/g/outcomes/reject/produces", message: "`produces` describes an outcome an agent reports, and step 'g' is not an agent step" },
    ]);
  });

  test("an outcome the kernel takes carries no means, verdict or produces", () => {
    expect(refused(wf({ a: agent({ done: "$done", stuck: { to: "$stuck", means: "gave up" } }) }))).toEqual([
      { path: "/steps/a/outcomes/stuck/means", message: "'stuck' is a route the kernel takes, never one an agent reports: it has no means" },
    ]);
  });

  test("a verdict without a criteria report to read it from", () => {
    expect(refused(wf({ a: agent({ pass: { to: "$done", verdict: "pass" } }) }))).toEqual([
      { path: "/steps/a/outcomes/pass/verdict", message: "outcome 'pass' is gated by verdict 'pass', which is read from a criteria report: add criteria to what it produces" },
    ]);
  });

  test("criteria on some outcomes, one of them without a verdict", () => {
    expect(refused(wf({ a: agent({ pass: { to: "$done", produces: ["criteria"] }, blocked: "$stuck" }) }))).toEqual([
      { path: "/steps/a/outcomes/pass/produces", message: "outcome 'pass' produces criteria but has no verdict: give it one, or produce criteria on every outcome step 'a' reports" },
    ]);
  });

  test("findings and evidence on one outcome", () => {
    expect(refused(wf({ a: agent({ done: { to: "$done", produces: ["findings", "evidence"] } }) }))).toEqual([
      { path: "/steps/a/outcomes/done/produces", message: "outcome 'done' hands back findings or evidence, not both" },
    ]);
  });

  test("a bare name no entry of the step gives a file, a report given a file, and one name given two files", () => {
    expect(
      refused(
        wf({
          a: agent(
            { done: { to: "$done", produces: ["notes", { name: "summary", file: "b.md" }] }, more: { to: "$done", produces: [{ name: "findings", file: "f.json" }] } },
            { produces: [{ name: "summary", file: "a.md" }] },
          ),
        }),
      ),
    ).toEqual([
      { path: "/steps/a/outcomes/done/produces/0", message: "`notes` names no file: declare it once in the step as `{ name: notes, file: <path> }`" },
      { path: "/steps/a/outcomes/done/produces/1/file", message: "`summary` is declared as a.md and as b.md in step 'a': a produced name names one file" },
      { path: "/steps/a/outcomes/more/produces/0", message: "`findings` is a report norn takes with the outcome, never a file: write it as the bare name" },
    ]);
  });

  test("an outcome object needs a target, and goes to a step or leaves by an exit, never both", () => {
    expect(refused(wf({ a: agent({ done: { means: "x" } }) }))).toEqual([{ path: "/steps/a/outcomes/done", message: "outcome 'done' of step 'a' names no target: give it `to:`" }]);
    const shared = { s: { start: "x", steps: { x: agent({ done: { to: "$done", exit: "out" } }) } } };
    expect(refused(wf({ u: { use: "s", outcomes: { out: "$done" } } }), { sharedFiles: shared })).toEqual([
      { path: "/steps/x/outcomes/done", message: "shared/s.yaml: outcome 'done' of step 'x' goes `to:` a step or leaves by `exit:`, not both", shared: "s" },
    ]);
  });

  test("an outcome that leaves by an exit carries no bound: the use step's route for the exit holds it", () => {
    const shared = { s: { start: "x", steps: { x: agent({ done: { exit: "out", max: 2 } }) } } };
    expect(refused(wf({ u: { use: "s", outcomes: { out: "$done" } } }), { sharedFiles: shared })).toEqual([
      { path: "/steps/x/outcomes/done", message: "shared/s.yaml: outcome 'done' of step 'x' leaves by `exit:`: its bound is set on the use step's route for the exit", shared: "s" },
    ]);
  });

  test("a produces list on a step that is not an agent step", () => {
    expect(refused(wf({ a: agent({ done: "g" }), g: { gate: "ok?", produces: ["findings"], outcomes: { approve: "$done", reject: "a" } } }))).toEqual([
      { path: "/steps/g/produces", message: "`produces` lists what an agent step's outcomes produce, and step 'g' is not an agent step" },
    ]);
  });

  test("a step that writes verdict both as a map and on an outcome is told to keep one", () => {
    expect(refused(wf({ a: agent({ pass: { to: "$done", verdict: "pass", produces: ["criteria"] } }, { verdict: { pass: "pass" } }) }))).toEqual([
      { path: "/steps/a/verdict", message: "step 'a' writes verdict on its outcomes: move these onto the outcomes too (`pass: { to: …, verdict: … }`)" },
    ]);
  });

  test("a file the step declares that every outcome's own list leaves out", () => {
    expect(refused(wf({ a: agent({ done: { to: "$done", produces: [] } }, { produces: [{ name: "n", file: "n.md" }] }) }))).toEqual([
      { path: "/steps/a/produces/0", message: "`n` is due on no outcome step 'a' reports: name it in the list of an outcome that writes it" },
    ]);
  });

  test("a step copied with like takes the outcome objects it writes whole", () => {
    pinsAlike(
      wf({
        a: agent({ done: { to: "b", means: "first" }, again: { to: "a", max: 2, means: "again" } }),
        b: { like: "a", outcomes: { done: { to: "$done", means: "second" } } },
      }),
      wf({ a: agent({ done: "b", again: { to: "a", max: 2 } }, { means: { done: "first", again: "again" } }), b: agent({ done: "$done" }, { means: { done: "second" } }) }),
    );
  });
});
