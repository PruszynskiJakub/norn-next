import { describe, expect, test } from "bun:test";
import { type BriefInputs, type KernelReceipt, type ReceiptData, renderBrief, type UnitJournal } from "@norn/kernel";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SDLC_PACK } from "@norn/pack-sdlc";
import { parse } from "yaml";
import { REPO_ROOT } from "../../../../test/support/repo-root.ts";
import { materializeInputs, readBackDocs, readStoryDoc, renderInputFrom } from "../../src/index.ts";
import { standing } from "../../src/input-history.ts";
import { has, harness, type Harnessed, record, tickUntil, trackerItem } from "./support.ts";

const UNIT = "lt-1";
const WORKTREE = "/machine/repo/worktrees/lt-1";
const SLICE_WORKTREE = "/machine/repo/worktrees/lt-1-01";
const SLICES = ".agents/specs/lt-1/slices";
const BASE_SHA = "b".repeat(40);
const ANCHOR = "a".repeat(40);
const HEAD = "c".repeat(40);
const SLICE_01 = "---\nid: lt-1/01\ntitle: Parse the input\ndepends_on: []\ncriteria:\n  - { id: AC1, verifier: test }\n---\n\n## Goal\nParse it.\n";
const SLICE_02 = "---\nid: lt-1/02\ntitle: Export it\ndepends_on: [lt-1/01]\ncriteria:\n  - { id: AC1, verifier: agent }\n---\n\n## Goal\nExport it.\n";

async function started(): Promise<Harnessed> {
  const h = harness({ workflow: "handed" });
  h.items.push(trackerItem(1, { title: "Parse and export" }));
  await tickUntil(h, has("agent.start"));
  await tickUntil(h, has("receipts.apply"));
  return h;
}

function briefWith(inputs: string[]): BriefInputs {
  return { workflow: "handed", hash: "0".repeat(64), step: "build", attempt: 1, skills: [], inputs };
}

async function views(h: Harnessed, journal: UnitJournal, inputs: string[]) {
  const made = await materializeInputs(h.env, journal, briefWith(inputs));
  if (!made.ok) throw new Error(made.failure.message);
  return made.value.inputs;
}

async function only(h: Harnessed, journal: UnitJournal, input: string) {
  const [v] = await views(h, journal, [input]);
  if (!v) throw new Error(`no view for ${input}`);
  return v;
}

/** The journal with `data` appended as its newest receipts, for a resolver that reads only the unit's own record. */
function withReceipts(journal: UnitJournal, ...data: ReceiptData[]): UnitJournal {
  const out = structuredClone(journal);
  for (const d of data) {
    const seq = (out.receipts.at(-1)?.seq ?? 0) + 1;
    out.receipts.push({ seq, id: `test-${seq}`, at: "2026-11-17T10:00:00.000Z", data: d } as KernelReceipt);
  }
  return out;
}

const updateFinished = (outcome: string, detail: unknown): ReceiptData => ({ kind: "step.finished", step: "update", attempt: 1, step_kind: "update-branch", outcome, detail });
const conflict = updateFinished("conflict", { base: { ref: "main", sha: BASE_SHA }, conflicts: ["src/a.ts", "docs/it's.md"] });
const resolved = updateFinished("resolved", { base: { ref: "main", sha: BASE_SHA }, head: HEAD, merged: true, anchor: ANCHOR });
const STORY_SHA = "d".repeat(40);
const integrateConflict: ReceiptData = {
  kind: "step.finished",
  step: "integrate",
  attempt: 1,
  step_kind: "integrate",
  outcome: "conflict",
  detail: { story_branch: "norn/lt-1", slice_head: HEAD, base: { ref: "norn/lt-1", sha: STORY_SHA }, conflicts: ["src/a.ts", "src/b.ts"] },
};

/** The slice step wrote two slice files in the story's worktree and reported. */
async function sliced(h: Harnessed): Promise<void> {
  await h.files.write(`${WORKTREE}/${SLICES}/01-parse.md`, SLICE_01);
  await h.files.write(`${WORKTREE}/${SLICES}/02-export.md`, SLICE_02);
  await readBackDocs(h.env, UNIT);
}

