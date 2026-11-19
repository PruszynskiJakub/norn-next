import { describe, expect, test } from "bun:test";
import { dropUnitBranch, writeStoryDoc } from "../../src/index.ts";
import { type Harnessed, has, harness, tickUntil, trackerItem } from "./support.ts";

const finishOf = (reports: Awaited<ReturnType<typeof tickUntil>>) => structuredClone(reports.at(-1)?.outcomes.find((o) => o.decision.rule === "story.finish"));

/** Remote copies of branches, by branch name. */
const withRemote = (h: Harnessed, copies: Record<string, string>) => {
  h.env.slots.vcs.remoteRef = async (branch) => ({ ok: true, value: copies[branch] ?? null });
};

describe("a finished story's branches", () => {
  test("finishing a done story deletes its local branch once the base holds every commit on it, after its worktree goes", async () => {
    const h = harness();
    h.items.push(trackerItem(1));
    h.heads["norn/lt-1"] = "c1";
    h.heads.main = "c1";
    const finish = finishOf(await tickUntil(h, has("story.finish")));
    expect(finish).toMatchObject({ ok: true, detail: { removed: ["lt-1"], branches_removed: ["norn/lt-1"], branches_kept: [] } });
    const ops = h.vcsCalls.map((c) => `${c.op} ${c.args[0]}`);
    expect(ops).toContain("deleteBranch norn/lt-1");
    expect(ops.lastIndexOf("remove lt-1")).toBeLessThan(ops.indexOf("deleteBranch norn/lt-1"));
  });

  test("a branch holding a commit nowhere else is kept, with the reason, and the finish still succeeds", async () => {
    const h = harness();
    h.items.push(trackerItem(1));
    h.heads["norn/lt-1"] = "c2";
    h.heads.main = "c1";
    const reports = await tickUntil(h, has("story.finish"));
    expect(finishOf(reports)).toMatchObject({
      ok: true,
      detail: { branches_removed: [], branches_kept: [{ branch: "norn/lt-1", reason: "its head c2 is on neither the base (main) nor a remote copy" }] },
    });
    expect(h.vcsCalls.some((c) => c.op === "deleteBranch")).toBe(false);
    expect(reports.at(-1)?.outcomes.find((o) => o.decision.rule === "claim.release")?.ok).toBe(true);
  });

  test("a sliced story's slice branches go before its own, whose branch is where the integrated slices are found", async () => {
    const h = harness({ workflow: "sliced", kernel: { sliceWorkflow: "checked" } });
    h.items.push(trackerItem(1));
    const wrote = await writeStoryDoc(h.env, "lt-1", "slices/01-parse.md", ["---", "id: lt-1/01", "depends_on: []", "status: planned", "---", "## Goal", ""].join("\n"));
    expect(wrote.ok).toBe(true);
    // the slice is on the story's branch only, and the story's branch only on its remote copy
    h.heads["norn/lt-1-01"] = "s1";
    h.heads["norn/lt-1"] = "s1";
    h.heads["origin/norn/lt-1"] = "s1";
    h.heads.main = "m0";
    withRemote(h, { "norn/lt-1": "origin/norn/lt-1" });
    const finish = finishOf(await tickUntil(h, has("story.finish"), 40));
    expect(finish).toMatchObject({ ok: true, detail: { branches_removed: ["norn/lt-1-01", "norn/lt-1"], branches_kept: [] } });
  });
});

describe("dropUnitBranch", () => {
  test("a slice's branch goes once its story's branch holds it; a dry run deletes nothing; a branch already gone is nothing to do", async () => {
    const h = harness();
    h.heads["norn/lt-1-01"] = "s1";
    h.heads["norn/lt-1"] = "s1";
    h.heads.main = "m0";
    expect(await dropUnitBranch(h.env, "lt-1/01", { dryRun: true })).toEqual({ ok: true, value: { branch: "norn/lt-1-01", deleted: true, held_by: "norn/lt-1" } });
    expect(h.vcsCalls.some((c) => c.op === "deleteBranch")).toBe(false);
    expect((await dropUnitBranch(h.env, "lt-1/01")).ok).toBe(true);
    expect(h.vcsCalls.filter((c) => c.op === "deleteBranch").map((c) => c.args[0])).toEqual(["norn/lt-1-01"]);
    expect(await dropUnitBranch(h.env, "lt-2")).toEqual({ ok: true, value: null });
  });
});
