## Summary

norn now assumes every repo starts at 0.30. `norn upgrade` only moves a repo from 0.30 on: it handles the skills, `norn_version`, staging and labels. A repo with no `norn_version`, or one below 0.30, is refused everywhere and told the one way forward. The old migrations, the old-layout guard and `norn migrate` are removed (+1955 / −3138 lines).

```diff
 every acting command, upgrade, init, doctor's version check, watch
+  baseline(repo norn_version, running norn)        # one pure rule in @norn/core
+    none   → refuse version_missing (exit 3): "run `norn init` …; or install 0.30.x, upgrade, commit, upgrade again"
+    < 0.30 → refuse version_too_old (exit 3): "install 0.30.x, run `norn upgrade`, commit, upgrade again"
   versionMismatch(...)                             # as before

 norn upgrade
   main checkout? · baseline · version_backward? · tick lock?
-  move old layout · rename config keys · strip criteria `needs` · move base-tree runs/ to archive refs · edit .gitattributes
   rewrite + relink skills → write norn_version last → stage → labels
-  --json: moves, config, run_state, gitattributes
+  --json: norn_version, skills, staged, commit, labels

-norn migrate · old-layout guard · record.move (runs/ in a branch tree) · doctor layout + run-state sections
```

## Evidence

QA #6 ran on the current code (since QA #5 only one test changed: an empty version-only commit dropped from a fixture), using the dev CLI in throwaway repos, including a full stubbed story run. 31 of the 32 criteria pass; the last is for a person to judge (see the line after the list). Since QA, only the handoff has changed.

- **Upgrade rewrites and relinks the bundled skills**
  **After:** 0.30.0 → 0.31.0 with a drifted `norn-qa` and a missing `.claude/skills/norn-tdd` link: both fixed and staged, HEAD unchanged ([03-upgrade.md](evidence/_story/01M72P04QEGAH7M7QADVQJ39WN/03-upgrade.md))
- **`norn_version` written last, a rerun finishes**
  **After:** interrupted after the skills with the repo still at 0.30.0, the rerun records 0.31.0 ([03-upgrade.md](evidence/_story/01M72P04QEGAH7M7QADVQJ39WN/03-upgrade.md)). Caveat: the rerun stages only the config, so a skill rewritten before the interruption and left unstaged stays unstaged.
- **Everything staged, nothing committed, commit printed**
  **After:** prints `git commit -m "Upgrade norn to 0.31.0 (norn upgrade)"`, or `"Refresh norn's skills (norn upgrade)"` when only a skill differs ([03-upgrade.md](evidence/_story/01M72P04QEGAH7M7QADVQJ39WN/03-upgrade.md))
- **Labels created where missing, an unreachable remote reported**
  **After:** a stub `gh` that lists only `norn` sees one `label list` and 18 `label create` calls, no edits or deletes. When `gh` fails, upgrade prints `labels: not checked — …` and exits 0 ([03-labels.md](evidence/_story/01M72P04QEGAH7M7QADVQJ39WN/03-labels.md))
- **Already current: nothing to upgrade**
  **After:** prints `already on norn 0.31.0: nothing to upgrade` and stages nothing ([03-upgrade.md](evidence/_story/01M72P04QEGAH7M7QADVQJ39WN/03-upgrade.md))
- **Older binary, linked worktree, running tick are refused**
  **After:** `version_backward` (binary 0.30.0 on a 0.31.0 repo, `install norn 0.31.x`), `not_main_checkout` and `tick_locked` each exit 3 with nothing changed ([03-refusals.md](evidence/_story/01M72P04QEGAH7M7QADVQJ39WN/03-refusals.md))
- **Upgrade on a pre-0.30 repo is refused with the 0.30 path**
  **Before:** ran the old migrations. **After:** on 0.29.4 it refuses with `version_too_old`, exit 3, nothing changed ([02-guard-2.md](evidence/_story/01M72P04QEGAH7M7QADVQJ39WN/02-guard-2.md))
- **Upgrade with no version is refused and names `norn init`**
  **After:** `version_missing`, exit 3, nothing staged ([02-guard-2.md](evidence/_story/01M72P04QEGAH7M7QADVQJ39WN/02-guard-2.md))
- **Acting command on a pre-0.30 repo is refused with the 0.30 path**
  **Before:** ran, or pointed to `norn upgrade`. **After:** `tick` and `story start` exit 3 with `version_too_old` and the 0.30 path, nothing written; a 0.30.0 repo ticks as before ([02-guard.md](evidence/_story/01M72P04QEGAH7M7QADVQJ39WN/02-guard.md), [02-rule.md](evidence/_story/01M72P04QEGAH7M7QADVQJ39WN/02-rule.md))
- **Acting command with no version is refused, nothing written**
  **Before:** ran silently on default config. **After:** exit 3 with `version_missing`. A config that fails to load still exits 6 ([02-guard.md](evidence/_story/01M72P04QEGAH7M7QADVQJ39WN/02-guard.md), [02-guard-2.md](evidence/_story/01M72P04QEGAH7M7QADVQJ39WN/02-guard-2.md))
- **init, help, doctor and upgrade still run; status and watch say why**
  **After:** help exits 0, and doctor, init and upgrade each do their own check. `norn status` shows an Unblock item → `norn doctor`. `watch` refuses at start on 0.29.4, and mid-run skips the ticks after the version is removed (`skipped_version: 6`) ([02-guard-2.md](evidence/_story/01M72P04QEGAH7M7QADVQJ39WN/02-guard-2.md), [02-04-doctor-watch.md](evidence/_story/01M72P04QEGAH7M7QADVQJ39WN/02-04-doctor-watch.md))
