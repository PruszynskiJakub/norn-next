# norn — known limitations

Where norn breaks or is not proven yet, as of v1.2: v1, plus auto-mode recovery (`SPEC-auto-mode-recovery.md`, PR #6), base sync with honest QA (`SPEC-base-sync-and-qa.md`, PR #7) and the herdr cockpit (`SPEC-herdr-cockpit.md`, PR #23). Release 0.2.1 has everything but the cockpit, which is under `[Unreleased]` in `CHANGELOG.md`. The evidence comes from the dogfood runs on the Todoist sandbox:

- `docs/audit-todoist-dogfood/` — v1, finding ids F*.
- `docs/audit-auto-mode/` — auto mode, ids H*/M*, with a rerun using ids B*.
- `docs/audit-base-sync-qa/` — base sync and QA, ids C*, D* and the run-3 F1–F3.

Read this next to [`PRD.md`](PRD.md) before relying on norn for anything beyond the proven envelope below.

## Proven envelope

Trustworthy today:
- One person, Claude agents, GitHub, and a good check configuration.
- Manual or auto mode.
- herdr or headless runners on **one machine**.
- Several stories in parallel on one base.

Two-machine operation was only simulated on one Mac (`NORN_MACHINE`). Everything else below is either a known gap or unproven.

## Fixed since v1

The rules each fix maps to are in its spec.

- **Stale story branches (F8).** The `update` step merges the base into the story branch, never by rebasing.
  - Conflicts are predicted and routed to a `resolve` agent step.
  - Gates send a story back with `stale`, and `norn update <story>` re-enters the update step.
  - `status` and `inbox` show how far behind each story is and which files conflict.
  - In the dogfood, every story reached `ready` up to date with no manual merge.
- **Conflict markers.** norn does not commit while a merge is open, and refuses a push whose head has markers in the outgoing files (BS5.2). A resolve agent's `norn done` is refused until its merge is concluded.
- **A person's push to a story branch** is merged in by `update` or by a rejected push, and is never lost (BS3.3a).
- **Honest QA (F30, F37).** QA reports a verdict per criterion: pass, fail, person or unverified.
  - `unverified` goes to `human-qa` with how to check it.
  - `--note` leaves a Check item for a person.
  - `pass` is refused for a criterion that needs a capability the agent lacks, such as `browser`, and a person's earlier ruling never counts as verification.
- **One action per unit per tick (F13).** Claim renewal is a side action and no longer delays a receipt or a cleanup (R1).
- **Crash and hang recovery.** This is now proven live on herdr and headless:
  - An agent killed mid-step or mid-merge is classified `died` and retried within seconds.
  - A hung headless agent is nudged through `--resume`.
  - A launch crash is adopted or classified (R4, R5).
- **Prompts the agent is blocked on.** Permission prompts show up as implicit asks, including mid-merge. `norn answer` types the right keystroke, and the agent's own report is accepted afterwards (R6).
- **Agents run the right norn.** A PATH shim and a launcher script do this (R8). Failed actions are reported `ok:false` and never as success (R4.3).
- **`watch` survives a sleeping laptop (H11).** Every call that reaches a remote (`git fetch`/`push`/…, `gh`, `glab`) times out after 2 minutes and fails as a retryable network error, so a dead SSH connection no longer holds the tick lock for good.
- **An attended agent waiting for its person is visible (HC1–HC3).** After `limits.attended_wait` (default `2m`) the inbox moves it from Running to Your turn, and notifiers fire once per wait. Its command reaches the waiting session and never starts a second agent, which was the dogfood mistake.
- **Brief inputs (F16).** On a first attempt, Last failing check and Last findings say `none` instead of pointing at a Rework section that does not exist. A Resume written by another step or attempt is dropped from Context, and a fresh session after `died` keeps its Rework (B2, C2).

## Gaps still open

1. **Cross-machine handoff edges.**
   - After a `take`, a foreign run parked on a prompt is never judged (B8).
   - An approve followed by a merge within one tick leaves main's record at the gate (B7).
   - A merged story stays offered for `take` on a checkout that once worked on it, and `norn tidy` does not remove leaked intake worktrees or slot leases (B10).
2. **A machine-specific hook command is committed as is** (rerun D2). The default hook command, `"${NORN_BIN:-norn}" hook`, is portable. But `norn init --hook-command` or `NORN_HOOK_COMMAND` with an absolute path writes that path into the committed `.claude/settings.json`, as the dogfood sandbox did, and a second machine then gets no hook facts. Without hook facts, `silent`, stalled, adoption and implicit asks are all lost. Neither `init` nor `doctor` flags it: `doctor` tests the hook command this machine would install, not the one committed.
3. **Implicit asks flicker** (B9, F1). When an agent sends several tool calls at once, its Answer item can vanish for one tick and return with a new id. A notifier fires twice, and a `norn answer` sent in the gap is refused.
   - After an accepted answer, `status` and `inbox` show the old question until the next tick, which takes 20–40 s (F2).
   - If a runner kept reporting `waiting_input` from before the last answer, a second prompt would not be raised.
4. **Agents' housekeeping.**
   - An agent's `git add -A` can sweep norn's pending `runs/` files into its own merge commit (D2).
   - QA agents commit evidence files at the repo root (F3).
5. **Marker check covers the pushed head only.** A marker commit that a later commit fixed is still published, because norn never rewrites history.
6. **Commits made outside norn are blurred in two cases.**
   - A person's commit made while an agent run is active is not flagged as made outside norn (C4).
   - A person's commit merged in by `update` no longer shows up as made outside norn; only the head-changed item reports it.
7. **Nothing stops a person or tool typing into an agent's pane.** Answers typed there bypass norn's record, and in run-3 7 of 30 prompts on one checkout were answered in the pane.
8. **Unchanged from v1:**
   - `handoff.md` guidance (F10). The `norn` skill says to keep handoff.md current, but its hard rules also say never to edit anything under `runs/`, where handoff.md lives (`runs/<unit>/handoff.md`).
   - Attended steps with nobody in the pane (F14). The inbox now says when the agent waits (HC1–HC3), but "report once the person agrees" still cannot be met when no person comes, and nothing ends the wait.
   - No backfill of history from before norn first observed a repo.
   - No per-worktree setup step and no config key for checks (F3): check commands must prepend their own setup, such as `bun install --frozen-lockfile`.
9. **Cost per story** is not tracked; it is postponed.

## Built but never run for real

- **Two real machines.** Claims and mailboxes are git refs with compare-and-swap, which is sound on paper. They were exercised only as simulated machines on one Mac.
- **These recovery paths:**
  - a resolve that ends `stuck`;
  - exhausting `base_conflict_loop`;
  - an agent that dies with no retries left;
  - killing a herdr pane mid-merge.
- **An agent with the `browser` capability.** Nobody ever checked a browser criterion live; every such approval says so.
- **The herdr cockpit (HC1–HC14).** The attended wait, `norn pane --interactive`, the Herdr plugin (`plugins/herdr`), pane labels and the `herdr` notifier are tested against fixtures and a fake runner only. No dogfood run has used them yet.
- **The auto permission mode default** (`--permission-mode auto` for `agents.claude`). Every live run used configs that replace it.
- **codex, opencode, gemini and glab adapters.** They are tested only against recorded fixtures. Only claude, git, gh, herdr and headless ran live.

## Limits of the design

- **Agents report their own work.** A receipt records what the agent claimed. Gates and checks are only as strong as the commands you configure, and a weak check config lets anything through. Capability gating stops a QA agent from claiming what it cannot check, not from lying.
- **Decide never reads prose (P8).** Anything that lives only in a spec body, `handoff.md` or a review comment does not influence the next step unless an agent turns it into a typed outcome.
- **Corrupt means stopped (S2).** A state file that fails validation marks the unit `corrupt`, by design. Hand edits to `.agents/` files or merge conflicts in them block the unit until a person repairs it.
- **No host-less mode.** Story keys must be `gh-N`/`gl-N`, and intake reads issues from GitHub or GitLab (GR1, GR2). A repo with only local files and branches cannot run norn today. Business tracking in Jira stays outside norn by choice.
- **GitHub/GitLab-style flows only.** norn assumes PRs, branches and git refs. Trunk-based work without PRs, many teams sharing one `.agents/`, and non-git VCS are out of scope.
- **Merge, never rebase.** Story branches gain merge commits from the base. Teams that require linear history must squash on merge.
- **The cockpit is line-based.** `norn pane --interactive` reads one command per line between redraws; it is not a full-screen TUI (no raw keys or mouse).
- **Coarse grain.** norn works per story and slice on a heartbeat. It is the wrong tool for quick interactive edits, and the overhead is not worth it for tiny changes.
- **Local environment must stay healthy.**
  - It needs Bun, git ≥ 2.38 (for `merge-tree --write-tree`), git worktrees (disk plus per-worktree setup), an authenticated `gh`, and herdr for attended panes. The cockpit needs Herdr ≥ 0.9, and its plugin is installed by hand (`herdr plugin install`, HC11); `norn init` does not link it.
  - Rate limits or a GitHub outage stop observation. A remote call that hangs costs a tick up to 2 minutes before it fails (H11).
  - A sleeping laptop pauses every watch, and claims expire. They are reacquired cleanly after wake, but nothing moves in the meantime.
- **Workflows are pinned per unit.** Editing a workflow does not affect units already in flight. This is intended, but surprising.
- **`heartbeat_id` per checkout, not per process** (a deliberate divergence from ID2, see `AGENTS.md`). Two `watch` processes on one checkout would each think they own the same claim.
- **Observability covers only what goes through norn.** `norn why` and `norn trace` replay norn's own decisions exactly. Anything a person or agent does outside norn, such as pane keystrokes or hand merges, shows up only as later-observed facts, without the reason.