/** A slice unit with a run state, as starting the slices would leave it. */
async function sliceStarted(h: Harnessed, unit: string): Promise<UnitJournal> {
  const story = (await record(h, UNIT)).state;
  if (!story) throw new Error("the story has no state");
  const state = { ...structuredClone(story), unit, step: "build", attempt: 1, applied_through: 0, run: null };
  const wrote = await h.env.slots.store.commitState(unit, state, null);
  if (!wrote.ok) throw new Error(wrote.failure.message);
  return record(h, unit);
}

const sliceJournal = (unit: string): UnitJournal => ({ unit, version: null, state: null, receipts: [], unapplied: [] });

describe("the slice files as inputs", () => {
  test("before the slice step wrote any, `slices` names the folder to write them to", async () => {
    const h = await started();
    const v = await only(h, await record(h, UNIT), "slices");
    expect(v).toEqual({ name: "slices", label: "every slice file of the story: scope, dependencies, acceptance criteria", path: `${SLICES}/`, note: `no slice files yet: the slice step writes them to \`${SLICES}/\`` });
  });

  test("slice files written in the story's worktree are read back as the story's documents", async () => {
    const h = await started();
    await sliced(h);
    expect(await readStoryDoc(h.env, UNIT, "slices/01-parse.md")).toEqual({ ok: true, value: SLICE_01 });
    expect(await readStoryDoc(h.env, UNIT, "slices/02-export.md")).toEqual({ ok: true, value: SLICE_02 });
  });

  test("`slices` writes every slice file and says where each slice stands", async () => {
    const h = await started();
    await sliced(h);
    await sliceStarted(h, "lt-1/01");
    // a fresh checkout of the story: only the documents carry the files there
    await h.files.remove(`${WORKTREE}/${SLICES}/01-parse.md`);
    await h.files.remove(`${WORKTREE}/.agents/inputs/.base/specs/lt-1/slices/01-parse.md`);
    const v = await only(h, await record(h, UNIT), "slices");
    expect(v.path).toBe(`${SLICES}/`);
    expect(v.text).toBe("The slice files, each with where its slice stands:\n\n- `01-parse.md`: at `build` #1\n- `02-export.md`: not started");
    expect(await h.files.read(`${WORKTREE}/${SLICES}/01-parse.md`)).toBe(SLICE_01);
  });

  test("a slice gets its own slice file in its own worktree, with a person's edit in the story's worktree", async () => {
    const h = await started();
    await sliced(h);
    // the person edits the file at the slice gate, in the story's worktree
    const edited = SLICE_01.replace("Parse it.", "Parse it, strictly.");
    await h.files.write(`${WORKTREE}/${SLICES}/01-parse.md`, edited);
    const v = await only(h, await sliceStarted(h, "lt-1/01"), "slice");
    expect(v).toEqual({ name: "slice", label: "this slice's file: its scope, dependencies and acceptance criteria, each with its verifier", path: `${SLICES}/01-parse.md` });
    expect(await h.files.read(`${SLICE_WORKTREE}/${SLICES}/01-parse.md`)).toBe(edited);
    expect(await h.files.read(`${SLICE_WORKTREE}/${SLICES}/02-export.md`)).toBeNull();
  });

  test("a slice agent's edit to its slice file is read back when it reports", async () => {
    const h = await started();
    await sliced(h);
    await only(h, await sliceStarted(h, "lt-1/01"), "slice");
    await h.files.write(`${SLICE_WORKTREE}/${SLICES}/01-parse.md`, SLICE_01.replace("depends_on: []", "depends_on: []\nstatus: built"));
    await readBackDocs(h.env, "lt-1/01");
    const kept = await readStoryDoc(h.env, UNIT, "slices/01-parse.md");
    expect(kept.ok && kept.value).toContain("status: built");
  });

  test("`slice` says precisely why there is no file: a slice none was written for, or the story itself", async () => {
    const h = await started();
    await sliced(h);
    expect((await only(h, sliceJournal("lt-1/03"), "slice")).note).toBe("norn holds no slice file for lt-1/03: none named `slices/03-<slug>.md` was written to the story's spec folder");
    expect((await only(h, await record(h, UNIT), "slice")).note).toBe("lt-1 is the story, not a slice: it has no slice file of its own (`slices` names them all)");
  });
});

