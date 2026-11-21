import { describe, expect, test } from "bun:test";
import { briefOf, readStoryDoc, reportRun } from "../../src/index.ts";
import { has, harness, type Harnessed, record, tickUntil, trackerItem } from "./support.ts";

const UNIT = "lt-1";
const WORKTREE = "/machine/repo/worktrees/lt-1";
const NOTES = `${WORKTREE}/.agents/specs/lt-1/notes/out.md`;

async function at(step: string): Promise<{ h: Harnessed; runId: string }> {
  const h = harness({ workflow: "produced" });
  h.items.push(trackerItem(1));
  await tickUntil(h, has("agent.start"));
  await tickUntil(h, has("receipts.apply"));
  const runId = (await record(h, UNIT)).state?.run?.id;
  if (!runId) throw new Error("no run started");
  expect((await record(h, UNIT)).state?.run?.step).toBe(step);
  return { h, runId };
}

async function brief(h: Harnessed): Promise<string> {
  const r = await briefOf(h.env, UNIT);
  if (!r.ok) throw new Error(r.refusal.error);
  return r.value.markdown;
}

describe("a step's produced files", () => {
  test("the brief says which file each outcome needs, and norn done is refused while it is missing or empty, naming the file", async () => {
    const { h, runId } = await at("write");
    expect(await brief(h)).toContain("- `notes` → `.agents/specs/lt-1/notes/out.md`, before `norn done done`: a report without it, or with it empty, is refused.");
    const missing = await reportRun(h.env, UNIT, runId, { verb: "done", outcome: "done" }, "r1");
    expect(missing).toEqual({
      ok: false,
      refusal: {
        error: "step write produces `notes` with outcome done, and .agents/specs/lt-1/notes/out.md is missing",
        do_instead: "write .agents/specs/lt-1/notes/out.md (`notes`, which later steps read) in the worktree, then report again",
        code: "produced_missing",
      },
    });
    await h.files.write(NOTES, "  \n");
    const empty = await reportRun(h.env, UNIT, runId, { verb: "done", outcome: "done" }, "r1");
    expect(!empty.ok && empty.refusal.error).toBe("step write produces `notes` with outcome done, and .agents/specs/lt-1/notes/out.md is empty");
    // an ask hands nothing on, so the file is not asked for
    expect((await reportRun(h.env, UNIT, runId, { verb: "ask", question: "Which notes?" }, "r0")).ok).toBe(true);
  });

  test("an outcome the file is not due on reports without it", async () => {
    const { h, runId } = await at("write");
    expect((await reportRun(h.env, UNIT, runId, { verb: "done", outcome: "skip" }, "r1")).ok).toBe(true);
  });

  test("the file is read back into the story's documents when the step reports, the next step gets it as its input, and a step kind reading it is handed its path", async () => {
    const { h, runId } = await at("write");
    await h.files.write(NOTES, "# Notes\n\nThe parser is done.\n");
    expect((await reportRun(h.env, UNIT, runId, { verb: "done", outcome: "done" }, "r1")).ok).toBe(true);
    const kept = await readStoryDoc(h.env, UNIT, "notes/out.md");
    expect(kept.ok && kept.value).toBe("# Notes\n\nThe parser is done.\n");
    await tickUntil(h, async () => (await record(h, UNIT)).state?.run?.step === "read");
    // the next step may run in another checkout: only the story's documents carry the file there
    await h.files.remove(NOTES);
    expect(await brief(h)).toContain("- `notes` — produced by step write: `.agents/specs/lt-1/notes/out.md`");
    expect(await h.files.read(NOTES)).toBe("# Notes\n\nThe parser is done.\n");
    const read = (await record(h, UNIT)).state?.run?.id as string;
    expect((await reportRun(h.env, UNIT, read, { verb: "done", outcome: "done" }, "r2")).ok).toBe(true);
    await tickUntil(h, () => h.stepCalls.length > 0);
    expect((h.stepCalls[0]?.input as { reads?: Record<string, string> }).reads).toEqual({ notes: ".agents/specs/lt-1/notes/out.md" });
  });
});
