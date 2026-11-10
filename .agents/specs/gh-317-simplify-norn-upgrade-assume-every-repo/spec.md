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
  - norn:wf:refinement
workflow: refinement
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

A repo whose `norn_version` is below 0.30, or missing, is refused with one clear instruction: install norn 0.30.x, run `norn upgrade`, commit, then upgrade again (and, for a missing version, `norn init` if the repo was never set up). The same refusal comes from `norn upgrade`, from every command that acts, from `norn doctor`'s version check, and from `norn init` on a team file that records no version. norn no longer guesses at an old repo's shape: it does not look for the old layout anywhere.

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
16. As a person running `norn init` in a repo whose team file exists but records no `norn_version`, I want it refused (exit 3) with nothing changed and the 0.30 path as `do_instead`, so that a repo set up by an older norn is not stamped current while its config stays half-moved.
17. As a person running `norn init` in a repo whose team file records a `norn_version`, I want it to behave as today (never moving the version, leaving a differing bundled skill and naming `norn upgrade`), so that re-running init stays idempotent.
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