describe("the base side of a conflict", () => {
  test("before any base update, and after one that did not conflict, it says no conflict sent the unit here", async () => {
    const h = await started();
    const journal = await record(h, UNIT);
    expect((await only(h, journal, "base_side")).note).toBe("no base update has run for this unit yet, so no base conflict sent it here");
    const after = withReceipts(journal, conflict, resolved);
    expect((await only(h, after, "base_side")).note).toBe(`no base conflict sent this unit here: the last base update (\`update\`, receipt ${after.receipts.at(-1)?.seq}) ended \`resolved\``);
  });

  test("after a conflict it names the base commit to merge and, per path, what the base changed there", async () => {
    const h = await started();
    const v = await only(h, withReceipts(await record(h, UNIT), conflict), "base_side");
    expect(v.path).toBe(".agents/inputs/base_side.md");
    const text = (await h.files.read(`${WORKTREE}/.agents/inputs/base_side.md`)) ?? "";
    expect(text).toContain(`could not merge \`main\` at \`${BASE_SHA}\` into the story branch \`norn/lt-1\`: it conflicts in 2 paths.`);
    expect(text).toContain(`\`git merge ${BASE_SHA}\``);
    expect(text).toContain(`- \`src/a.ts\`: the commits \`git log --format='%h %an %s' $(git merge-base HEAD ${BASE_SHA})..${BASE_SHA} -- 'src/a.ts'\`, the change \`git diff $(git merge-base HEAD ${BASE_SHA}) ${BASE_SHA} -- 'src/a.ts'\``);
    expect(text).toContain(`-- 'docs/it'\\''s.md'`);
  });

  test("the merge base the vcs knows is named rather than computed by the agent", async () => {
    const h = await started();
    h.env.slots.vcs.mergeBase = async () => ({ ok: true, value: ANCHOR });
    await only(h, withReceipts(await record(h, UNIT), conflict), "base_side");
    expect(await h.files.read(`${WORKTREE}/.agents/inputs/base_side.md`)).toContain(`git diff ${ANCHOR} ${BASE_SHA} -- 'src/a.ts'`);
  });

  test("a slice whose integrate conflicted is given the story branch's commit to merge and, per path, what the story branch changed there", async () => {
    const h = await started();
    await sliced(h);
    const slice = withReceipts(await sliceStarted(h, "lt-1/01"), integrateConflict);
    const v = await only(h, slice, "base_side");
    expect(v.path).toBe(".agents/inputs/base_side.md");
    const text = (await h.files.read(`${SLICE_WORKTREE}/.agents/inputs/base_side.md`)) ?? "";
    expect(text).toContain(`Integrating this slice into the story branch \`norn/lt-1\` at \`integrate\` conflicted with it at \`${STORY_SHA}\`: 2 paths.`);
    expect(text).toContain(`\`git merge ${STORY_SHA}\``);
    expect(text).toContain(`- \`src/a.ts\`: the commits \`git log --format='%h %an %s' $(git merge-base HEAD ${STORY_SHA})..${STORY_SHA} -- 'src/a.ts'\``);
    expect(text).toContain("`src/b.ts`");
  });
});

/** What a step of a workflow file lists for its brief: `reads:` in the step form, `inputs:` in the older one. */
function listedInputs(text: string, step: string): string[] {
  const s = (parse(text) as { steps: Record<string, { reads?: unknown[]; inputs?: unknown[] }> }).steps[step];
  return (s?.reads ?? s?.inputs ?? []).filter((i): i is string => typeof i === "string");
}

/** The steps a pack or repo workflow sends to merge a base or story-branch commit, and the inputs each lists in its file. */
function resolverInputs(): { where: string; inputs: string[] }[] {
  const of = (where: string, text: string, step: string) => ({ where: `${where}#${step}`, inputs: listedInputs(text, step) });
  const repo = (file: string) => readFileSync(join(REPO_ROOT, ".agents", "workflows", file), "utf8");
  return [
    of("pack shared/sync.yaml", SDLC_PACK.shared["sync.yaml"] ?? "", "sync-resolve"),
    of("pack refinement.yaml", SDLC_PACK.workflows["refinement.yaml"] ?? "", "sync-resolve"),
    of("pack shared/base-update.yaml", SDLC_PACK.shared["base-update.yaml"] ?? "", "resolve"),
    of("repo shared/sync.yaml", repo("shared/sync.yaml"), "sync-resolve"),
    of("repo refinement.yaml", repo("refinement.yaml"), "sync-resolve"),
    of("repo release.yaml", repo("release.yaml"), "resolve"),
    of("repo shared/base-update.yaml", repo("shared/base-update.yaml"), "resolve"),
  ];
}

