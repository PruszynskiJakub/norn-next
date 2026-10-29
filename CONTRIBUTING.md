# Contributing to norn

norn is built with norn. Code rules, layout and the agent side of the process are in [`AGENTS.md`](AGENTS.md); the spec is [`.agents/PRD.md`](.agents/PRD.md).

## The loop

1. **Everything is an issue.** Every change to a file in the repo starts as a GitHub issue labelled `norn` and assigned to whoever runs norn on it.
2. **norn picks it up.** `norn sync` turns the issue into story `gh-N` (a branch `gh-N-<slug>`, a worktree, a spec folder).
3. **Triage.** Unless the issue names a workflow, the `triage` workflow runs first: an agent checks the issue still occurs, adds a repro and the affected code, and recommends a workflow or `close`. You confirm at the gate and switch the story with `norn workflow gh-N <name> --to <start step>`; the gate prompt lists the exact command for each workflow. To close instead: `norn approve gh-N`, `gh issue close N --reason "not planned"`, `norn story close gh-N`, then delete the pushed story branch (`git push origin --delete gh-N-<slug>`).
4. **The workflow runs.** Agents do the unattended steps; you answer the inbox (`norn inbox`).
5. **A person merges.** Every workflow ends at a `ready` gate with a PR. You merge it (squash).

## Workflows

Picked by the issue label `norn:wf:<name>` (PRD W9); without one, `triage` runs. They live in `.agents/norn/workflows/`.

| Label | Workflow | For |
|---|---|---|
| `norn:wf:triage` | triage | Default. Check the issue, recommend the next workflow or `close`. |
| `norn:wf:story` | story | Features: refine → plan → slices → test → QA → PR. |
| `norn:wf:fix` | fix | Bugs: reproduce → fix test-first → test → review → PR. |
| `norn:wf:quick` | quick | Refactors, docs, chores, small changes: implement → test → review → PR. |
| `norn:wf:spec` | spec | Design: refine with you, amend `.agents/PRD.md`, review → PR. No code. |
| `norn:wf:release` | release | Changelog, version bump, build and smoke → PR. Started by `/release-start`. |

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
4. `norn watch`, and `norn inbox` in another terminal.

**No write access?** Open an issue with one of the templates. A PR from a fork is read as input to an issue, never merged as is.

## Person-only skills

Run these yourself in Claude Code; agents never invoke them.

- `/issue` turns what you noticed into a well-formed issue labelled `norn` (and `friction` when it is about norn itself). This is how an ad-hoc session hands work over.
- `/release-start` opens the release issue (labels `norn`, `norn:wf:release`).

## Releases

Run `/release-start`. The release workflow rebuilds `CHANGELOG.md` from the squash commits since the last tag, proposes a version at the `confirm-version` gate, bumps it, builds and smokes the binaries and opens the PR. When you merge it, CI tags `vX.Y.Z` and publishes in the same run. Do not edit `CHANGELOG.md` in a regular PR.

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
- Labels: `norn`, `norn:wf:{triage,story,fix,quick,spec,release}`, `friction`, `bypass`, `idea`, `bug`, `enhancement`.
