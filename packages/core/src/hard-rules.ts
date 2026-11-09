/**
 * The hard rules of a norn step, each with what breaks when it is not followed. How to work renders
 * them and the hooks reuse them, so a rule is never worded two ways. A reason stands alone as a
 * clause after its rule, with no closing period.
 */
export interface HardRule {
  id: HardRuleId;
  rule: string;
  reason: string;
}

export type HardRuleId = "no-survey" | "this-step" | "four-commands" | "no-push" | "no-switch" | "no-remote-write" | "no-run-state";

export const HARD_RULES: readonly HardRule[] = [
  {
    id: "no-survey",
    rule: "This brief is complete: do not read again what it gives you (`.norn-unit`, `.env.norn`; open the handoff only to rewrite it), and do not survey the repository, `.agents/`, `.claude/` or the machine to find your bearings",
    reason:
      "the brief already holds what this step needs, a survey spends context on what it doesn't, and other units' run state and handoffs are not this unit's to act on",
  },
  {
    id: "this-step",
    rule: "Work only in this worktree and only on this step: nothing that belongs to later work, no drive-by changes",
    reason: "another worktree is another unit's live work, and what this step leaves out has its own step, checks and receipts",
  },
  {
    id: "four-commands",
    rule: "Of the norn commands, run only `brief`, `done`, `ask` and `stuck`",
    reason:
      "the brief carries this unit's state rendered fresh each time, and every other norn command drives units and gates that are the person's or shows other units' state, so a read-only `norn status --json` or `norn story view` is forbidden too",
  },
  {
    id: "no-push",
    rule: "Never `git push` (only norn pushes)",
    reason: "a push outside norn is an effect with no receipt, and receipts come before effects",
  },
  {
    id: "no-switch",
    rule: "Never switch branches or worktrees",
    reason: "a switch leaves the unit's branch, where norn commits what is left at the report",
  },
  {
    id: "no-remote-write",
    rule: "Never run a `gh` or `glab` command that changes the remote (creating, editing, commenting, labelling, closing, merging); reading is fine",
    reason: "people read the remote at once and a change there cannot be taken back quietly, so only norn makes the changes its receipts record",
  },
  {
    id: "no-run-state",
    rule: "Never edit anything under `runs/` (norn's run state, kept outside the worktree)",
    reason: "a hand-edited file fails validation and makes the unit `corrupt`",
  },
];

/** A hard rule rendered with its reason, as one sentence. */
export function ruleWithReason(id: HardRuleId): string {
  const r = HARD_RULES.find((h) => h.id === id);
  if (!r) throw new Error(`no hard rule ${id}`);
  return `${r.rule} — ${r.reason}.`;
}
