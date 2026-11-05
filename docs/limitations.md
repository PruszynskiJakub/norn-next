# Limitations

What norn does not do yet, what has not been proven in real use, and the limits of its design. What was fixed is in the [changelog](../CHANGELOG.md). Read this before relying on norn beyond the envelope below.

## Proven envelope

Trustworthy today:
- One person, Claude agents, GitHub, and a good check configuration.
- Manual or auto mode.
- herdr or headless runners on **one machine**.
- Several stories in parallel on one base.

Two-machine operation was only simulated on one Mac (`NORN_MACHINE`). Everything else below is either a known gap or unproven.

## Not built yet

- **Secrets in pushed text.** Handoffs are committed, and check output, receipts, logs and evidence are pushed to the story's record ref (`refs/norn/runs/<story>`), unredacted. Keep secrets out of check output and evidence.
- **No write-back to GitHub or GitLab** beyond pushes and the draft PR: no status comment edited in place, no `norn:stuck` label.
- **No permission profiles per step.** Claude runs in its `auto` permission mode by default; a permission prompt the agent is blocked on shows up as an Answer item.
- **No hard-deny hook.** Pushing, writing to the remote with `gh`/`glab` and editing norn's run state are forbidden by the `norn` skill, not blocked by a hook.
- **No guards on transitions** (`when:`), no per-slice mode, no `fork`/`join` steps: conditions are outcomes, a person's QA is a gate, and `attended: true` on a step covers the precise cases.
- **One remote and project per repository.**
- **No web cockpit, and no command that mines the trace for workflow changes.**

## Gaps still open

1. **Cross-machine handoff edges.**
   - Under the `local` record policy, a holder that dies without releasing its claim loses everything in the run record since its last push (the last release, or the last time `open-pr` opened or updated the PR). A takeover then resumes from that older record on the ref; a story whose record was never pushed restarts the last boundary's step from the branch with fresh counters. `record.policy: remote` pushes the record whenever it changes instead.
   - After a `story checkout`, a foreign run parked on a prompt is never judged.
   - An approve followed by a merge within one tick leaves the archived record at the gate.
   - A merged story stays offered for `story checkout` on a checkout that once worked on it, and `norn tidy` does not remove leaked intake worktrees or slot leases.
2. **A machine-specific hook command is committed as is.** The default hook command, `"${NORN_BIN:-norn}" hook`, is portable. But `norn init --hook-command` or `NORN_HOOK_COMMAND` with an absolute path writes that path into the committed `.claude/settings.json`, as the dogfood sandbox did, and a second machine then gets no hook facts. Without hook facts, `silent`, stalled, adoption and implicit asks are all lost. Neither `init` nor `doctor` flags it: `doctor` tests the hook command this machine would install, not the one committed.
3. **Implicit asks flicker.** When an agent sends several tool calls at once, its Answer item can vanish for one tick and return with a new id. A notifier fires twice, and a `norn story answer` sent in the gap is refused.
   - After an accepted answer, `status` and `story view` show the old question until the next tick, which takes 20–40 s.
   - If a runner kept reporting `waiting_input` from before the last answer, a second prompt would not be raised.
4. **Agents' housekeeping.**
   - QA agents commit evidence files at the repo root.
5. **Marker check covers the pushed head only.** A marker commit that a later commit fixed is still published, because norn never rewrites history.
6. **Commits made outside norn are blurred in two cases.**
   - A person's commit made while an agent run is active is not flagged as made outside norn.
   - A person's commit merged in by `update` no longer shows up as made outside norn; only the head-changed item reports it.
7. **Nothing stops a person or tool typing into an agent's pane.** Answers typed there bypass norn's record, and on one checkout 7 of 30 prompts were answered in the pane.
8. **Attended steps and per-worktree setup.**
   - Attended steps with nobody in the pane. The inbox says when the agent waits (HC1–HC3), but "report once the person agrees" still cannot be met when no person comes, and nothing ends the wait.
   - No per-worktree setup step and no config key for checks: check commands must prepend their own setup, such as `bun install --frozen-lockfile`.
