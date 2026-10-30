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
- The checkout's machine-local files (trace, locks, heartbeat, caches) live in `~/.norn/repos/<id>/`, where `<id>` is derived from the checkout's path. There is one set per checkout (ID2), shared by every unit worktree, and nothing of it sits in the working tree or in `.git`. What `~/.norn/` already holds (user config, machine leases, shims) does not change.
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

- B5 As a person, I want the checkout's machine-local files in `~/.norn/repos/<id>/`, one folder per checkout, so that they are never in the working tree (nor wiped by `git clean -fdx`) and every unit worktree shares the same ones.
  Example: after a tick in `~/code/norn-next`, the trace, the tick lock, the heartbeat and the caches are in `~/.norn/repos/norn-next-<hash>/`, where `<hash>` comes from the real path of the repository's git common dir. A second clone on the same machine gets its own folder. A unit worktree has no machine-local norn files of its own. `git status` in any checkout shows nothing of them, without any `.gitignore` line for them.

- B6 As a person, I want what `~/.norn/` already holds to stay as it is, so that my user config, machine leases and shims are not affected; only `repos/` is added.
  Example: after the change (and after `norn migrate`), `~/.norn/config.yaml` and the machine's slot leases are where they were and are read as before.

- B7 As a person or CI, I want `norn doctor` to validate every repo workflow as a tick would (W5), so that a broken workflow fails before it merges.
  Example: `.agents/workflows/quick.yaml` has a cycle without a counter → `norn doctor` names `quick.yaml` and the uncounted cycle with its path, and exits non-zero. A workflow naming a skill that is not installed for its agent → doctor names the workflow, the step and the missing skill.

- B8 As a person or CI, I want `norn doctor` to validate the repo config against its schema, so that a broken config fails before it merges.
  Example: `.agents/norn.config.yaml` has `max_agents: "two"` → `norn doctor` names the file, the key and why it is invalid, and exits non-zero.

- B9 As CI, I want `norn doctor` to change nothing, so that it is safe to run in any check.
  Example: `norn doctor` in a clean checkout with valid workflows and config → reports them valid, exits 0, and `git status` is still clean.

- B10 As the maintainer of a repo, I want `norn doctor --repo` to check only the layout, the repo workflows and the repo config, with no agent, runner or remote, so that CI and a workflow's `test` check can run it on a machine without agents.
  Example: on a CI runner with no agent installed and no gh auth, `norn doctor --repo` in a checkout with valid workflows and config exits 0; with `.agents/workflows/quick.yaml` broken it names the workflow and exits non-zero. Wiring it into this repo's CI and `test` checks belongs to the follow-up story that migrates this repo (amended in plan: this repo stays on the old layout until then).

- B11 As a person with a repository on the old layout, I want `norn migrate` to move the committed config and workflows to the new layout as git moves, staged and not committed, so that I review and commit the move myself.
  Example: in a repo with `.agents/norn/config.yaml` and `.agents/norn/workflows/{story,quick}.yaml`, `norn migrate` → `git status` shows them renamed to `.agents/norn.config.yaml` and `.agents/workflows/{story,quick}.yaml`, staged. No commit is made. The output lists each move and ends with the commit to make.

- B12 As a person, I want `norn migrate` to move the machine-local files to `~/.norn/repos/<id>/`, so that the checkout's trace, heartbeat and claims carry over.
  Example: before, `.agents/norn/trace/heartbeat.json` holds heartbeat id H. After `norn migrate`, `~/.norn/repos/<id>/heartbeat.json` holds H, and the next tick recognises its own claims as before (ID2). `.agents/norn/` no longer exists.

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

### Seams

- **S1 The CLI, through `runCli` in the integration harness** (temp repo cloned from a bare remote, an isolated norn home via `NORN_HOME_DIR`, fake clock, fake remote and runner). Observes B1, B2, B4–B9, B10 (`doctor --repo` itself), B11–B21. An old-layout repo is built by running `init` and moving its files back to the old places; a held tick lock by taking it the way `watch` does.
  Prior art: the `norn doctor (A7)` tests in the cli housekeeping tests, the cli config tests, `init` in the e2e test, the story-create tests (`unknown_workflow`), the workflow pinning tests (S7), and the help tree test.
- **S2 The repo lint and help tree tests** (the repo test's doc and banned-word scans, the help tree test). Observes B3 (the shipped norn skill's hard rule names only `runs/` and the generated top of handoff.md) and B22 (no product doc, shipped asset or `norn help` text names `.agents/norn/`; `help` lists `migrate`).
  Prior art: the glossary lint in the repo test; the help tree test.

B23 has no seam: the changelog is written at release from the squash commits, so the note travels in this story's PR description (D13) and the person checks it at the release `ready` gate.

### Coverage