describe("each step sent to merge the base, as its workflow file lists its inputs", () => {
  test("is given the base commit and the conflicting paths in base_side after its update conflicted", async () => {
    const h = await started();
    const journal = withReceipts(await record(h, UNIT), conflict);
    for (const { where, inputs } of resolverInputs()) {
      const made = await materializeInputs(h.env, journal, briefWith(inputs));
      if (!made.ok) throw new Error(made.failure.message);
      const view = made.value.inputs.find((i) => i.name === "base_side");
      expect({ where, path: view?.path }).toEqual({ where, path: ".agents/inputs/base_side.md" });
      const text = (await h.files.read(`${WORKTREE}/.agents/inputs/base_side.md`)) ?? "";
      expect({ where, sha: text.includes(`\`git merge ${BASE_SHA}\``), a: text.includes("`src/a.ts`"), b: text.includes("`docs/it's.md`") }).toEqual({ where, sha: true, a: true, b: true });
      await h.files.remove(`${WORKTREE}/.agents/inputs/base_side.md`);
    }
  });

  test("the slice's merge step is given the story branch's commit and the paths after integrate conflicted", async () => {
    const h = await started();
    await sliced(h);
    const slice = withReceipts(await sliceStarted(h, "lt-1/01"), integrateConflict);
    const steps = [
      { where: "pack slice.yaml#merge", text: SDLC_PACK.workflows["slice.yaml"] ?? "" },
      { where: "repo slice.yaml#merge", text: readFileSync(join(REPO_ROOT, ".agents", "workflows", "slice.yaml"), "utf8") },
    ];
    for (const { where, text } of steps) {
      const inputs = listedInputs(text, "merge");
      const made = await materializeInputs(h.env, slice, briefWith(inputs));
      if (!made.ok) throw new Error(made.failure.message);
      expect({ where, path: made.value.inputs.find((i) => i.name === "base_side")?.path }).toEqual({ where, path: ".agents/inputs/base_side.md" });
      const file = (await h.files.read(`${SLICE_WORKTREE}/.agents/inputs/base_side.md`)) ?? "";
      expect({ where, sha: file.includes(`\`git merge ${STORY_SHA}\``), a: file.includes("`src/a.ts`"), b: file.includes("`src/b.ts`") }).toEqual({ where, sha: true, a: true, b: true });
      await h.files.remove(`${SLICE_WORKTREE}/.agents/inputs/base_side.md`);
    }
  });
});

describe("the resolution to review", () => {
  test("before any update ended resolved it says there is nothing to review", async () => {
    const h = await started();
    const journal = withReceipts(await record(h, UNIT), conflict);
    expect((await only(h, journal, "resolution")).note).toBe("no base update of this unit has ended `resolved` yet, so there is no resolution to review");
  });

  test("after a resolved update it gives the remerge-diffs since the anchor and the conflicts this round recorded", async () => {
    const h = await started();
    const v = await only(h, withReceipts(await record(h, UNIT), conflict, resolved), "resolution");
    expect(v.path).toBe(".agents/inputs/resolution.md");
    expect(v.text).toContain(`git log --first-parent --merges --remerge-diff --format='%H %s' ${ANCHOR}..${HEAD}`);
    expect(v.text).toContain(`- \`update\` could not merge \`main\` at \`${BASE_SHA.slice(0, 12)}\` (2026-11-17T10:00:00.000Z): \`src/a.ts\`, \`docs/it's.md\``);
  });
});

