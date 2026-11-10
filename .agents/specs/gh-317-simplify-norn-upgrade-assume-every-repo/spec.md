---
id: gh-317
slug: simplify-norn-upgrade-assume-every-repo
provider: gh
number: 317
url: https://github.com/PruszynskiJakub/norn-next/issues/317
title: "Simplify norn upgrade: assume every repo starts at 0.30, drop the old migrations"
assignee: PruszynskiJakub
labels:
  - norn
  - norn:wf:story
workflow: story
status: active
intake_at: 2026-11-10T08:21:19.336Z
body_hash: 5bf58336d1c9038bb879d6431fa0d4f75f80ac49128eb44e1683f8c653a648df
refined_body_hash: 5bf58336d1c9038bb879d6431fa0d4f75f80ac49128eb44e1683f8c653a648df
---

# Simplify norn upgrade: assume every repo starts at 0.30, drop the old migrations

## Problem Statement

`norn upgrade` and the commands around it still carry every migration since the layout before 0.13: moving the old config, workflows and trace, renaming old config keys, stripping criteria `needs` from slices and specs, moving finished stories' run state out of the base branch into archive refs, dropping the `runs/**` line from `.gitattributes`, and moving an open story's run state off its branch on the first tick. Every command also checks for the old layout and refuses on it, and `norn migrate` still exists as a deprecated alias.

A repo already on 0.30 never runs any of this again, yet maintainers keep paying for it in code, tests, guards and docs, and that is where bugs hide: upgrading 0.30.0 crashed on a file in `.agents/specs/` inside the `needs` strip. Meanwhile a repo that records no `norn_version` passes the version guard silently, so once the old-layout guard is gone, a repo from an old norn would run on default config as if it were empty.

## Solution

Every repo is assumed to start at norn 0.30.x. `norn upgrade` only moves a repo between versions from 0.30 on: it refuses a binary older than the repo, rewrites the bundled skills and relinks them into each agent's skill folder, writes `norn_version` last, stages everything without committing, and creates missing labels.

A repo whose `norn_version` is below 0.30, or missing, is refused with one clear instruction: install norn 0.30.x, run `norn upgrade`, commit, then upgrade again (and, for a missing version, `norn init` if the repo was never set up). The same refusal comes from `norn upgrade`, from every command that acts, from `norn doctor`'s version check, and from `norn init` on a team file that records no version or one below 0.30. norn no longer guesses at an old repo's shape: it does not look for the old layout anywhere.

The old migrations, their guards, `norn migrate`, and the tests and docs that exist only for them go. `norn upgrade --json` reports only what it can still do.

## User Stories

