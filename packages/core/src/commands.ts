/** Exact commands shown to people (O1, S9) and naming conventions shared by decide, inbox and handoff. */
import { sliceDirName, storyDirName, type UnitState } from "@norn/schema";

/** B5: the whole first prompt of an auto-mode agent session. */
export const AUTO_PROMPT = "Use the norn skill, then run `norn brief`.";

/** Text typed into a silent/timed-out/stalled session (C1). */
export const NUDGE_TEXT =
  "You ended your turn without reporting. Finish the step and report exactly once: `norn done <outcome> --handoff \"…\"`, `norn ask \"…\"` or `norn stuck \"…\"`. Run `norn brief` to see the outcomes.";

const q = (s: string) => (/^[\w./@:-]+$/.test(s) ? s : `'${s.replaceAll("'", "'\\''")}'`);

/** Worktree path conventions (GR3, K5): story worktrees sit beside the repo; slice worktrees beside their story's. */
export const storyWorktreePath = (repoRoot: string, story: string, slug: string) =>
  `${repoRoot.replace(/\/+$/, "")}-worktrees/${storyDirName(story, slug)}`;
export const sliceWorktreePath = (storyWorktree: string, nn: string, slug: string) =>
  `${storyWorktree.replace(/\/+$/, "")}--${sliceDirName(nn, slug)}`;

/** Command that starts an agent in a worktree for a person (manual mode, attended steps). */
export function startAgentCommand(worktree: string | null, agentCommand: string): string {
  const run = `${agentCommand} ${q("Use the norn skill, then run `norn brief`.")}`;
  return worktree ? `cd ${q(worktree)} && ${run}` : run;
}

/**
 * The next command for a unit, by its state (S9 header, O1 inbox). `start` is the
 * command that starts an agent in the worktree, used for ready/attended agent steps.
 */
export function nextCommand(unitKey: string, state: UnitState | null, start?: string): string | null {
  if (!state) return null;
  switch (state.status) {
    case "done":
      return null;
    case "corrupt":
      return `norn why ${unitKey}`;
    case "stuck":
      return `norn unstick ${unitKey}`;
    case "parked":
      if (state.park?.kind === "ask") return `norn answer ${unitKey} "…"`;
      if (state.park?.kind === "gate") return `norn approve ${unitKey}`;
      if (state.park?.kind === "attended") return start ?? "norn brief";
      return `norn unstick ${unitKey}`;
    case "ready":
      return start ?? "norn brief";
    case "running":
      return `norn trace ${unitKey}`;
  }
}