| Behaviour | Seam | Test kind | Notes |
|---|---|---|---|
| B1 | S1 | integration | `init` writes `.agents/norn.config.yaml`, no `.agents/norn/`; `config` names the new file |
| B2 | S1 | integration | `init` writes `.agents/workflows/`; a `norn:wf:quick` story runs it |
| B3 | S2 | unit (lint) | shipped skill text |
| B4 | S1 | integration | existing pinning behaviour, now at the new path |
| B5 | S1 | integration | after a tick, machine files under the home's `repos/<id>/`; nothing in the working tree or `.git`; `git status` clean with no ignore line |
| B6 | S1 | integration | user config and leases read as before |
| B7 | S1 | integration | uncounted cycle; missing skill — named, non-zero |
| B8 | S1 | integration | bad key — file, key, reason, non-zero |
| B9 | S1 | integration | valid repo — exit 0, `git status` clean |
| B10 | S1 | integration | `doctor --repo` with no agent binaries on PATH and no remote auth |
| B11 | S1 | integration | staged renames, no commit, listed moves and the commit to make |
| B12 | S1 | integration | heartbeat id carried over; next tick keeps its claims |
| B13 | S1 | integration | norn's ignore line gone and staged; the person's lines kept |
| B14 | S1 | integration | second run: nothing to move, exit 0 |
| B15 | S1 | integration | tick lock held → refused, nothing moved |
| B16 | S1 | integration | in a unit worktree → refused, names the main checkout |
| B17 | S1 | integration | one part in both places → every command refuses, names both paths |
| B18 | S1 | integration | `status`, `tick`, `watch` refuse with `do_instead: norn migrate`; `--json` gives a `CliError` |
| B19 | S1 | integration | `init` refuses and writes nothing |
| B20 | S1 | integration | `doctor` reports old layout, names `migrate`, non-zero, moves nothing |
| B21 | S1 | integration | migrated main, old files in a unit worktree → `brief`, `done`, `ask`, `hook` work |
| B22 | S2 | unit (lint) | product docs and `help` only (D12) |
| B23 | none | manual | PR description, checked at release (D13) |

### Prefactoring