1. As a person on a repo at 0.30.x, I want `norn upgrade` run by a newer norn to rewrite the bundled skills from its own copies and relink them into each configured agent's skill folder, so that the repo's skills match the norn I run.
2. As a person on a repo at 0.30.x, I want `norn upgrade` to write the new `norn_version` last, after the skills, so that an interrupted upgrade leaves the repo still recording the old version and a rerun finishes it.
3. As a person running `norn upgrade`, I want every change staged and nothing committed, with the commit to make printed at the end, so that I review the diff with `git diff --staged` and commit it myself.
4. As a person running `norn upgrade`, I want the labels norn uses created on the remote where missing (never edited or deleted), and a remote it cannot reach or write reported without failing the upgrade, so that labels follow the repo without blocking it.
5. As a person running `norn upgrade` on a repo already current (version, skills and links match), I want it to say "already on norn X: nothing to upgrade" and stage nothing, so that a rerun is harmless.
6. As a person running `norn upgrade` with a binary older than the repo's `norn_version`, I want it refused (exit 3, `version_backward`) with the norn to install, as today, so that upgrade never moves a repo backward.
7. As a person running `norn upgrade` outside the main checkout, or while a tick holds the lock, I want it refused as today (`not_main_checkout`, `tick_locked`) with nothing changed, so that the upgrade never lands in a story's branch or under a running tick.
8. As a person running `norn upgrade` on a repo whose `norn_version` is below 0.30, I want it refused (exit 3) with nothing changed and a `do_instead` that says: install norn 0.30.x, run `norn upgrade`, commit, then run `norn upgrade` again with this norn, so that I know the exact path forward.
9. As a person running `norn upgrade` on a repo that records no `norn_version`, I want the same refusal with nothing changed, its `do_instead` also naming `norn init` for a repo that was never set up, so that an old repo is never upgraded by guessing at its shape.
10. As a person running any command that acts on a repo whose `norn_version` is below 0.30, I want it refused (exit 3) with the 0.30 path directly (install norn 0.30.x, run `norn upgrade`, commit, upgrade again), not a pointer to `norn upgrade` that would only refuse again, so that one message gets me moving.
11. As a person running any command that acts on a repo that records no `norn_version`, I want it refused (exit 3) with nothing written, launched or pushed, and a `do_instead` naming `norn init` for a repo never set up and the 0.30 path for a repo from an older norn, so that an old-layout repo is never run on default config.
12. As a person on a repo that records no `norn_version` or one below 0.30, I want `norn init`, `norn help`, `norn doctor` and `norn upgrade` to still run (each doing its own check), so that I can set up, diagnose and get the instructions.
13. As a person running `norn doctor` on a repo whose `norn_version` is below 0.30 or missing, I want its version check to fail with the same message and `do_instead` as the version guard, so that doctor and the commands agree.
14. As a person running `norn doctor`, I want no layout section in its output and no mention of an old layout or `norn migrate`, so that doctor reports only what norn 0.30 on still knows.
15. As a person running `norn init` in a repo with no team file, I want it to create the team file and record the running norn as `norn_version`, as today, so that a new repo starts current.
16. As a person running `norn init` in a repo whose team file exists but records no `norn_version`, or one below 0.30, I want it refused (exit 3) with nothing changed and the 0.30 path as `do_instead`, so that a repo set up by an older norn is not stamped current while its config stays half-moved.
17. As a person running `norn init` in a repo whose team file records a `norn_version` from 0.30 on, I want it to behave as today (never moving the version, leaving a differing bundled skill and naming `norn upgrade`), so that re-running init stays idempotent.
18. As a person on a repo from before 0.13 (only `.agents/norn/config.yaml`), I want norn to treat it as a repo with no team file, never looking for or moving the old files, so that no command carries old-layout code; the missing `norn_version` refusal is what stops me.
19. As a person typing `norn migrate`, I want it to be an unknown command like any other, and gone from `norn help` and the reference docs, so that `norn upgrade` is the one name.
20. As a person running `norn upgrade --json`, I want the report to hold only `norn_version {from, to, changed}`, `skills {updated, linked}`, `staged`, `commit` and `labels`, with `moves`, `config`, `run_state` and `gitattributes` gone, so that the contract shows only what upgrade can still do.
21. As a person on a repo at 0.30 whose base branch or story branches still hold `runs/` in their tree, I want norn to no longer read, move or warn about that run state (no archive-ref move, no first-tick move off a branch, no doctor note), so that norn reads run state only from the machine dir and the archive refs.
22. As a person upgrading, I want `norn upgrade` to no longer rename config keys, strip criteria `needs` from slices or specs, or edit `.gitattributes`, so that it never rewrites files under `.agents/specs/` or my config beyond `norn_version`.
23. As a person reading norn's docs (README, `docs/`, `norn help`, the upgrade command's summary), I want them to describe upgrade as moving a repo from 0.30 on and to state the 0.30 starting point, with nothing about the old layout, old config keys, base-tree run state or `norn migrate`, so that the docs match the binary.
24. As a person reading the release notes, I want the removed `norn migrate`, the dropped `upgrade --json` fields and the new refusal of a repo with no or a pre-0.30 `norn_version` called out, so that I know what to fix in scripts and old repos.

## Out of Scope

- Other compatibility readers for what an older norn left (a flat record read as round 1, older `state.json` shapes, the one-time hook-file backfill, older shapes in local and config files, old handoff handling) — some must stay because archive refs keep records as written; a follow-up issue audits them one by one against the 0.30 baseline.
- Moving a repo from before 0.30 forward in one step — the 0.30.x binary does that; this norn only names the path.
- Detecting the pre-0.13 layout to give it a friendlier message — keeps old-layout code alive; the missing-version refusal covers it.
- Moving the workflows or hooks during upgrade — not part of upgrade today; `norn init` updates the hooks.

## Further Notes

