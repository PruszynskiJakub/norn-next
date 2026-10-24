# norn — known limitations

Where norn breaks or is not proven yet, as of v1 and the Todoist dogfood run (audit on branch `audit/todoist-dogfood`, `docs/audit-todoist-dogfood/`). Finding ids (F8, F10, …) refer to that audit. Read this next to [`PRD.md`](PRD.md) before relying on norn for anything beyond the proven envelope below.

## Proven envelope

Trustworthy today: **one person, Claude agents, manual mode, GitHub, good checks configured.** Everything else below is either a known gap or unproven.

## Gaps hit in real use

1. **Stale story branches (F8).** No step or verb brings a story branch up to date with its base after sibling stories merge. In the dogfood run a person merged `main` by hand four times, and conflict resolution after `done` happened outside norn — invisible to the trace and receipts. Several parallel stories on one base means manual work.
2. **`handoff.md` contradiction (F10).** The skill says keep it current; the rules forbid editing `runs/`. Every agent hit it. Fix: move handoff out of `runs/` or exempt its body.
3. **Attended steps without a person (F14, F29).** "Report once the person agrees" cannot be expressed when nobody is in the pane, and the brief's "Mode: manual" is confused with attended. Unattended, such a step stalls or the agent guesses.
4. **One action per unit per tick (F13).** Claim renewal consumes the unit's single action for that tick — 14 receipt applications were delayed by a tick. Long work moves slower than the tick interval suggests.
5. **No honest "can't verify" outcome (F30, F37).** QA cannot say "I couldn't check this here" (e.g. a browser check without a browser) or "pass, with a note for a person". It is forced into pass or fail, so it may pass what nobody verified.
6. **No backfill.** Foreign commits and inbox history exist only from the first tick that observes them. Adopting norn mid-project, or a heartbeat that was down, leaves gaps in the record.
7. **Brief gaps (F3, F16).** Attempt 1 inputs say "see Rework"; per-worktree setup (`bun install`) and check config keys are missing from the brief.

## Built but never run for real

Tested only against recorded fixtures or not at all:

- **Auto mode** — every dogfood story ran in manual mode.
- **Herdr and headless runners, hook facts** — agents ran as subagents, so zero hook events fired, and all runs shared one pid, so `died` detection was never tested. **Treat crash and hang recovery as unproven.**
- **Team handoff across machines** — claims and mailboxes are git refs with CAS, sound on paper, but no two people ever raced on them.
- **codex, opencode, gemini, glab adapters** — fixture-tested only. Only claude, git and gh ran live.

## Limits of the design

- **Agents report their own work.** A receipt records what the agent claimed. Gates and checks are only as strong as the commands you configure; a weak check config lets anything through.
- **Decide never reads prose (P8).** Anything that lives only in a spec body, `handoff.md` or a review comment does not influence the next step unless an agent turns it into a typed outcome.
- **Corrupt means stopped (S2).** A state file that fails validation marks the unit `corrupt`, by design. Hand edits to `.agents/` files or merge conflicts in them block the unit until a person repairs it.
- **GitHub/GitLab-style flows only.** norn assumes PRs, branches and git refs. Trunk-based work without PRs, many teams sharing one `.agents/`, and non-git VCS are out of scope.
- **Coarse grain.** norn works per story and slice on a heartbeat. Wrong tool for quick interactive edits; the overhead is not worth it for tiny changes.
- **Local environment must stay healthy.** Needs Bun, git worktrees (disk plus per-worktree setup) and an authenticated `gh`. Rate limits or a GitHub outage stop observation — a 502 once left a merged PR showing OPEN.
- **Workflows are pinned per unit.** Editing a workflow does not affect units already in flight. Intended, but surprising.
- **`heartbeat_id` per checkout, not per process** (deliberate divergence from ID2, see `AGENTS.md`). Two `watch` processes on one checkout would each think they own the same claim.
- **Observability covers only what goes through norn.** `norn why` and `norn trace` replay norn's own decisions exactly; anything a person or agent does outside norn shows up only as later-observed facts (e.g. `foreign_commits`), without the reason.
