import { describe, expect, test } from "bun:test";
import { dropUnitBranch } from "../../src/index.ts";
import { has, harness, tickUntil, trackerItem } from "./support.ts";

const finishOf = (reports: Awaited<ReturnType<typeof tickUntil>>) => reports.at(-1)?.outcomes.find((o) => o.decision.rule === "story.finish");

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
