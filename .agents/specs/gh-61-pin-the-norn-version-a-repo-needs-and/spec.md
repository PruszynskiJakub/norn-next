---
id: gh-61
slug: pin-the-norn-version-a-repo-needs-and
provider: gh
number: 61
url: https://github.com/PruszynskiJakub/norn-next/issues/61
title: Pin the norn version a repo needs, and refuse a mismatched binary or drifted skills
assignee: PruszynskiJakub
labels:
  - norn
  - norn:wf:refinement
workflow: refinement
status: active
intake_at: 2026-11-03T12:15:39.840Z
body_hash: 3eaa09aea6f4416e7f61f26ce4e67f08fa771ecccc1f9a64797b88f6ff0e714d
---

# Pin the norn version a repo needs, and refuse a mismatched binary or drifted skills

## Problem

A repo is set up with one norn version, but every collaborator's machine, and the cron tick or `norn watch` on each one, runs whatever binary happens to be installed. Nothing records which norn the repo expects, so nothing notices when they drift apart. A binary from another minor version can misread the team config, the workflows or a unit's `runs/` state (before 1.0 a minor may change the machine contract, and 0.18.0 did: teammates on an older norn cannot read the migrated team file). Bundled skills in `.agents/skills/` that differ from the running binary's copies are only a warning in `norn doctor`, so agents follow a protocol from a different version than the one they report to.

People find out only when something breaks: a refused report, a corrupt unit, an agent calling a flag that does not exist. During norn's own self-hosting bootstrap `main` was at 0.9.1 while the installed binary was 0.8.0, and no command warned. Today keeping every machine on the right version rests on discipline alone.

## Solution

The team config records **the repo's norn version**: the exact version the repo was set up with, or last upgraded to. A binary matches it when it is the same minor (before 1.0; the same major after) and at least that patch. With a mismatched binary, every command that acts refuses with exit code 3 and says which norn to install, or to run `norn upgrade` to move the repo forward; commands that only read keep working and show the mismatch, and an agent already in a step can always finish reporting. Two commands split the work. `norn init` sets up a new repo or a new machine: it records the version only when the repo has none and never moves it, so a teammate setting up their machine cannot change what the team runs. `norn upgrade` (the new name of `norn migrate`) moves the repo to the running binary's version: the version, the bundled skills and any file migration that version needs, in one staged diff the person reviews and commits. It never moves the version backward.

Bundled skills that differ from the running binary's copies stop being a warning: norn starts no agent step in a unit whose worktree holds drifted skills, while gates, checks, syncs and merges go on, and the inbox names the fix. `norn doctor` and `norn doctor --repo` report the version and the skills as checks that fail, so CI running the released binary catches a stale version or a hand-edited bundled skill. A repo without the key works as today until someone runs `norn upgrade`.

## Behaviour

### The repo's norn version

