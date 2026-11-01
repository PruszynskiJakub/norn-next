# Contributing to norn

norn is built with norn. Code rules, layout and the agent side of the process are in [`AGENTS.md`](AGENTS.md); the spec is [`.agents/PRD.md`](.agents/PRD.md).

## The loop

1. **Everything is an issue.** Every change to a file in the repo starts as a GitHub issue labelled `norn`. It stays unassigned in the backlog; whoever runs norn on it assigns it to themselves when work should begin, because intake cuts the story branch from the base at that moment (GR1, GR2).
2. **norn picks it up.** `norn sync` turns the issue into story `gh-N` (a branch `gh-N-<slug>`, a worktree, a spec folder).
3. **Triage or reproduce.** Unless the issue names a workflow, the `triage` workflow runs first: an agent checks the issue still applies, adds the affected code and context as an issue comment, and recommends `refinement`, `quick`, `reproduce` or closing it. A bug (the bug report template sets `norn:wf:reproduce`) runs `reproduce` instead: an agent reproduces it through the real interface, builds a loop that goes red, confirms the cause and posts it on the issue. Both end their round on their own; the inbox shows the story as done with no PR.
4. **You start the next round.** Each workflow does one thing, and a story goes through them one after another on the same branch: `norn story edit gh-N --workflow <name>`. A feature: `triage → refinement → story`. A small change: `triage → quick`. A bug: `reproduce → quick`. To close instead, close the issue: a story with no PR and no unfinished round then ends by itself.
5. **The workflow runs.** Agents do the unattended steps; you answer the inbox (`norn status`).
6. **A person merges.** Every delivery workflow (`quick`, `story`, `release`) ends at a `ready` gate with a PR. You merge it (squash).

## Workflows

Picked by the issue label `norn:wf:<name>` (PRD W9); without one, `triage` runs. They live in `.agents/workflows/`.

| Label | Workflow | For |
|---|---|---|
| `norn:wf:triage` | triage | Default, for stories and features. Check the issue, recommend `refinement`, `quick`, `reproduce` or close. |
| `norn:wf:reproduce` | reproduce | Bugs: reproduce read-only, confirm the cause and the seam for a regression test, then `quick` fixes it. |
| `norn:wf:refinement` | refinement | Spec and plan with you, and PRD changes (refine amends `.agents/PRD.md`): sync → refine → clarify → plan. No code, no PR. |
| `norn:wf:story` | story | A planned feature: sync → slices → test → QA → PR → CI. Each slice: implement → test → review → integrate. |
| `norn:wf:quick` | quick | Refactors, docs, chores, small changes, a reproduced bug's fix: sync → implement → test → review → PR → CI. |
| `norn:wf:release` | release | Changelog, version bump → PR, wait for its CI. Started by `/release-start`. |

## Labels

| Label | Meaning |
|---|---|
| `norn` | norn picks the issue up. |
| `norn:wf:<name>` | Selects the workflow (above). |
| `friction` | Friction with norn itself, found while using it here. |
| `bypass` | A change norn cannot deliver (see below). |
| `idea`, `bug`, `enhancement` | Hints for triage; they select nothing. |

## Set up a collaborator machine

You need write access to the repo.

1. Install the latest released binary as in the [README](README.md#1-install). The process always runs a released `norn`, never a build of this repo.
2. Clone the repo and run `norn doctor`.
3. Optional, in `~/.norn/config.yaml` (never in the repo):
   ```yaml
   default_mode: auto
   runner: { adapter: herdr }
   max_agents: 2
   ```
4. `norn watch`, and `norn status` in another terminal.

**No write access?** Open an issue with one of the templates (the bug report one routes the issue to `reproduce`). A PR from a fork is read as input to an issue, never merged as is.

## Person-only skills

Run these yourself in Claude Code; agents never invoke them.

- `/issue` turns what you noticed into a well-formed issue labelled `norn` (and `friction` when it is about norn itself). This is how an ad-hoc session hands work over.
- `/release-start` opens the release issue (labels `norn`, `norn:wf:release`).

## Releases

Run `/release-start`. The release workflow rebuilds `CHANGELOG.md` from the squash commits since the last tag, proposes and bumps a version, opens the PR and waits for its CI; you judge the version and the changelog at `ready`. When you merge it, CI tags `vX.Y.Z` and publishes in the same run. Do not edit `CHANGELOG.md` in a regular PR.

## The bypass

Only when norn cannot deliver the change (for example, a broken release blocks it):

1. Open a norn issue for the norn problem behind it (label `norn`, usually `friction`).
2. Open an issue labelled `bypass` for the change, linking the issue from step 1.
3. Branch `bypass/<bypass issue>-<slug>` from `main`, make the change.
4. Open a PR labelled `bypass` whose body says `Closes #<bypass issue>`.

The CI process check passes a PR only if it comes from a story branch `gh-N-<slug>` and closes #N, or meets the bypass rules above, or is from Dependabot.

## GitHub settings the repo relies on

- `main` protected: no direct or force push, required checks `process`, `check` and `package`, branches required to be up to date before merging (so a release's tag never holds a commit its changelog misses), no admin bypass.
- Squash merges only, with the PR title and description as the commit message; branches deleted on merge.
- "Allow auto-merge" on: Dependabot patch and minor PRs merge automatically; majors wait for a person.
- Labels: `norn`, `norn:wf:{triage,reproduce,refinement,story,quick,release}`, `friction`, `bypass`, `idea`, `bug`, `enhancement`.