describe("the last findings", () => {
  const reject: ReceiptData = { kind: "gate.decided", step: "ready", attempt: 1, outcome: "reject", by: "jo", reason: "Rename the flag." };
  const approve: ReceiptData = { kind: "gate.decided", step: "ready", attempt: 2, outcome: "approve", by: "jo" };
  const red: ReceiptData = { kind: "check.finished", step: "test", attempt: 1, run_id: "r-test", exit: 1, outcome: "fail" };

  async function lastFindings(h: Harnessed, journal: UnitJournal, reworkFrom?: number) {
    const brief = { ...briefWith(["last_findings"]), ...(reworkFrom !== undefined && { rework_from: reworkFrom }) };
    const made = await materializeInputs(h.env, journal, brief);
    if (!made.ok) throw new Error(made.failure.message);
    const text = await h.files.read(`${WORKTREE}/.agents/inputs/last_findings.md`);
    return { view: made.value.inputs[0], text };
  }

  test("are the findings of the receipt that sent the unit back", async () => {
    const h = await started();
    const journal = withReceipts(await record(h, UNIT), reject);
    const { view, text } = await lastFindings(h, journal, journal.receipts.at(-1)?.seq);
    expect(view?.path).toBe(".agents/inputs/last_findings.md");
    expect(text).toContain("Rename the flag.");
  });

  test("a red check that sent the unit back after a later approval never brings back the findings that approval settled", async () => {
    const h = await started();
    const rejected = withReceipts(await record(h, UNIT), reject);
    expect((await lastFindings(h, rejected, rejected.receipts.at(-1)?.seq)).text).toContain("Rename the flag.");
    const journal = withReceipts(rejected, approve, red);
    const { view, text } = await lastFindings(h, journal, journal.receipts.at(-1)?.seq);
    expect(view?.note).toContain("the check");
    expect(text ?? "").not.toContain("Rename the flag.");
  });

  test("a step nothing sent back reads the latest findings this round, and none once a later approval settled them", async () => {
    const h = await started();
    const answered = await lastFindings(h, withReceipts(await record(h, UNIT), reject));
    expect(answered.text).toContain("Rename the flag.");
    const h2 = await started();
    const settled = await lastFindings(h2, withReceipts(await record(h2, UNIT), reject, approve, red));
    expect(settled.view?.note).toBeDefined();
    expect(settled.text ?? "").not.toContain("Rename the flag.");
  });

  /** The journal with its review step handing `changes_requested` back as findings, as the slice workflow's review does. */
  function reviewHandsBack(journal: UnitJournal): UnitJournal {
    const out = structuredClone(journal);
    const steps = out.state?.workflow.doc.steps as Record<string, { hand_back?: Record<string, string> }> | undefined;
    if (!steps?.review) throw new Error("the workflow has no review step");
    steps.review.hand_back = { changes_requested: "findings" };
    return out;
  }
  const requested: ReceiptData = { kind: "run.reported", step: "review", attempt: 1, run_id: "r-review-1", verb: "done", outcome: "changes_requested", text: "Handle the empty input." };
  const reviewed: ReceiptData = { kind: "run.reported", step: "review", attempt: 2, run_id: "r-review-2", verb: "done", outcome: "approve", text: "All criteria met." };
  const green: ReceiptData = { kind: "check.finished", step: "test", attempt: 2, run_id: "r-test-2", exit: 0, outcome: "pass" };

  test("a review of rework still reads the review findings it answers when a red check came between", async () => {
    const h = await started();
    const journal = withReceipts(reviewHandsBack(await record(h, UNIT)), requested, red, green);
    const { text } = await lastFindings(h, journal);
    expect(text).toContain("Handle the empty input.");
  });

  test("a red check after a later clean review never brings back the findings that review settled", async () => {
    const h = await started();
    const journal = withReceipts(reviewHandsBack(await record(h, UNIT)), requested, reviewed, red);
    const sent = await lastFindings(h, journal, journal.receipts.at(-1)?.seq);
    expect(sent.text ?? "").not.toContain("Handle the empty input.");
    const h2 = await started();
    const fallback = await lastFindings(h2, withReceipts(reviewHandsBack(await record(h2, UNIT)), requested, reviewed, red));
    expect(fallback.text ?? "").not.toContain("Handle the empty input.");
  });

  test("findings of an earlier round are never shown in a new one", async () => {
    const h = await started();
    const before = await record(h, UNIT);
    const workflow = before.state?.workflow;
    if (!workflow) throw new Error("the unit has no workflow");
    const round: ReceiptData = { kind: "round.started", workflow, at: "build", by: "jo" };
    const { view, text } = await lastFindings(h, withReceipts(before, reject, round));
    expect(text).toBeNull();
    expect(view?.note).toBe("no findings sent this work back");
  });

  test("the note for a step a red check sent back names `last_check` only when the step reads it", async () => {
    const h = await started();
    const journal = withReceipts(await record(h, UNIT), red);
    const { view } = await lastFindings(h, journal, journal.receipts.at(-1)?.seq);
    expect(view?.note).toContain("under Rework");
    expect(view?.note).not.toContain("last_check");
  });
});

