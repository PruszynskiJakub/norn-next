import { describe, expect, test } from "bun:test";
import type { HookFact } from "@norn/schema";
import { runHooks } from "../../src/local-facts.ts";

const RUN_ID = "01JRRRRRRRRRRRRRRRRRRRRRRR";
const WT = "/repo-worktrees/gh-9-x";
const fact = (agent_session_id: string | undefined, patch: Partial<HookFact> = {}): HookFact => ({
  event: "turn_end",
  at: "2026-01-01T00:01:00.000Z",
  agent: "claude",
  native: "Stop",
  cwd: WT,
  ...(agent_session_id ? { agent_session_id } : {}),
  ...patch,
});

describe("runHooks", () => {
  test("a fact of another agent session in the worktree is not the run's; its own, an unknown one and a stamped one are", () => {
    const hooks = [fact("sess-A"), fact("sess-B"), fact(undefined), fact("sess-C", { run_id: RUN_ID })];
    const run = { run_id: RUN_ID, started_at: "2026-01-01T00:00:00.000Z" };
    expect(runHooks(hooks, { ...run, agent_session_id: "sess-A" }, WT).map((h) => h.agent_session_id ?? null)).toEqual(["sess-A", null, "sess-C"]);
    // a run whose session is not known keeps every fact of its worktree
    expect(runHooks(hooks, run, WT)).toHaveLength(4);
  });
});