1. Route every norn path through store's path functions — the headless runner's default log dir, doctor's scratch repo, and the literal `.agents/norn/…` paths in the tests (about 40 files) go through store's path functions or one harness helper. Makes B1, B2 and B5 a change in one module plus `migrate`, and leaves the test diff to tests of the layout itself.
2. Extract one function that loads and validates the repo workflows (W5, with each agent's visible skills) and the repo config, used by observe today and by doctor in this story. B7 and B8 then give exactly the verdict a tick gives; the rules are never copied.

### Implementation decisions

- D1 **Layout.** Repo config at `.agents/norn.config.yaml`; repo workflows in `.agents/workflows/`; the checkout's machine-local files in the machine dir `<norn home>/repos/<id>/`, a flat copy of the old trace dir (heartbeat, tick and integrate locks, day files, caches, `base/`, `runs/` logs keep their names). What the norn home already holds does not change. Chosen over the common git dir (`.git/norn/`): agent sandboxes may keep `.git` read-only, and norn writes the trace from processes an agent starts; the home is outside both the working tree and `.git`, and survives `git clean -fdx`.
- D2 **The id.** `<id>` is the main checkout's folder name, a dash, and the first 8 hex characters of the sha256 of the real path of the repository's git common dir (e.g. `norn-next-3f9a2c1b`). Derived, never stored, so it needs no write into the repo or `.git`; two clones on one machine never share it. A generated id kept in git config was rejected: a copied repo would carry it, and two checkouts would share one heartbeat. Store resolves it; the machine-dir path function keeps taking the root, and `NORN_HOME_DIR` keeps isolating tests. Team effect: none beyond the checkout — the id never appears in a ref, receipt or trace a teammate reads; the `heartbeat_id` inside it is unchanged (ID2).
- D3 **Orphaned machine dirs.** Each machine dir holds a small `checkout.json` (the checkout's path), a new schema in `@norn/schema`, validated on read. After a repo folder is moved, `norn doctor` warns about a machine dir whose recorded path has the same folder name but no longer exists, and prints the `mv` that adopts it (keeping the heartbeat). No adopt command.
- D4 **Layout classification, per part, on the main checkout only.** Three parts, each with an old and a new place: config, workflows (a folder with at least one workflow file), machine files (a non-empty dir). *Both*: any one part present in both places. *Old*: not both, and at least one part at its old place. *New*: otherwise. Covers a teammate who pulled the migration commit but still has an untracked old trace (old → `migrate` moves only the trace), an interrupted migration (a rerun finishes it), and a merge that brings an old file back beside the new one (both → refused).
- D5 **One layout guard at command dispatch,** for every command that locates a repo, after `locate()` and before config loads. It classifies the main checkout (also when run from a unit worktree) and never looks at a worktree's own files (B21). Old → refused, exit 3, code `old_layout`, `do_instead: norn migrate`, naming the main checkout. Both → refused, code `both_layouts`, naming each pair of paths. Exempt: `migrate` (handles both itself), `doctor` (reports the layout as a failed check, B20), `help`. `init` is refused like the rest (B19). `norn hook` on old or both exits 0, records nothing and blocks nothing, so a hook never breaks an agent's tool calls; `brief`, `done`, `ask`, `stuck` refuse.
- D6 **`norn migrate`.** A new command for a person (listed in `norn help`), markdown by default and one JSON value with `--json` (`{moves, staged, commit}`).
  Checks first, nothing moved on a refusal (exit 3): not the main checkout (a unit worktree, or any linked worktree whose top level is not the root) → names the main checkout's path; any part in both places; the tick lock not available (B15).
  Then, holding the tick lock (taken at its old place): config and workflows by `git mv` so the renames are staged (an untracked workflow file is moved plainly and listed as untracked); the old trace dir's contents into the machine dir (rename, or copy then delete across filesystems) and `checkout.json` written; norn's own old-trace line removed from `.gitignore` and `.gitignore` staged (the person's lines untouched); `.agents/norn/` removed when empty; the old lock file dropped last.
  Every step can run again, so an interrupted run is finished by a rerun; no rollback. On a new layout: "nothing to move", exit 0 (B14). Never commits, pushes, or touches a unit worktree.
- D7 **`norn doctor` gains a repo group:** layout (D4; old or both is a failure naming `migrate`), each repo workflow through the prefactored validator (file, step, path of each issue — uncounted cycle, missing skill for its agent), and the repo config against its schema (file, key, reason). Plain `doctor` runs the machine and repo groups and fails on either; `doctor --repo` runs only the repo group and needs no agent, runner or remote (B10). Both read-only (B9).
- D8 **`init`** writes the new layout; its `.gitignore` lines drop the old trace line and keep `.env.norn` and `.norn-unit`. Its next steps name `.agents/workflows/`.
- D9 **Headless runner** default log dir: the machine dir's `runs/`.
- D10 **Trace event for an unreadable machine-local file:** its `file` becomes an absolute path (the file is no longer under the repo). A comment and schema emit only; the type does not change.
- D11 **Every message and hint** (refusals, `do_instead`, `config`, `config edit`, `story create`/`edit` `unknown_workflow`, adapter errors) names the new paths.
- D12 **Docs (B22).** Product docs move to the new layout now: README, `.agents/PRD.md` (§7 layout, ID2 and every id that names a path), `norn help`, `init` output, the shipped skills and shipped config, code comments, and AGENTS.md's Layout and "Where the contracts live". This repo's own process text keeps the old paths until the follow-up migrates it: AGENTS.md's Process and repo-local workflows lines, CONTRIBUTING.md's lines on this repo's files, and the `.agents/skills/norn*` copies (written by the released `init`; the narrowed rule already on this branch stays). S2's lint covers the product docs only.
- D13 **Release note (B23).** This story's PR description carries a "Release note" paragraph — after `norn migrate` an older norn cannot read the repository and must be upgraded — which the `release` step takes into the changelog. `CHANGELOG.md` is not edited in the PR.
- D14 **B10's wiring is deferred.** This repo stays on the old layout, so neither the released `doctor` (no workflow validation) nor a dev-build `doctor` (refuses the old layout) can guard it now; the follow-up story that migrates this repo adds `norn doctor --repo` to CI and the `test` checks.

### Testing decisions

- Tests drive `runCli` through the harness and observe what a person or agent sees: exit code, `--json` value or `CliError`, files on disk, `git status` and the staged index. Never the guard's or `migrate`'s internals.
- Faked: only system boundaries — the remote and runner (harness fakes), the clock, the norn home (`NORN_HOME_DIR` on a temp dir), and agent binaries on PATH for `doctor --repo` (absent). Git is real.
- The existing transcripts and observe snapshots are expected not to change (they record `runs/` and Facts, not machine-dir paths); a change there is reviewed as a layout change, not rewritten blindly.
- The golden corpus does not change: decide's inputs and decisions are untouched.
- Existing tests that wrote or read the old paths move to the new ones through the prefactor's helpers; they are not new behaviour.

### Risks

- **Test churn** (about 40 test files) hiding a real behaviour change — met by prefactor 1 landing green first, so the layout slice's diff is small.
- **`migrate` moving live state** (heartbeat, locks) under a running tick — met by taking the tick lock at its old place before any move (B15) and the rerunnable steps; the first slice that ships `migrate` covers B12 and B15.
- **Moving the repo folder** gives it a new id and a fresh heartbeat; its claims expire and may be recovered by a teammate. Met by D3's orphan warning with the `mv` that adopts the old dir.
- **Cross-filesystem home** (repo and home on different volumes): the move is copy then delete; covered by the same rerunnable step, not by a test of its own.
- **A teammate on an older norn** after the migration commit merges cannot read the repo — by design (B23), stated in the release note.
