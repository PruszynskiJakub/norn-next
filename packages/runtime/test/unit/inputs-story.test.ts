import { describe, expect, test } from "bun:test";
import { type BriefInputs, type KernelReceipt, type ReceiptData, renderBrief, type UnitJournal } from "@norn/kernel";
import { materializeInputs, readBackDocs, readStoryDoc } from "../../src/index.ts";
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

  test("a step nothing sent back reads the findings of the latest send-back, and none when that was a red check", async () => {
    const h = await started();
    const answered = await lastFindings(h, withReceipts(await record(h, UNIT), reject));
    expect(answered.text).toContain("Rename the flag.");
    const h2 = await started();
    const settled = await lastFindings(h2, withReceipts(await record(h2, UNIT), reject, approve, red));
    expect(settled.view?.note).toBeDefined();
    expect(settled.text ?? "").not.toContain("Rename the flag.");
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