- B1 As a person setting up a repo, I want `norn init` to record the norn version it set the repo up with, so that everyone working on the repo knows which norn it needs.
  Example: in a repo with no `norn_version` key, norn 0.19.0 runs `norn init` → `.agents/norn.config.yaml` now has `norn_version: 0.19.0` (uncommitted, in the same diff as the rest of `init`'s changes), and `init`'s output says "norn version: 0.19.0 (recorded)".

- B2 As a person, I want a binary to match the repo's norn version only when it is the same minor (before 1.0; the same major from 1.0 on) and at least that patch, so that a patch upgrade needs no commit while a minor that may change the machine contract does.
  Example: the repo's version is 0.18.0 → binaries 0.18.0 and 0.18.3 match; 0.17.9 and 0.19.0 do not. The repo's version is 0.18.2 → 0.18.1 does not match. The repo's version is 1.2.0 → 1.5.1 matches; 2.0.0 does not.

- B3 As a person, I want a malformed or misplaced `norn_version` treated like any other config error, so that I fix it the way I fix the rest of the config.
  Example: `norn_version: banana` in the team file → `norn tick` prints a Config error `config_invalid` naming the file and the key, exit code 6. `norn_version: 0.19.0` in `.agents/norn.config.local.yaml` or `~/.norn/config.yaml` → `config_wrong_file`, naming `.agents/norn.config.yaml` as the file that takes it.

- B4 As a person, I want `norn config list` and `norn config get norn_version` to show the repo's norn version and its source, so that I can see what the repo expects without opening the file.
  Example: `norn config get norn_version` → `0.19.0` from `repo`; in a repo without the key → no value, and the line says `norn upgrade` records it.

- B5 As a person in a repo set up before this shipped, I want norn to keep working when there is no `norn_version` key, so that upgrading norn breaks no repo.
  Example: a repo whose team file has no `norn_version` → `norn tick`, `norn brief` and every other command run as before; `norn doctor` shows a warning "no norn version recorded: run `norn upgrade`", and `norn status` shows the same hint. Only `norn upgrade` (B13) and `norn init` on a repo that has no version (B1) write the key; no other command does.

### Refusing a mismatched binary

- B6 As a person, I want every command that acts to refuse when my binary does not match the repo's norn version, so that a wrong binary never writes state, launches agents or changes the remote.
  Example: the repo's version is 0.19.0, the binary is 0.18.1 → `norn tick` prints a `CliError` "this repo needs norn 0.19.x (you run 0.18.1)" with `do_instead` "install norn 0.19.x", and exits 3 (`refused`). The same refusal comes from `watch` (each tick, see B11), `sync`, `brief`, `story start|approve|answer|edit|take|create|close|reopen|reset|checkout|update-branch|chat`, `run rerun|cancel|attach`, `tidy` and `config set|unset`. Nothing is written, launched or pushed.

- B7 As a person whose binary is newer than the repo's norn version, I want the refusal to tell me how to move the repo forward, so that I know the way out is a commit, not a downgrade.
  Example: the repo's version is 0.18.0, the binary is 0.19.0 → `norn tick` exits 3 with `do_instead` "run `norn upgrade` to move this repo to norn 0.19.0 and commit the change, or install norn 0.18.x".

- B8 As a person, I want the commands that only read to keep working on a mismatch and show it, so that I can still see where things stand and diagnose the mismatch.
  Example: binary 0.18.1 in a repo at 0.19.0 → `norn status` prints the inbox with a top item "this repo needs norn 0.19.x (you run 0.18.1): install norn 0.19.x"; `norn help`, `norn --version`, `norn doctor`, `norn story list|view|wait`, `norn run list|view` and `norn config list|get` run normally, with exit codes as today. `norn status --segment` shows the mismatch in the tab bar line.

- B9 As a person with a mismatched binary, I want `norn init`, `norn upgrade` (and its deprecated alias `norn migrate`) and `norn uninstall` to run anyway, so that the commands that set up or fix the repo are never themselves refused.
  Example: binary 0.19.0 in a repo at 0.18.0 → `norn upgrade` runs and moves the version (B13); `norn init` runs and leaves the version alone (B28); `norn migrate` and `norn uninstall` run.

- B10 As an agent in the middle of a step, I want `norn done`, `norn ask`, `norn stuck` and `norn hook` never refused for a version mismatch, so that a session already started can always report and is never stranded.
  Example: an agent's session was launched by norn 0.18.1; during the step the person pulls a base branch that sets the repo's version to 0.19.0 → the agent's `norn done done --handoff "…"` is accepted as usual, and its hooks keep reporting. The next `norn tick` on 0.18.1 is refused (B6), so no new step starts.

- B11 As a person running `norn watch`, I want it to keep running when the repo's norn version moves under it, skip the ticks it may not run and tell me once, so that a supervisor does not restart it in a loop and I learn about it without being flooded.
  Example: `norn watch` runs on 0.18.1; a pull sets the repo's version to 0.19.0 → each tick is skipped with the B6 refusal in its JSON line, one notification "this repo needs norn 0.19.x; ticks paused" is sent (not one per interval), and `watch` keeps running. If the version moves back to a matching one, ticks resume by themselves. A tick run from cron instead exits 3 each time.

- B12 As a collaborator, I want the repo's norn version to be read from my main checkout's team config, so that it changes for me when I pull the base branch, not before.
  Example: person A commits `norn_version: 0.19.0` to `main`; person B on 0.18.1 keeps working normally until they pull `main` into their main checkout; from then on B's acting commands are refused (B6) until B installs 0.19.x.

### Moving the version with `norn upgrade`

- B13 As a person with a newer binary, I want `norn upgrade` to move the repo's norn version forward, refresh the bundled skills and migrate whatever files that version needs, all in one staged diff, and tell me what moved, so that the upgrade is one reviewable commit and no version is ever committed that the files do not fit.
  Example: binary 0.19.0 in a repo at 0.17.0 whose team file still uses a key 0.18.0 moved → `norn upgrade` writes `norn_version: 0.19.0`, rewrites the bundled `norn*` skills in `.agents/skills/` to 0.19.0's copies, rewrites the moved key, stages it all and prints "norn version 0.17.0 → 0.19.0; skills updated: norn, norn-refine; config: `limits` moved to workflow defaults". Nothing is committed; the person reviews `git diff --staged` and commits it.

- ~~B14 `norn init` moves the version and says "run `norn migrate`".~~ Removed: `norn upgrade` does the version, the skills and the file migration in one diff (B13), so no window exists where the version is committed before the files fit it.

- B15 As a person, I want `norn upgrade` with the same version and matching files to change nothing, so that running it again is safe.
  Example: binary 0.19.0 in a repo at 0.19.0 with the bundled skills already matching and nothing to migrate → `norn upgrade` says "already on norn 0.19.0: nothing to upgrade" and `git diff` shows no change.

- B16 As a person, I want `norn upgrade` after a same-minor patch upgrade to record the newer patch, so that the repo states the version its skills came from.
  Example: binary 0.19.2 in a repo at 0.19.0 → `norn upgrade` writes `norn_version: 0.19.2` and refreshes the skills; once that is committed, binary 0.19.1 no longer matches (B2). `norn init` with the same binary moves nothing (B28).

- B17 As a team, I want `norn upgrade` to refuse to move the repo's norn version backward, so that a teammate on an old binary cannot silently downgrade the repo for everyone.
  Example: binary 0.18.1 in a repo at 0.19.0 → `norn upgrade` prints a `CliError` "this repo is set up for norn 0.19.0; upgrade will not move it back" with `do_instead` "install norn 0.19.x", exits 3, and changes no file. There is no flag to override it; a person who really means to go back edits the key in the team file by hand, where review sees it.

- B28 As a new teammate, I want `norn init` on an existing repo to set up my machine and leave the repo's norn version and bundled skills alone, pointing me at `norn upgrade` when they differ from my binary, so that setting up a machine never changes what the team runs.
  Example: binary 0.19.2 in a repo at 0.19.0 → `norn init` writes the first-run `~/.norn/config.yaml` and schema copies as today, leaves `norn_version: 0.19.0` and `.agents/skills/` untouched, and its output says "this repo is on norn 0.19.0, you run 0.19.2: `norn upgrade` moves it". A bundled skill that is missing is copied in; one that differs is left as it is and named in the same hint. With the binary on the same version as the repo, `init` repairs norn's own files as today.

- B29 As a person, I want `norn upgrade` to run only in the main checkout while no tick runs there, so that it never races a tick or changes a unit's worktree.
  Example: in a unit worktree → `norn upgrade` is refused, exit 3, naming the main checkout. In the main checkout while `norn watch` holds the tick lock → refused, exit 3, with `do_instead` "stop `norn watch` and run it again". Its layout and config moves behave as `norn migrate`'s do today: rerunnable, never committed.

- B30 As a person used to `norn migrate`, I want it to keep working as a deprecated alias of `norn upgrade` for one minor version, so that my scripts and habits do not break on the release that renames it.
  Example: `norn migrate` → does exactly what `norn upgrade` does and prints one line "`norn migrate` is now `norn upgrade`; the old name goes in the next minor". `norn help` lists `upgrade` and marks `migrate` deprecated. Every refusal and hint that named `norn migrate` (old layout, a moved config key, a slice still carrying `needs`) names `norn upgrade`.

### Drifted skills

- B18 As a person, I want norn to start no agent step in a unit whose worktree holds bundled skills that differ from the running binary's copies, so that agents never follow a protocol from another version.
  Example: binary 0.19.0 matches the repo; slice gh-61-02's worktree still holds 0.18.0's `norn` skill → `norn tick` launches no agent step for gh-61-02. Its gates, checks, base sync and merges still run, and every other unit with matching skills launches as usual.

- B19 As a person, I want a unit held back by drifted skills to show in the inbox with the command that fixes it, so that I know why it does not move.
  Example: gh-61-02 is held back by B18 → `norn status` lists it under Unblock: "skills differ from norn 0.19.0 (norn, norn-implement): bring the base in with `norn story update-branch gh-61`". When the main checkout itself holds drifted skills, one repo-level item says "skills differ from norn 0.19.0: run `norn upgrade` and commit".

- B20 As a person, I want `norn story start`, `norn story chat` and `norn brief` to refuse when the skills the agent would see have drifted, so that a session started by hand is held to the same rule.
  Example: in gh-61-02's worktree with drifted skills → `norn brief` prints a `CliError` "skills differ from norn 0.19.0: norn, norn-implement" with the same `do_instead` as B19, exit 3; `norn story start gh-61-02` and `norn story chat gh-61` refuse likewise.

- B21 As a team with our own skills, I want only norn's bundled skills checked for drift, so that our repo-local skills are never blocked.
  Example: `.agents/skills/release/` and `.agents/skills/issue/` (no `norn-` prefix, not bundled) differ from anything norn ships → nothing is held back and `doctor` does not mention them.

- B22 As a person with units in flight when the repo moves to a new version, I want each one to wait for its branch to take in the base before its next agent step, so that an upgrade needs no coordination beyond pulling and installing.
  Example: `main` moves to 0.19.0 while gh-61's story branch still holds 0.18.0's skills → after the person installs 0.19.0, gh-61's next agent step is held back (B18, B19) until the next base sync or `norn story update-branch gh-61` brings the new skills in; then it launches. Its pinned workflow is unchanged. Claims held by a machine that is now refused are not handed over: they expire as when a machine stops ticking, and a matching machine takes them over.

### Doctor and CI

- B23 As a person, I want `norn doctor` to report the repo's norn version and whether this binary matches it, so that I can check a machine at a glance.
  Example: binary 0.19.2, repo at 0.19.0 → a line "PASS norn 0.19.2 matches this repo's norn version 0.19.0". Binary 0.18.1, repo at 0.19.0 → "FAIL norn 0.18.1 does not match this repo's norn version 0.19.0" followed by "→ install norn 0.19.x", and `doctor` exits 1. No key → a warning "no norn version recorded: run `norn upgrade`", not a failure.

- B24 As a person, I want drifted bundled skills to be a failed `doctor` check, not a warning, so that `doctor` agrees with what blocks agent steps.
  Example: `.agents/skills/norn-review/SKILL.md` edited by hand → `norn doctor` shows "FAIL skills norn-review differs from norn 0.19.0's copy" with "→ run `norn upgrade` and commit (git diff .agents/skills/ shows the change)", and exits 1.

- B25 As a team, I want `norn doctor --repo` to include the version and skill checks, so that CI running the released binary goes red on a stale version, drifted bundled skills or an invalid workflow.
  Example: CI installs norn 0.19.0 and runs `norn doctor --repo` on a PR that hand-edits `.agents/skills/norn/SKILL.md` → the skills check fails and the job exits 1. On a PR where the repo's version is 0.18.0 → the version check fails. On a clean PR → every check passes, exit 0. No agent, runner or remote is needed, as today.

### Docs and self-hosting

- B26 As a person reading the docs, I want the repo's norn version, its match rule, the refusals and how to upgrade explained, so that I can roll out a new norn to a team.
  Example: the docs describe the `norn_version` key, which commands are refused and which are not, the upgrade path (install, `norn upgrade`, review, commit; teammates pull and install), that `norn init` is for a new repo or machine and never moves the version, the rename of `norn migrate`, and what in-flight units do (B22); the generated reference lists the key.

- B27 As a maintainer of norn, I want the `release` step to set this repo's norn version to the version it releases and refresh the bundled skill copies in the release PR, so that once the release merges and publishes, the released binary is exactly what `main` asks for.
  Example: the release PR for 0.20.0 bumps the package version and the README badge, and also sets `norn_version: 0.20.0` and updates `.agents/skills/norn*` from the bundled sources in the same diff. After it merges, binary 0.19.x is refused on `main` with "install norn 0.20.x", and the 0.20.0 binary just published matches.

## Out of scope

- A version range written by the person (`>=0.18 <0.20`) — the match rule is derived from the one recorded version (B2).
- An "upgrade in progress" state, or handing claims over during an upgrade — claims expire and are taken over as today (B22).
- Installing or updating the binary for the person — norn names the version to install; installing stays the person's.
- Writing `norn_version` automatically on first use — only `norn upgrade`, or `norn init` on a repo without one, writes it (B5).
- Keeping the `norn migrate` alias past the next minor — it is removed then (B30).
- Drift checks on repo-local skills — they are the repo's own (B21).
- An override flag for moving the version backward — hand-editing the key is the escape hatch (B17).

## Open questions

## Plan

Written by the `norn-plan` skill.