describe("the story's record", () => {
  test("names each unit's outcomes, gate rulings and criteria reports with their evidence", async () => {
    const h = await started();
    const append = async (unit: string, id: string, data: ReceiptData) => {
      const r = await h.env.slots.store.appendReceipt(unit, { id, data });
      if (!r.ok) throw new Error(r.failure.message);
    };
    await append(UNIT, "qa-1", { kind: "run.reported", step: "qa", attempt: 1, run_id: "r-qa", verb: "done", outcome: "partial", text: "All but the look checked.", criteria: [{ id: "AC1", verdict: "pass", evidence: "help.test.ts passes" }, { id: "AC2", verdict: "person", how: "open the help page" }] });
    await append(UNIT, "hq-1", { kind: "gate.decided", step: "human-qa", attempt: 1, outcome: "approve", by: "jo", reason: "Looks right." });
    await sliceStarted(h, "lt-1/01");
    const v = await only(h, await record(h, UNIT), "record");
    expect(v.path).toBe(".agents/inputs/record.md");
    const text = (await h.files.read(`${WORKTREE}/.agents/inputs/record.md`)) ?? "";
    expect(text).toContain("## `lt-1` (the story): at `build` #1");
    expect(text).toContain("- `qa #1` reported `done partial`: All but the look checked. (criteria report below)");
    expect(text).toContain("- `human-qa #1` decided `approve` by jo: Looks right.");
    expect(text).toContain("- `AC1` pass; evidence: help.test.ts passes");
    expect(text).toContain("- `AC2` person; how to check: open the help page");
    expect(text).toContain("## `lt-1/01`: at `build` #1\n\n- nothing reported yet");
  });
});

describe("where a unit stands", () => {
  test("a unit waiting on its agent's question names the question", async () => {
    const h = await started();
    const before = await record(h, UNIT);
    const state = before.state;
    if (!state) throw new Error("the unit has no state");
    const asked: UnitJournal = { ...before, state: { ...state, status: "parked", parked: { reason: "agent.asked", since: "2026-11-17T09:00:00.000Z", text: "Which  db\nshould it use?" } } as typeof state };
    expect(standing(asked)).toBe('waits at `build` #1: agent.asked: "Which db should it use?"');
    const bare: UnitJournal = { ...before, state: { ...state, status: "parked", parked: { reason: "gate", since: "2026-11-17T09:00:00.000Z" } } as typeof state };
    expect(standing(bare)).toBe("waits at `build` #1: gate");
  });
});

describe("the brief", () => {
  test("lists each of these inputs with the path it was written to", async () => {
    const h = await started();
    await sliced(h);
    const inputs = ["slices", "record", "resolution", "base_side"];
    const story = withReceipts(await record(h, UNIT), conflict, resolved);
    const md = renderBrief({ brief: briefWith(inputs), unit: UNIT, outcomes: ["done"], inputs: await views(h, story, inputs) });
    expect(md).toContain(`- \`slices\` — every slice file of the story: scope, dependencies, acceptance criteria: \`${SLICES}/\``);
    expect(md).toContain("- `record` — the story's record: every unit's outcomes, gate rulings and criteria reports with their evidence: `.agents/inputs/record.md`");
    expect(md).toContain("- `resolution` — the resolution to review: each merge's remerge-diff and the conflicts this round recorded: `.agents/inputs/resolution.md`");
    expect(md).toContain("- `base_side` — the base side of the conflict: the base commit to merge and what it changed in each conflicting path. no base conflict sent this unit here");
    const conflicted = withReceipts(await record(h, UNIT), conflict);
    const slice = await sliceStarted(h, "lt-1/01");
    const sliceMd = renderBrief({ brief: briefWith(["slice"]), unit: "lt-1/01", outcomes: ["done"], inputs: await views(h, slice, ["slice"]) });
    expect(sliceMd).toContain(`- \`slice\` — this slice's file: its scope, dependencies and acceptance criteria, each with its verifier: \`${SLICES}/01-parse.md\``);
    const baseMd = renderBrief({ brief: briefWith(["base_side"]), unit: UNIT, outcomes: ["done"], inputs: await views(h, conflicted, ["base_side"]) });
    expect(baseMd).toContain("- `base_side` — the base side of the conflict: the base commit to merge and what it changed in each conflicting path: `.agents/inputs/base_side.md`");
  });
});

