/**
 * What a step reads beyond norn's own inputs and what earlier steps produce: a read marked optional
 * with a trailing `?`, and the workflow's sources, named portably in the workflow and bound to a place
 * by the workflow's `path:` or the machine's config. Sources and optional reads are the first keys the
 * pinned document grows by, so a workflow using neither pins what it always did.
 */
import { describe, expect, test } from "bun:test";
import { DEFAULT_KERNEL_CONFIG, type LoadedWorkflow, type LoadWorkflowOptions, loadWorkflow, validateWorkflowGraph, type WorkflowError, type WorkflowLoad } from "../../src/index.ts";
import { STEP_KINDS } from "../shipped.ts";

const HOST = ["spec", "handoff", "diff", "last_findings"];
const opts = (over: Partial<LoadWorkflowOptions> = {}): LoadWorkflowOptions => ({ stepKinds: STEP_KINDS, sharedFiles: {}, config: DEFAULT_KERNEL_CONFIG, inputs: HOST, ...over });
const wf = (steps: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ name: "t", start: Object.keys(steps)[0], steps, ...extra });
const builder = (reads: unknown[], outcomes: Record<string, unknown> = { done: "$done" }, extra: Record<string, unknown> = {}) => ({ by: "builder", do: "Do the work.", reads, outcomes, ...extra });

function loaded(r: WorkflowLoad): LoadedWorkflow {
  if (!r.ok) throw new Error(JSON.stringify(r.errors, null, 2));
  return r.workflow;
}
const refusals = (doc: unknown, o: Partial<LoadWorkflowOptions> = {}): WorkflowError[] => (loadWorkflow(doc, opts(o)) as { errors?: WorkflowError[] }).errors?.map(({ path, message }) => ({ path, message })) ?? [];

describe("an optional read", () => {
  test("`findings?` is the open findings, today's last_findings: it pins what an older step listing last_findings pins", () => {
    const a = loaded(loadWorkflow(wf({ review: builder(["spec", "findings?"]) }), opts())).pinned;
    const b = loaded(loadWorkflow(wf({ review: builder(["spec", "last_findings"]) }), opts())).pinned;
    expect(a.hash).toBe(b.hash);
    expect(loaded(loadWorkflow(wf({ review: builder(["spec", "findings"]) }), opts())).pinned.hash).toBe(b.hash);
  });

  test("on an input norn provides it pins the bare name, as norn notes such an input when it holds nothing", () => {
    const a = loaded(loadWorkflow(wf({ build: builder(["spec", "diff?"]) }), opts())).pinned;
    const b = loaded(loadWorkflow(wf({ build: builder(["spec", "diff"]) }), opts())).pinned;
    expect(a.hash).toBe(b.hash);
  });

  test("of a produced name needs no producer on every path, and the pin keeps the mark", () => {
    const steps = (read: string) => ({
      plan: { by: "writer", do: "Plan.", produces: [{ name: "notes", file: "notes.md" }], outcomes: { done: "build", skip: "build" } },
      build: builder(["spec", read]),
    });
    const optional = { ...steps("notes?"), plan: { ...steps("notes?").plan, outcomes: { done: { to: "build" }, skip: { to: "build", produces: [] } } } };
    const bare = { ...steps("notes"), plan: { ...steps("notes").plan, outcomes: { done: { to: "build" }, skip: { to: "build", produces: [] } } } };
    expect(refusals(wf(bare))).toEqual([{ path: "/steps/build/inputs/1", message: "step 'build' reads `notes`, but no step produces it on the path plan.skip → build: give a step on that path produces: notes" }]);
    const w = loaded(loadWorkflow(wf(optional), opts()));
    expect(w.pinned.doc.steps.build?.inputs).toEqual(["spec", "notes?"]);
    expect(w.graph.steps.build?.agent?.inputs).toEqual(["spec", "notes?"]);
  });

  test("of a name nothing provides, produces or binds is refused as a bare one is", () => {
    expect(refusals(wf({ build: builder(["spec", "mystery?"]) }))).toEqual([
      { path: "/steps/build/inputs/1", message: "`mystery` is not an input norn provides: name one of spec, handoff, diff, last_findings, or a file as {file: <path>}" },
    ]);
  });
});

describe("a workflow's sources", () => {
  const SOURCES = { adr: { type: "folder" as const, path: "docs/adr" }, brand: { type: "folder" as const } };

  test("a step reads a source by name, bare or optional; the pinned document holds the sources, and the graph each step's required ones", () => {
    const w = loaded(loadWorkflow(wf({ design: builder(["spec", "adr", "brand?"]) }, { sources: SOURCES }), opts()));
    expect(w.pinned.doc.sources).toEqual(SOURCES);
    expect(w.graph.sources).toEqual(SOURCES);
    expect(w.graph.steps.design?.agent?.inputs).toEqual(["spec", "adr", "brand?"]);
    expect(w.graph.steps.design?.agent?.sources).toEqual(["adr"]);
    expect(validateWorkflowGraph(w.graph).ok).toBe(true);
    // a pinned document loads again to its hash, without the host's names, as a unit's pin does
    expect(loaded(loadWorkflow(structuredClone(w.pinned.doc), opts({ inputs: undefined }))).pinned.hash).toBe(w.pinned.hash);
  });

  test("a workflow with sources pins a new hash; one without pins as it did before sources existed", () => {
    const without = loaded(loadWorkflow(wf({ design: builder(["spec"]) }), opts())).pinned;
    const withSources = loaded(loadWorkflow(wf({ design: builder(["spec"]) }, { sources: SOURCES }), opts())).pinned;
    expect(withSources.hash).not.toBe(without.hash);
    expect(Object.keys(without.doc)).not.toContain("sources");
  });

  test("a source named like an input norn provides or a produced name, a path that leaves the repo, and an unknown type are refused at their keys", () => {
    const doc = wf(
      {
        plan: { by: "writer", do: "Plan.", produces: [{ name: "notes", file: "notes.md" }], outcomes: { done: "design" } },
        design: builder(["spec"]),
      },
      { sources: { spec: { type: "folder" }, notes: { type: "file" }, up: { type: "folder", path: "../elsewhere" }, abs: { type: "file", path: "/etc/passwd" } } },
    );
    expect(refusals(doc)).toEqual([
      { path: "/sources/spec", message: "`spec` is an input norn provides: a source takes a name of its own" },
      { path: "/sources/notes", message: "`notes` is a name a step produces: a source takes a name of its own" },
      { path: "/sources/up/path", message: "`../elsewhere` leaves the repo: a source's path is relative to the repo's root, without `..`, with `/` between folders and no drive letter; bind a place outside the repo in the config's sources" },
      { path: "/sources/abs/path", message: "`/etc/passwd` leaves the repo: a source's path is relative to the repo's root, without `..`, with `/` between folders and no drive letter; bind a place outside the repo in the config's sources" },
    ]);
    expect(refusals(wf({ design: builder(["spec"]) }, { sources: { x: { type: "url" } } }))[0]?.path).toBe("/sources/x/type");
  });
});