- The fix for `norn upgrade` crashing on a file in `.agents/specs/` (#316) ships in the same release as this change, so this story has no separate release to wait for.
- Exit codes and the `CliError` shape follow the machine contract: refusals are `refused` (3) with a `code`, hints in `do_instead`.

## Plan

### Seams
- **S1 the CLI, through the test harness (`createHarness`, `h.norn(...)` → `runCli`).** Observes upgrade's skills, version, staging, labels, no-op, backward, main-checkout, tick-lock and baseline refusals, and its `--json` shape; the version guard on acting commands and the commands it exempts; doctor's version check and its missing layout and run-state sections; init on no team file, a team file with no or a pre-0.30 version, and one from 0.30 on; a pre-0.13 repo read as having no team file; `norn migrate` as an unknown command and gone from `norn help`; a tick leaving `runs/` on a base or story branch alone; upgrade leaving config keys, `.agents/specs/` and `.gitattributes` alone.
  Prior art: `upgrade.test.ts`, `upgrade-version.test.ts`, `version-guard.test.ts`, `init-version.test.ts`, `version-status.test.ts`, `watch-version.test.ts`, `help-tree.test.ts`, `skills-drift-hold.test.ts`. The tests that exist only for the removed migrations go: `layout-guard.test.ts`, `run-state-move.test.ts`, `upgrade-records.test.ts`, and the old-layout, config-rename, `needs`-strip, `.gitattributes` and base-run-state cases inside the others (`toOldLayout`, `toBranchRunState`, `toBaseRunState` and their kin in the harness go with their last user).
- **S2 core's version rule, through the pure function beside `versionMismatch` (`@norn/core` commands) and the inbox's version item.** Observes the baseline refusal's code, error and `do_instead` for a missing and a pre-0.30 `norn_version`, the order against a mismatch, and the inbox item `norn status` shows for each.
  Prior art: the core unit tests of `versionMismatch` and the inbox items; `version-class.test.ts` in the cli unit tier.

### Coverage
| User story | Seam | Test kind | Notes |
|---|---|---|---|
| 1. upgrade rewrites and relinks the bundled skills | S1 | integration | existing cases kept |
| 2. `norn_version` written last; a rerun finishes | S1 | integration | existing case kept |
| 3. everything staged, nothing committed, commit printed | S1 | integration | one commit message now (D8) |
| 4. labels created where missing; unreachable remote reported | S1 | integration | existing cases kept |
| 5. already current: "nothing to upgrade", nothing staged | S1 | integration | new message text (D8) |
| 6. older binary refused `version_backward` | S1 | integration | existing case kept |
| 7. `not_main_checkout`, `tick_locked` | S1 | integration | only the new-layout tick lock remains |
| 8. upgrade on a pre-0.30 repo refused with the 0.30 path | S1 | integration | text from S2 |
| 9. upgrade on a repo with no version refused, names `norn init` | S1 | integration | text from S2 |
| 10. acting command on a pre-0.30 repo refused with the 0.30 path | S1 | integration | and S2 for the text |
| 11. acting command on a repo with no version refused, nothing written | S1 | integration | asserts no write, launch or push |
| 12. init, help, doctor, upgrade still run on such a repo | S1 | integration | |
| 13. doctor's version check fails with the guard's message | S1 | integration | |
| 14. doctor: no layout section, no old layout or `norn migrate` | S1 | integration | markdown and `--json` |
| 15. init on no team file records the version | S1 | integration | existing case kept |
| 16. init on a team file with no or a pre-0.30 version refused | S1 | integration | amended with the person: pre-0.30 too |
| 17. init on a team file from 0.30 on behaves as today | S1 | integration | existing cases kept |
| 18. pre-0.13 repo read as no team file, nothing moved | S1 | integration | old files untouched after the refusal |
| 19. `norn migrate` unknown, gone from help and reference | S1 | integration | plus `docs:emit` reference check |
| 20. `upgrade --json` holds only the five fields | S1 | integration | exact key set |
| 21. `runs/` in a base or branch tree never read, moved or warned about | S1 | integration | a tick and `norn status` over such a branch |
| 22. upgrade renames no keys, strips no `needs`, edits no `.gitattributes` | S1 | integration | a repo holding all three, unchanged after upgrade |
| 23. docs describe upgrade from 0.30 on, nothing old | — | lint + review | the docs lints, `bun run docs:emit` with no diff, the reviewer reads README, `docs/`, help |
| 24. release notes call out the removals and the new refusal | — | review | the commit messages carry it for the release step (CHANGELOG is the release step's); the PR body names it |

### Prefactoring
1. The harness's `h.config(...)` keeps the team file's recorded `norn_version` instead of dropping it (and removing the team file when no team key is left) — every S1 test that writes config after `norn init` would otherwise be refused by the new guard (stories 10, 11); changes nothing today, since a missing version passes.

### Implementation decisions
- D1 One pure rule in `@norn/core`, beside `versionMismatch`, owns the 0.30 baseline: given the repo's recorded version (or none) and the running norn, it returns the refusal (`code`, `error`, `do_instead`, `needs`) or null. It runs before the mismatch check. The version guard (`versionRefusal`, so `watch` pauses ticks on it too), upgrade, doctor's version check, init and the inbox's version item all take its text from there; nothing else words it.
- D2 The baseline is `0.30.0`: a recorded version below it is refused; `0.30.x` and later go on to the usual mismatch rule.
- D3 Two refusal codes, agreed: `version_missing` (no `norn_version`) and `version_too_old` (below 0.30), both exit 3 (`refused`), so a script can tell "run init" from "install 0.30.x". `needs` is `0.30.x` for both.
- D4 The texts. Too old: error `this repo records norn_version <v>; this norn moves a repo from norn 0.30 on`, do_instead `install norn 0.30.x, run \`norn upgrade\`, commit, then run \`norn upgrade\` again with norn <running>`. Missing: error `this repo records no norn_version`, do_instead `run \`norn init\` if norn was never set up here; for a repo from an older norn, install norn 0.30.x, run \`norn upgrade\`, commit, then run \`norn upgrade\` again with norn <running>`. A config that fails to load stays the command's own config error (exit 6), never this refusal, as today.
- D5 Order in upgrade, every check before any write: main checkout only, baseline, `version_backward`, the tick lock; then skills and relinks, `norn_version` last, staging, labels.
- D6 init refuses a team file that exists with no `norn_version` or one below 0.30 (agreed: pre-0.30 too), before any write; no team file still creates it and records the running norn.
- D7 The inbox's version item for a missing or pre-0.30 version becomes an Unblock item with D4's text and the command `norn doctor` (agreed), replacing the quiet Check item that pointed to `norn upgrade`. `norn status` and the other `reads` commands still run.
- D8 `UpgradeReport` is `{ norn_version: {from, to, changed}, skills: {updated, linked}, staged, commit, labels? }`. The commit is `Upgrade norn to <v> (norn upgrade)` when the version moved, else `Refresh norn's skills (norn upgrade)`, else null. The current case prints `already on norn <v>: nothing to upgrade` plus the labels lines. The summary reads as moving the repo's `norn_version` and bundled skills to this norn, from 0.30 on.
- D9 doctor's repo group loses `layout` and `run_state` in `--json` and their lines in markdown, and the early return that reported only the layout; its version check with no or a pre-0.30 version is `ok: false` with D1's code, error and `do_instead` (a missing version is no longer a warning).
- D10 What goes, with every test, fixture and doc only it needs: the old-layout module, `repoLayout`/`layoutProblems`, the `OLD_*` paths and the old tick lock path in store; `migrateConfig` (config renames and the `needs` strip); `archiveBaseRunState` and its outcome type; `baseRunStateStories`, the snapshot's reading of run state from a branch's tree and `branch_record`, `base_run_state` in the snapshot, Facts and view; the `move_record` action, its decide rule and its act, the `onBranch` exemption in marking a unit corrupt, the base-run-state inbox item and hint, and the four `run-state-move` golden cases with their rule cases; the cli layout guard, `Command.layout` and `ctx.checksLayout`, `migrateCommand`, the hook's layout check, `NO_VERSION_HINT`. Flat records and older `state.json` readers stay (out of scope).
- D11 Config validation keeps flagging old keys (a legacy reader for the follow-up audit) but its messages drop the `; run \`norn upgrade\`` suffix (agreed): upgrade no longer renames keys, and each message already names what replaced the key.
- D12 Old traces holding a `move_record` decision stay readable: trace actions are free-form payloads, and `run view --why` already labels a replay recorded by another norn version.

### Testing decisions
A good test drives the `norn` command through the harness and asserts what a person or script sees: exit code, the `CliError` (`code`, `error`, `do_instead`), the `--json` value's exact keys, markdown lines, and the repo afterwards (`git status`/staged paths, file contents, refs). It never calls store or the upgrade parts directly. Refusal tests assert nothing changed: no staged path, no file rewritten, no agent launched (the `FakeRunner` saw nothing), nothing pushed (the bare remote's refs unchanged). The baseline rule's texts and the inbox item are pinned once at S2; S1 asserts the code and that the text is S2's. Faked only at system boundaries, as today: the remote (`FakeRemote`, for labels), the runner and notifier, the clock; git is real, in a throwaway repo. Golden cases change only by the removal of the `record.move` cases; observe snapshots and transcripts should not change (empty `base_run_state` was already omitted), and any diff there is a finding to explain.

### Risks
- Test-suite churn from the missing-version refusal: every test repo that never ran `norn init`, or rewrote its team file, now refuses. The harness prefactor goes first, and a full `bun run test` plus the integration and e2e tiers early in the first slice shows what else lacks a version (e2e repos and fixtures written by hand).
- The run-state-on-branch removal crosses snapshot, observe, decide, act and view; a leftover reader shows as a type error once `branch_record`/`tree_root` leave the types, so remove the types and let `tsc` find the readers.
- A story branch from before the archive-ref move whose record exists only in its tree now reads as having no record; accepted (the person decided branch-tree run state goes) and called out in the release notes.
- The pinned golden cases and docs reference must be regenerated (`bun run golden -- --update`, `bun run docs:emit`) and the diff read: only the removed cases and commands may disappear.