9. **No backfill of history** from before norn first observed a repo.
10. **Cost per story** is not tracked; it is postponed.

## Not yet proven in real use

- **Two real machines.** Claims and mailboxes are git refs with compare-and-swap, which is sound on paper. They were exercised only as simulated machines on one Mac.
- **These recovery paths:**
  - a resolve that ends `stuck`;
  - exhausting `base_conflict_loop`;
  - an agent that dies with no retries left;
  - killing a herdr pane mid-merge.
- **A browser criterion checked live.** Nobody has yet had an agent with a browser pass a criterion seen in a web page.
- **The herdr cockpit (HC1–HC15).** The attended wait, the cockpit (`norn status --watch`), the Herdr plugin (`plugins/herdr`), pane labels and the `herdr` notifier are tested against fixtures and a fake runner only. No dogfood run has used them yet.
- **The auto permission mode default** (`--permission-mode auto` for `agents.claude`). Every live run set `agents.claude.args`, which replaces the list and the permission mode with it.
- **codex, opencode, gemini and glab adapters.** They are tested only against recorded fixtures. Only claude, git, gh, herdr and headless ran live.

## Limits of the design

- **Agents report their own work.** A receipt records what the agent claimed. Gates and checks are only as strong as the commands you configure, and a weak check config lets anything through.
- **Decide never reads prose (P8).** Anything that lives only in a spec body, `handoff.md` or a review comment does not influence the next step unless an agent turns it into a typed outcome.
- **Corrupt means stopped (S2).** A state file that fails validation marks the unit `corrupt`, by design. Hand edits to `.agents/` files or merge conflicts in them block the unit until a person repairs it.
- **No host-less mode.** Story keys must be `gh-N`/`gl-N`, and intake reads issues from GitHub or GitLab (GR1, GR2). A repo with only local files and branches cannot run norn today. Business tracking in Jira stays outside norn by choice.
- **No fork contributions.** norn works only for collaborators with write access to the repo: it needs to push story branches and claim refs to the remote. A PR from a fork cannot run through a workflow; in norn's own repo it is read as input to an issue, never merged as is.
- **GitHub/GitLab-style flows only.** norn assumes PRs, branches and git refs. Trunk-based work without PRs, many teams sharing one `.agents/`, and non-git VCS are out of scope.
- **Merge, never rebase.** Story branches gain merge commits from the base. Teams that require linear history must squash on merge; the base then stays linear.
- **The cockpit takes keys, not the mouse.** `norn status --watch` is full screen with raw keys; there is no mouse support and no web panel yet (it would read `@norn/view` and act through the CLI verbs, X1).
- **Coarse grain.** norn works per story and slice on a heartbeat. It is the wrong tool for quick interactive edits, and the overhead is not worth it for tiny changes.
- **Local environment must stay healthy.**
  - It needs Bun, git ≥ 2.38 (for `merge-tree --write-tree`), git worktrees (disk plus per-worktree setup), an authenticated `gh`, and herdr for attended panes. The cockpit needs Herdr ≥ 0.9, and its plugin is installed by hand (`herdr plugin install PruszynskiJakub/norn-next/plugins/herdr`, HC11); `norn init` does not install it.
  - Rate limits or a GitHub outage stop observation. A remote call that hangs costs a tick up to 2 minutes before it fails (H11).
  - A sleeping laptop pauses every watch, and claims expire. They are reacquired cleanly after wake, but nothing moves in the meantime.
- **Workflows are pinned per unit.** Editing a workflow does not affect units already in flight. This is intended, but surprising.
- **`heartbeat_id` per checkout, not per process** (a deliberate divergence from ID2, see `AGENTS.md`). Two `watch` processes on one checkout share it and renew the same claim; the tick lock refuses a tick while another runs, so they take turns and a second one gains nothing.
- **Observability covers only what goes through norn.** `norn run view --why` and `norn run list` replay norn's own decisions exactly. Anything a person or agent does outside norn, such as pane keystrokes or hand merges, shows up only as later-observed facts, without the reason.
