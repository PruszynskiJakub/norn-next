/** H12 (bypass #265): which performed actions leave the next tick something to do at once. */
import { describe, expect, test } from "bun:test";
import { type Action, leavesFollowUp } from "../../src/index.ts";

const action = (kind: string, extra: Record<string, unknown> = {}) => ({ kind, unit: null, rule: "r", ...extra }) as unknown as Action;

describe("leavesFollowUp", () => {
  test("a receipt applied, a git step's classify receipt, a unit started or a claim taken leave a follow-up", () => {
    for (const kind of ["apply_receipts", "run_git", "classify", "import_mailbox", "start_unit", "start_slices", "mark_done", "intake_story", "round_start"])
      expect([kind, leavesFollowUp(action(kind))]).toEqual([kind, true]);
    expect(leavesFollowUp(action("claim", { op: "acquire" }))).toBe(true);
  });

  test("an agent launched, a check started, a park, a renewal or housekeeping leave none", () => {
    for (const kind of ["start_run", "nudge", "retry_fresh", "run_check", "park", "notify", "noop", "push_record", "update_story_mirror", "cleanup_merged_story"])
      expect([kind, leavesFollowUp(action(kind))]).toEqual([kind, false]);
    expect(leavesFollowUp(action("claim", { op: "renew" }))).toBe(false);
    expect(leavesFollowUp(action("claim", { op: "release" }))).toBe(false);
  });
});
