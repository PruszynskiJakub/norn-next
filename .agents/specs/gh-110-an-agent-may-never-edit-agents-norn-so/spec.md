---
id: gh-110
slug: an-agent-may-never-edit-agents-norn-so
provider: gh
number: 110
url: https://github.com/PruszynskiJakub/norn-next/issues/110
title: Move workflows and config out of .agents/norn/ and the trace into .git/norn/, so agents can change workflows and config
assignee: PruszynskiJakub
labels:
  - friction
  - norn
  - norn:wf:story
workflow: story
status: active
intake_at: 2026-10-30T11:26:29.364Z
body_hash: bfcbad50e64591e29e5e35aae634c9390637f6426c19a953f8d7498f5aa27d53
---

# Move workflows and config out of .agents/norn/ and the trace into .git/norn/, so agents can change workflows and config

## Problem

The norn skill tells an agent never to edit anything in `.agents/norn/`. That folder mixes two kinds of file: the repo's committed workflows and config, which a story may need to change, and the checkout's machine-local trace (locks, heartbeat, caches), which nobody may touch. The rule protects the trace, but it also locks the workflows and config away from every step.

So a story whose change touches a workflow or the config has no route through norn. In this repo, the CLI regroup had to rename commands used in workflow steps; the agent committed to the story branch from outside a step, against the process, because the person asked. Upcoming stories need the same route: the triage follow-up of #71 (the `triage` workflow), #96 (drop `describe` from `quick`, `story` and `release`) and #64 (config). Today each one either breaks the process or parks on a question.

Nothing checks a changed workflow or config before it merges either. A tick validates the repo workflows (W5) only when it loads them on the main checkout, so a broken workflow is found after the merge, when every new unit that would use it is refused.

## Solution

Committed and machine-local files no longer share a folder:

- The repo config is `.agents/norn.config.yaml` and the repo workflows are in `.agents/workflows/`. Both are ordinary repo files an agent may change in a step. A running unit keeps its pinned workflow (S7), so the change applies to later units.
- The checkout's machine-local files (trace, locks, heartbeat, caches) live in `.git/norn/` under the repository's common git dir. There is one set per checkout (ID2), shared by every unit worktree, and nothing of it sits in the working tree. `~/.norn/` (user config, machine leases, shims) does not change.
- The agent's hard rule narrows to `runs/` and the generated top of handoff.md.
- `norn doctor` validates the repo workflows and the repo config and fails on an invalid one. It stays read-only, so CI and a workflow's `test` check can run it and stop a broken workflow before it merges.
- A new command, `norn migrate`, moves a repository from the old layout to the new one and stages the moves for the person to commit. The code knows one layout: on the old one every other command refuses and names `norn migrate`.

This story ships the feature; it does not migrate this repository. That happens in a follow-up story once a release with `norn migrate` is installed, because the process always runs the released norn, which reads the old layout.

## Behaviour

- B1 As a person setting up norn, I want the repo config at `.agents/norn.config.yaml`, so that it sits beside the other agent files and not inside a folder that also holds machine state.
  Example: `norn init` in a fresh repo → `.agents/norn.config.yaml` exists, and there is no `.agents/norn/` folder. `norn config` shows repo settings as coming from `.agents/norn.config.yaml`.

- B2 As a person, I want the repo workflows in `.agents/workflows/`, so that they are ordinary repo files next to the config.
  Example: `norn init` → `.agents/workflows/story.yaml`, `slice.yaml` and `bug.yaml` exist. A story labelled `norn:wf:quick` runs the workflow in `.agents/workflows/quick.yaml`.

- B3 As an agent in a step, I want to edit the repo workflows and the repo config like any other file, so that a story whose change touches them can be done inside norn.
  Example: the shipped norn skill's hard rules say never to edit `runs/` or the generated top of handoff.md, and nothing else of norn's. An agent in `implement` changes `.agents/workflows/quick.yaml` and reports `norn done done`; the change lands in the story's PR like any other file.

- B4 As a person, I want an edited workflow to leave running units alone, so that a story cannot change the rules of a unit in flight (S7).
  Example: a story's PR changes `.agents/workflows/story.yaml` and merges while gh-7 is at `review` on `story`. gh-7 keeps its pinned copy. A story started after the merge pins the new one.

- B5 As a person, I want the checkout's machine-local files in `.git/norn/` of the repository's common git dir, so that they are never in the working tree and every unit worktree shares the same ones.
  Example: after a tick, the trace, the tick lock, the heartbeat and the caches are in `<repo>/.git/norn/`. A unit worktree has no machine-local norn files of its own. `git status` in any checkout shows nothing of them, without any `.gitignore` line for them.

- B6 As a person, I want `~/.norn/` to stay as it is, so that my user config, machine leases and shims are not affected.
  Example: after the change (and after `norn migrate`), `~/.norn/config.yaml` and the machine's slot leases are where they were and are read as before.

- B7 As a person or CI, I want `norn doctor` to validate every repo workflow as a tick would (W5), so that a broken workflow fails before it merges.
  Example: `.agents/workflows/quick.yaml` has a cycle without a counter → `norn doctor` names `quick.yaml` and the uncounted cycle with its path, and exits non-zero. A workflow naming a skill that is not installed for its agent → doctor names the workflow, the step and the missing skill.

- B8 As a person or CI, I want `norn doctor` to validate the repo config against its schema, so that a broken config fails before it merges.
  Example: `.agents/norn.config.yaml` has `max_agents: "two"` → `norn doctor` names the file, the key and why it is invalid, and exits non-zero.