describe("the brief's history, rulings and retry notice", () => {
  async function rendered(h: Harnessed, journal: UnitJournal, brief: BriefInputs = briefWith([]), runId?: string) {
    const got = await renderInputFrom(h.env, journal, { ...brief, hash: journal.state?.workflow.hash ?? brief.hash }, runId, WORKTREE);
    if (!got.ok) throw new Error(got.failure.message);
    return got.value;
  }
  const checked = (attempt: number): ReceiptData => ({ kind: "check.finished", step: "test", attempt, run_id: `r-test-${attempt}`, exit: 1, outcome: "fail" });
  const ruled = (attempt: number, reason: string): ReceiptData => ({ kind: "gate.decided", step: "ready", attempt, outcome: "reject", by: "jo", reason });

  test("a long history keeps its newest lines and counts the ones it left out", async () => {
    const h = await started();
    const journal = withReceipts(await record(h, UNIT), ...Array.from({ length: 25 }, (_, i) => checked(i + 1)));
    const history = (await rendered(h, journal)).history ?? [];
    expect(history).toHaveLength(20);
    expect(history[0]).toMatch(/^… \d+ earlier$/);
    expect(history.at(-1)).toBe("`test #25` check exited 1 (`fail`)");
  });

  test("a retry's notice counts the nudges the session it replaces was sent", async () => {
    const h = await started();
    const journal = withReceipts(
      await record(h, UNIT),
      { kind: "nudge.sent", run_id: "r-old", reason: "quiet" },
      { kind: "nudge.sent", run_id: "r-old", reason: "quiet" },
      { kind: "run.started", run_id: "r-new", run_kind: "agent", executor: "claude", attended: false, retry_of: "r-old" },
    );
    expect((await rendered(h, journal, briefWith([]), "r-new")).retry).toBe("run `r-old`, nudged 2 times");
  });

  test("the record says where a person moved the unit and why", async () => {
    const h = await started();
    const journal = withReceipts(await record(h, UNIT), { kind: "step.moved", to: "build", by: "jo", reason: "Try the parser again." });
    await h.env.journal.record(UNIT, { id: "01JD5G0000MOVED00000000000", data: { kind: "step.moved", to: "build", by: "jo", reason: "Try the parser again." } });
    const v = await only(h, await record(h, UNIT), "record");
    expect(await h.files.read(`${WORKTREE}/${v.path}`)).toContain("- moved to `build` by jo: Try the parser again.");
    expect((await rendered(h, journal)).history?.at(-1)).toBe("moved to `build` by jo");
  });

  test("rulings keep the newest few, and leave out the one already under Rework", async () => {
    const h = await started();
    for (let i = 1; i <= 12; i++) await h.env.journal.record(UNIT, { id: `01JD5G0000RULING${String(i).padStart(10, "0")}`, data: ruled(i, `Ruling ${i}.`) });
    const journal = await record(h, UNIT);
    const rulings = (await rendered(h, journal, { ...briefWith([]), rework_from: journal.receipts.at(-1)?.seq as number })).rulings ?? [];
    expect(rulings.some((r) => r.includes("Ruling 12."))).toBe(false);
    expect(rulings.some((r) => r.includes("Ruling 11."))).toBe(true);
    expect(rulings.some((r) => r.includes("Ruling 1."))).toBe(false);
    expect(rulings[0]).toMatch(/^… \d+ earlier/);
    expect(rulings.length).toBeLessThanOrEqual(11);
  });
});

