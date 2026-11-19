import { describe, expect, test } from "bun:test";
import { tidy } from "../../src/index.ts";
import { has, harness, record, tickUntil, trackerItem } from "./support.ts";

/** Three stories that each end stuck at their first step, their claims given up, each with a worktree on disk. */
async function stuckStories() {
  const h = harness({ workflow: "stepped" });
  for (const n of [1, 2, 3]) h.items.push(trackerItem(n));
  h.stepAnswers.probe = ["conflict", "conflict", "conflict"];
  await tickUntil(h, async () => {
    for (const n of [1, 2, 3]) if ((await record(h, `lt-${n}`)).state?.ended !== "stuck") return false;
    return true;
  });
  await tickUntil(h, has("claim.release"));
  for (const n of [1, 2, 3]) await h.files.write(`/machine/repo/worktrees/lt-${n}/file.txt`, "work\n");
  h.heads.main = "m1";
  return h;
}

describe("tidy", () => {
  test("removes the worktree and branch of a stuck story whose commits the base holds; skips a live-claimed one and one with commits nowhere else", async () => {
    const h = await stuckStories();
    h.heads["norn/lt-1"] = "m1";
    h.heads["norn/lt-2"] = "m1";
    h.heads["norn/lt-3"] = "local-only";
    const held = await h.env.slots.store.claims.acquire("lt-2", "machine-b", 600_000);
    expect(held.ok).toBe(true);
    const got = await tidy(h.env);
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.value.removed).toEqual([{ story: "lt-1", unit: "lt-1", worktree: true, branch: "norn/lt-1" }]);
    expect(got.value.kept).toEqual([
      { story: "lt-2", reason: expect.stringContaining("claim held by machine-b until") },
      { story: "lt-3", unit: "lt-3", reason: "its head local-only is on neither the base (main) nor a remote copy" },
    ]);
    const ops = h.vcsCalls.map((c) => `${c.op} ${c.args[0]}`);
    expect(ops.filter((o) => o.startsWith("remove ") || o.startsWith("deleteBranch "))).toEqual(["remove lt-1", "deleteBranch norn/lt-1"]);
  });

  test("a dry run lists what it would remove and changes nothing", async () => {
    const h = await stuckStories();
    for (const n of [1, 2, 3]) h.heads[`norn/lt-${n}`] = "m1";
    const before = h.vcsCalls.length;
    const got = await tidy(h.env, { dryRun: true });
    expect(got.ok && got.value.removed.map((r) => r.unit)).toEqual(["lt-1", "lt-2", "lt-3"]);
    expect(h.vcsCalls.slice(before).filter((c) => c.op === "remove" || c.op === "deleteBranch")).toEqual([]);
  });

  test("a worktree holding uncommitted changes is kept, and so is its branch; a story still in progress is skipped", async () => {
    const h = await stuckStories();
    for (const n of [1, 2, 3]) h.heads[`norn/lt-${n}`] = "m1";
    h.dirty["/machine/repo/worktrees/lt-1"] = ["notes.md"];
    h.items.push(trackerItem(4));
    h.stepAnswers.probe = ["waiting"];
    await tickUntil(h, has("round.start"));
    // its claim given up, as one left to expire would be: the round under way still holds it back
    expect((await h.env.slots.store.claims.release("lt-4", "machine-a")).ok).toBe(true);
    const got = await tidy(h.env);
    expect(got.ok && got.value.kept).toEqual([
      { story: "lt-1", unit: "lt-1", reason: "its worktree holds uncommitted changes: notes.md" },
      { story: "lt-4", reason: "in progress: lt-4 at poke" },
    ]);
    expect(got.ok && got.value.removed.map((r) => r.unit)).toEqual(["lt-2", "lt-3"]);
  });
});