- B9 As CI, I want `norn doctor` to change nothing, so that it is safe to run in any check.
  Example: `norn doctor` in a clean checkout with valid workflows and config → reports them valid, exits 0, and `git status` is still clean.

- B10 As the maintainer of this repo, I want CI and the repo workflows' `test` check to run `norn doctor`, so that a story here cannot merge a workflow or config that W5 or the schema would refuse.
  Example: a story's branch breaks `.agents/workflows/quick.yaml` → the `test` check fails and names the workflow, and so does the PR's CI.

- B11 As a person with a repository on the old layout, I want `norn migrate` to move the committed config and workflows to the new layout as git moves, staged and not committed, so that I review and commit the move myself.
  Example: in a repo with `.agents/norn/config.yaml` and `.agents/norn/workflows/{story,quick}.yaml`, `norn migrate` → `git status` shows them renamed to `.agents/norn.config.yaml` and `.agents/workflows/{story,quick}.yaml`, staged. No commit is made. The output lists each move and ends with the commit to make.

- B12 As a person, I want `norn migrate` to move the machine-local files to `.git/norn/`, so that the checkout's trace, heartbeat and claims carry over.
  Example: before, `.agents/norn/trace/heartbeat.json` holds heartbeat id H. After `norn migrate`, `.git/norn/heartbeat.json` holds H, and the next tick recognises its own claims as before (ID2). `.agents/norn/` no longer exists.

- B13 As a person, I want `norn migrate` to drop the `.gitignore` line norn wrote for the old trace folder, so that no stale entry is left.
  Example: `.gitignore` held `.agents/norn/trace/` under norn's lines → after `norn migrate` that line is gone, it is staged, and the person's own lines are untouched.

- B14 As a person, I want `norn migrate` on a migrated repository to do nothing and say so, so that running it twice is safe.
  Example: a second `norn migrate` → "nothing to move", exit 0, `git status` unchanged.

- B15 As a person whose `watch` is running, I want `norn migrate` to refuse while the tick lock is held, so that the trace, heartbeat and claims move as a whole and never under a running tick.
  Example: `norn watch` is running → `norn migrate` refuses (exit 3) with `do_instead` telling the person to stop `watch` and run it again. Nothing is moved.

- B16 As a person, I want `norn migrate` run in a unit worktree to refuse and point at the main checkout, so that the move never lands in a story's PR.
  Example: in `norn-worktrees/gh-12-…`, `norn migrate` → refused (exit 3), `do_instead`: run `norn migrate` in the main checkout, with its path. Nothing is moved.

- B17 As a person, I want any command to refuse when both layouts are present, so that norn never guesses which one is meant.
  Example: both `.agents/norn/config.yaml` and `.agents/norn.config.yaml` exist (a partial move, or a merge) → `norn migrate`, `norn status`, `norn tick` and the rest refuse (exit 3), naming both paths. Nothing is read from either, and nothing is moved.

- B18 As a person who updated norn but has not migrated, I want every other command to refuse on the old layout and name `norn migrate`, so that I know the one step to take and norn never half-reads an old layout.
  Example: the main checkout still has `.agents/norn/config.yaml` → `norn status`, `norn tick` and `norn watch` refuse (exit 3) with `do_instead: norn migrate`. With `--json` the refusal is a `CliError`.

- B19 As a person, I want `norn init` on the old layout to refuse the same way, so that there is one migration path.
  Example: `norn init` in a repo with `.agents/norn/` → refused (exit 3), `do_instead: norn migrate`. `init` writes nothing.

- B20 As a person, I want `norn doctor` on the old layout to report it and name `norn migrate`, so that the check that diagnoses a checkout also says how to fix this.
  Example: `norn doctor` in a repo with `.agents/norn/` → reports "old layout", names `norn migrate`, exits non-zero, and moves nothing.

- B21 As an agent in a story that started before the migration, I want my unit worktree's old-layout files to be ignored, so that my step can go on while the main checkout is migrated.
  Example: the main checkout is migrated, and the worktree of gh-12 (branched earlier) still holds `.agents/norn/config.yaml` → `norn brief`, `norn done`, `norn ask` and the agent hooks in that worktree work as usual, and config and workflows are read from the main checkout. The old files leave the story branch when it next takes the base (base sync) or when it merges.

- B22 As a person, I want README, the PRD, AGENTS.md, CONTRIBUTING.md and `norn help` to describe the new layout and `norn migrate`, so that no doc sends anyone to `.agents/norn/`.
  Example: README's "Workflows are data" and "Config" paragraphs name `.agents/workflows/` and `.agents/norn.config.yaml`. `norn help` lists `migrate` with one line on what it does.

- B23 As a person upgrading, I want the release notes to say that a migrated repository needs this release or later on every machine, so that a teammate on an older norn is not surprised.
  Example: the release's changelog entry says that after `norn migrate`, an older norn cannot read the repository and must be upgraded. There is no compatibility path in the code.

## Out of scope

- Migrating this repository's own `.agents/norn/` — the released norn that runs the process reads the old layout; a follow-up story runs `norn migrate` here once a release with it is installed. Until then the narrowed rule applies to the old paths: `.agents/norn/workflows/` and `config.yaml` are editable, `.agents/norn/trace/` is not.
- Moving `runs/` off the story branch — a separate decision.
- #108's one-line JSON — its own story.
- `norn migrate` opening a PR or filing a story with the move — that would be a second route onto the base outside the story process; a possible follow-up.
- Where unit worktrees live (today a folder next to the repository; inside it gitignored, or under `~/.norn/`, were raised) — its own story, to be filed; it bears on #91.
- Reading the old layout as a fallback — one layout in the code; the old one only refuses and names `norn migrate`.

## Open questions

None.

## Plan