- **doctor's version check fails with the guard's message**
  **Before:** a missing version was only a warning. **After:** `FAIL norn` with the guard's error and `do_instead`, exit 1 ([02-04-doctor-watch.md](evidence/_story/01M72P04QEGAH7M7QADVQJ39WN/02-04-doctor-watch.md))
- **doctor: no layout section, no old layout or `norn migrate`**
  **After:** doctor's repo keys are `ok, version, skills, workflows, config`; 0 lines mention layout or migrate ([05-layout.md](evidence/_story/01M72P04QEGAH7M7QADVQJ39WN/05-layout.md))
- **init on no team file records the version**
  **After:** creates `.agents/norn.config.yaml` with `norn_version: 0.30.0`, the running norn ([04-init.md](evidence/_story/01M72P04QEGAH7M7QADVQJ39WN/04-init.md))
- **init on a team file with no version, or one below 0.30, is refused**
  **Before:** marked the repo as current. **After:** exit 3 (`version_missing` / `version_too_old`) with the 0.30 path, nothing changed ([04-init.md](evidence/_story/01M72P04QEGAH7M7QADVQJ39WN/04-init.md))
- **init on a team file from 0.30 on behaves as today**
  **After:** keeps 0.30.0 and the differing `norn-qa`/`norn-tdd`, and names `norn upgrade` ([04-init.md](evidence/_story/01M72P04QEGAH7M7QADVQJ39WN/04-init.md))
- **A pre-0.13 repo reads as having no team file, nothing moved**
  **Before:** hit the layout guard and needed `norn migrate`. **After:** `tick`, `story start` and `config set` refuse with `version_missing`, the old files are unchanged, agent hooks don't refuse ([05-layout.md](evidence/_story/01M72P04QEGAH7M7QADVQJ39WN/05-layout.md))
- **`norn migrate` is unknown and gone from help**
  **After:** `unknown_command`, exit 2; `norn help` does not list it ([03-old-files-migrate.md](evidence/_story/01M72P04QEGAH7M7QADVQJ39WN/03-old-files-migrate.md))
- **`upgrade --json` holds only the five fields**
  **Before:** also `moves`, `config`, `run_state`, `gitattributes`. **After:** exactly `norn_version, skills, staged, commit, labels` ([03-upgrade.md](evidence/_story/01M72P04QEGAH7M7QADVQJ39WN/03-upgrade.md))
- **`runs/` in a base or branch tree is never read, moved or warned about**
  **Before:** moved to archive refs, or off the branch on the first tick. **After:** in a stubbed story run the branch tree's `runs/` keeps its tree hash through every tick and the story reaches done; status and doctor say nothing about base-tree `runs/` ([06-AC1.md](evidence/_story/01M72P04QEGAH7M7QADVQJ39WN/06-AC1.md), [06-base-runs.md](evidence/_story/01M72P04QEGAH7M7QADVQJ39WN/06-base-runs.md))
- **Upgrade renames no keys, strips no `needs`, leaves `.gitattributes` alone**
  **After:** only the config and the skill change; `needs` and `.gitattributes` stay. An old config key is still flagged (`config_moved`, exit 6) with no `norn upgrade` hint ([03-old-files-migrate.md](evidence/_story/01M72P04QEGAH7M7QADVQJ39WN/03-old-files-migrate.md))
- **Docs describe upgrade from 0.30 on, nothing old**
  **After:** the grep for old terms near upgrade finds nothing, and `bun run docs:emit` leaves no diff ([03-AC11-docs.md](evidence/_story/01M72P04QEGAH7M7QADVQJ39WN/03-AC11-docs.md))
- **Release notes call out the removals and the new refusal**
  **After:** commit `5e8451d29` names the refusal and both codes; `b45b051f0` names the removed `norn migrate` and the dropped `--json` fields ([02.AC7-03.AC12-commits.md](evidence/_story/01M72P04QEGAH7M7QADVQJ39WN/02.AC7-03.AC12-commits.md))

Golden corpus and pinned outputs, for a person to judge (ruled acceptable at all five human QA gates): against merge base `5e1fee846`, the only golden cases deleted are the four `run-state-move-*` cases (with the `record.move` rule cases), and the remaining corpus replays 329/329. Two other pinned outputs changed: one transcript line is gone, the `git cat-file -e …:runs` probe of a story branch's tree, which is the read this change removes; and the five observe snapshots record `norn.repo`/`norn.running` as 0.30.0 instead of 0.19.0, because the guard refuses the fixture's old 0.19.0 ([06-AC4-golden.md](evidence/_story/01M72P04QEGAH7M7QADVQJ39WN/06-AC4-golden.md)). Minor notes the review accepted: init's `version_missing` hint loops back to `norn init`, and because upgrade checks the baseline before loading config, a broken config with no version exits 3, not 6.

## Merge danger

**Door:** one-way for users. A repo that records no `norn_version`, or one below 0.30, can no longer be moved forward by this norn and needs a 0.30.x binary first. The code itself reverts cleanly; no file in a user's repo is rewritten by this change.

**Blast radius:** old repos and scripts.
- Every acting command now refuses a repo with no `norn_version`. Such a repo stops until someone runs `norn init` or follows the 0.30 path.
- Scripts that call `norn migrate`, or read the `moves`, `config`, `run_state` or `gitattributes` fields of `upgrade --json`, break.
- Accepted risk: a story whose record existed only in its branch tree, never in the machine dir or an archive ref, now reads as having no record.
