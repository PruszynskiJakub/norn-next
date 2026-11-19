# Contributing to norn

norn is built with norn. This file is the person's side: how a change gets proposed, built and released. To run the tests and find your way in the code, read [Development](docs/development.md): the dev commands, the test tiers and CI, the layout and the plugin contract, where each contract lives, the release mechanics and the design decisions. [`AGENTS.md`](AGENTS.md) is the short map an agent reads first: the code rules and the agent's side of the process.

## The loop

1. **Everything is an issue.** Every change to a file in the repo starts as a GitHub issue labelled `norn`. It stays unassigned in the backlog; whoever runs norn on it assigns it to themselves when work should begin, because intake cuts the story branch from the base at that moment.
2. **norn takes it in.** The next tick turns the assigned issue into story `gh-N`: a branch `norn/gh-N`, a worktree, and the workflow its `norn:wf:<name>` label names.
3. **The workflow runs.** Agents do the unattended steps; `norn status` shows what needs you. You answer questions (`norn story answer`), decide gates (`norn story approve`, `norn story reject --reason`) and start the steps manual mode holds (`norn run start`).
4. **A person merges.** Every delivery workflow (`quick`, `story`, `release`) ends waiting for its PR to merge. You merge it (squash). The PR holds only the code; the spec, the handoffs and norn's run data stay out of the branch ([Concepts](docs/concepts.md#the-agents-worktree)). The merge ends the story: norn closes the issue and removes the worktrees.

To drop a story instead, `norn story close gh-N` closes the issue and stops its runs.

## Workflows

Picked by the issue label `norn:wf:<name>`. The shipped ones are in `packages/pack-sdlc/assets/workflows/`; this repo's own, with its check commands and its CI wait, are in `.agents/workflows/` and replace the pack's of the same name.

| Label | Workflow | For |
|---|---|---|
| `norn:wf:triage` | triage | Check the issue, recommend `refinement`, `quick`, `reproduce` or closing it, as an issue comment. |
| `norn:wf:reproduce` | reproduce | Bugs: reproduce read-only, confirm the cause and the seam for a regression test. |
| `norn:wf:refinement` | refinement | Spec and plan with you: sync → refine → clarify → plan. No code, no PR. |
| `norn:wf:story` | story | A planned feature: sync → slices → test → QA → PR → CI. Each slice: implement → test → review → integrate. |
| `norn:wf:quick` | quick | Refactors, docs, chores, small changes, a reproduced bug's fix: sync → implement → test → review → PR → CI. |
| `norn:wf:release` | release | Changelog, version bump → PR, wait for its CI. Started by `/release-start`. |

## Labels

| Label | Meaning |
|---|---|
| `norn` | norn takes the issue in once it is assigned. |
| `norn:wf:<name>` | Selects the workflow (above). |
| `norn:kind:*`, `norn:risk:*`, `norn:priority:*` | Set by triage, one of each: the issue's kind, risk and priority. For people to sort the backlog; norn never reads them. |
| `friction` | Friction with norn itself, found while using it here. |
| `bypass` | A change norn cannot deliver (see below). |
| `idea`, `bug`, `enhancement` | Hints for triage; they select nothing. |

## Set up a collaborator machine

You need write access to the repo.

1. Install the latest released binary as in the [README](README.md#install). The process always runs a released `norn`, never a build of this repo.
2. Clone the repo and run `norn doctor`; `norn init` if it asks for a config.
3. In `~/.norn/config.yaml` (never in the repo): your mode, such as `kernel: { mode: auto }`. Without a mode, agent steps wait for `norn run start <unit>`. The committed `.agents/norn.yaml` wins over your files for every key it sets (tracker, forge, store, the `claude` executor, base, the default workflow).
4. `norn watch`, and `norn status` in another terminal.

**No write access?** Open an issue with one of the templates. A PR from a fork is read as input to an issue, never merged as is.

## Person-only skills

Run these yourself in Claude Code; agents never invoke them.

- `/issue` turns what you noticed into a well-formed issue labelled `norn` (and `friction` when it is about norn itself). This is how an ad-hoc session hands work over.
- `/release-start` opens the release issue (labels `norn`, `norn:wf:release`).

## Releases

Run `/release-start`. The release workflow rebuilds `CHANGELOG.md` from the squash commits since the last tag, proposes and bumps a version, refreshes the skill copies in `.agents/skills/`, opens the PR and waits for its CI; you judge the version and the changelog at `ready`. When you merge it, CI tags `vX.Y.Z` and publishes in the same run. Do not edit `CHANGELOG.md` in a regular PR.

## The bypass

Only when norn cannot deliver the change (for example, a broken release blocks it):

1. Open a norn issue for the norn problem behind it (label `norn`, usually `friction`).
2. Open an issue labelled `bypass` for the change, linking the issue from step 1.
3. Branch `bypass/<bypass issue>-<slug>` from `main`, make the change.
4. Open a PR labelled `bypass` whose body says `Closes #<bypass issue>`.

The CI process check passes a PR only if it comes from a story branch `norn/gh-N` (or `gh-N-<slug>`, the one older releases open) and closes #N, or meets the bypass rules above, or is from Dependabot. It also refuses a PR that edits the skill copies `.agents/skills/norn*` unless it is a release PR (titled `Release X.Y.Z`): edit the bundled source in `packages/pack-sdlc/assets/skills/` instead.

## GitHub settings the repo relies on

- `main` protected: no direct or force push, required checks `process` and CI's `unit`, `integration (shard 1/4)` to `(shard 4/4)` and `package`, branches required to be up to date before merging (so a release's tag never holds a commit its changelog misses), no admin bypass.
- Squash merges only, with the PR title and description as the commit message; branches deleted on merge.
- "Allow auto-merge" on: Dependabot patch and minor PRs merge automatically; majors wait for a person.
- Labels: `norn`, `norn:wf:{triage,reproduce,refinement,story,quick,release}`, `friction`, `bypass`, `idea`, `bug`, `enhancement`.
