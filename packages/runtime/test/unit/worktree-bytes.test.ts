/**
 * Every byte norn writes under a unit's `.agents/specs/` and `.agents/inputs/`, pinned as a snapshot
 * taken on the code before the mount table: the inputs, the brief's input list, the `*` ignore files
 * and the `.base/` copies. A refactor of how these files are written must leave the snapshot as it is.
 */
import { describe, expect, test } from "bun:test";
import { type BriefInputs, type KernelReceipt, type ReceiptData, renderBrief, type UnitJournal } from "@norn/kernel";
import { briefOf, materializeInputs, readBackDocs, writeStoryDoc } from "../../src/index.ts";
import { has, harness, type Harnessed, record, tickUntil, trackerItem } from "./support.ts";

const UNIT = "lt-1";
const WORKTREE = "/machine/repo/worktrees/lt-1";
const SLICE_WORKTREE = "/machine/repo/worktrees/lt-1-01";
const SLICES = ".agents/specs/lt-1/slices";
const ITEM = { title: "Parse and export", body: "Parse the input, then export it.", url: "https://tracker.example/1", labels: ["norn", "docs"] };
const SLICE_01 = "---\nid: lt-1/01\ntitle: Parse the input\ndepends_on: []\ncriteria:\n  - { id: AC1, verifier: test }\n---\n\n## Goal\nParse it.\n";
const SLICE_02 = "---\nid: lt-1/02\ntitle: Export it\ndepends_on: [lt-1/01]\ncriteria:\n  - { id: AC1, verifier: agent }\n---\n\n## Goal\nExport it.\n";
const BASE_SHA = "b".repeat(40);

/** Every file under the worktree's `.agents/specs/` and `.agents/inputs/`, by its path in the worktree. */
function agentFiles(h: Harnessed, worktree: string): Record<string, string> {
  const prefix = `${worktree}/`;
  return Object.fromEntries(
    Object.entries(h.files.snapshot())
      .filter(([p]) => p.startsWith(`${prefix}.agents/specs/`) || p.startsWith(`${prefix}.agents/inputs/`))
      .map(([p, text]) => [p.slice(prefix.length), text]),
  );
}

function briefWith(inputs: BriefInputs["inputs"]): BriefInputs {
  return { workflow: "handed", hash: "0".repeat(64), step: "build", attempt: 1, skills: [], inputs };
}

async function views(h: Harnessed, journal: UnitJournal, inputs: BriefInputs["inputs"]) {
  const made = await materializeInputs(h.env, journal, briefWith(inputs));
  if (!made.ok) throw new Error(made.failure.message);
  return made.value.inputs;
}

function withReceipts(journal: UnitJournal, ...data: ReceiptData[]): UnitJournal {
  const out = structuredClone(journal);
  for (const d of data) {
    const seq = (out.receipts.at(-1)?.seq ?? 0) + 1;
    out.receipts.push({ seq, id: `test-${seq}`, at: "2026-11-17T10:00:00.000Z", data: d } as KernelReceipt);
  }
  return out;
}

const conflict: ReceiptData = { kind: "step.finished", step: "update", attempt: 1, step_kind: "update-branch", outcome: "conflict", detail: { base: { ref: "main", sha: BASE_SHA }, conflicts: ["src/a.ts"] } };
const rejected: ReceiptData = { kind: "gate.decided", step: "approve", attempt: 1, outcome: "reject", by: "jo", reason: "Name the flag." };

async function started(): Promise<Harnessed> {
  const h = harness({ workflow: "handed" });
  h.items.push(trackerItem(1, ITEM));
  await tickUntil(h, has("agent.start"));
  await tickUntil(h, has("receipts.apply"));
  return h;
}

async function sliced(h: Harnessed): Promise<void> {
  await h.files.write(`${WORKTREE}/${SLICES}/01-parse.md`, SLICE_01);
  await h.files.write(`${WORKTREE}/${SLICES}/02-export.md`, SLICE_02);
  await readBackDocs(h.env, UNIT);
}

async function sliceStarted(h: Harnessed, unit: string): Promise<UnitJournal> {
  const story = (await record(h, UNIT)).state;
  if (!story) throw new Error("the story has no state");
  const wrote = await h.env.slots.store.commitState(unit, { ...structuredClone(story), unit, step: "build", attempt: 1, applied_through: 0, run: null }, null);
  if (!wrote.ok) throw new Error(wrote.failure.message);
  return record(h, unit);
}

describe("the bytes norn writes in a worktree", () => {
  test("a story unit, after a tick launched it and a brief rendered, then every other input kind", async () => {
    const h = await started();
    const shown = await briefOf(h.env, UNIT);
    if (!shown.ok) throw new Error(shown.refusal.error);
    expect(shown.value.markdown).toMatchSnapshot("story brief");
    expect(agentFiles(h, WORKTREE)).toMatchSnapshot("story files after the brief");

    await sliced(h);
    const wrote = await writeStoryDoc(h.env, UNIT, "notes.md", "Keep the export streaming.\n");
    if (!wrote.ok) throw new Error(wrote.failure.message);
    const inputs: BriefInputs["inputs"] = ["spec", "handoff", "last_check", "last_findings", "diff", "slice", "slices", "record", "resolution", "base_side", "notes", "mystery", { file: "docs/guide.md", label: "the guide" }];
    const journal = withReceipts(await record(h, UNIT), conflict, rejected);
    const listed = await views(h, journal, inputs);
    expect(renderBrief({ brief: briefWith(inputs), unit: UNIT, outcomes: ["done"], inputs: listed })).toMatchSnapshot("story brief, every input kind");
    expect(agentFiles(h, WORKTREE)).toMatchSnapshot("story files, every input kind");
  });

  test("a slice unit in its own worktree", async () => {
    const h = await started();
    await sliced(h);
    const inputs: BriefInputs["inputs"] = ["spec", "handoff", "slice", "slices", "last_check"];
    const listed = await views(h, await sliceStarted(h, "lt-1/01"), inputs);
    expect(renderBrief({ brief: briefWith(inputs), unit: "lt-1/01", outcomes: ["done"], inputs: listed })).toMatchSnapshot("slice brief");
    expect(agentFiles(h, SLICE_WORKTREE)).toMatchSnapshot("slice files");
  });
});
