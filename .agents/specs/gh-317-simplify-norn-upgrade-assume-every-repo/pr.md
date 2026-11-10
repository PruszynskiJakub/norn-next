## Summary

norn now assumes every repo starts at 0.30. `norn upgrade` only moves a repo from 0.30 on: it handles the skills, `norn_version`, staging and labels. A repo with no `norn_version`, or one below 0.30, is refused everywhere and told the one way forward. The old migrations, the old-layout guard and `norn migrate` are removed (+1954 / −3131 lines).

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

QA #4 ran on the current code (since QA #3: a clean merge of main and one e2e fixture line), using the dev CLI in throwaway repos. That included a full stubbed story run. 31 of the 32 criteria pass. The last one is for a person to judge (see the line after the list). Since QA, only the handoff has changed.

- **Upgrade rewrites and relinks the bundled skills**
  **After:** 0.30.0 → 0.31.0 with a drifted `norn-review` and a missing `.claude/skills/norn-tdd` link: both are fixed and staged, and HEAD is unchanged ([03-upgrade.txt](evidence/_story/01M72KMKJMDFAQSNA4E385AB71/03-upgrade.txt))
- **`norn_version` written last, a rerun finishes**
  **After:** with `.agents/` read-only, the version write fails after the skill is rewritten, so the repo still records 0.33.0. The rerun records 0.34.0 ([03.AC2.txt](evidence/_story/01M72KMKJMDFAQSNA4E385AB71/03.AC2.txt)). Caveat: the rerun stages only the config, so the skill rewritten earlier stays unstaged.
- **Everything staged, nothing committed, commit printed**
  **After:** prints `git commit -m "Upgrade norn to 0.31.0 (norn upgrade)"`, or `"Refresh norn's skills (norn upgrade)"` when only skills changed ([03-upgrade.txt](evidence/_story/01M72KMKJMDFAQSNA4E385AB71/03-upgrade.txt))
- **Labels created where missing, an unreachable remote reported**
  **After:** a stub `gh` that lists only `norn` sees only `label list` and `label create` calls, no edits or deletes, and the 18 missing labels are created. When `gh` fails, upgrade prints `labels: not checked — …` and exits 0 ([03-upgrade.txt](evidence/_story/01M72KMKJMDFAQSNA4E385AB71/03-upgrade.txt))
- **Already current: nothing to upgrade**
  **After:** prints `already on norn 0.31.0: nothing to upgrade` and stages nothing ([03-upgrade.txt](evidence/_story/01M72KMKJMDFAQSNA4E385AB71/03-upgrade.txt))
- **Older binary refused (`version_backward`)**
  **After:** binary 0.30.5 on a 0.31.0 repo exits 3 with `install norn 0.31.x`, 0 files changed ([03-upgrade.txt](evidence/_story/01M72KMKJMDFAQSNA4E385AB71/03-upgrade.txt))
- **`not_main_checkout`, `tick_locked`**
  **After:** both exit 3 with 0 files changed. `not_main_checkout` was seen in a linked worktree that norn made ([03-upgrade.txt](evidence/_story/01M72KMKJMDFAQSNA4E385AB71/03-upgrade.txt), [03.AC5-not-main.txt](evidence/_story/01M72KMKJMDFAQSNA4E385AB71/03.AC5-not-main.txt))
- **Upgrade on a pre-0.30 repo is refused with the 0.30 path**
  **Before:** ran the old migrations. **After:** on 0.29.4 it refuses with `version_too_old`, exit 3, and the file snapshot is unchanged ([guard-0.29.4.txt](evidence/_story/01M72KMKJMDFAQSNA4E385AB71/guard-0.29.4.txt))
- **Upgrade with no version is refused and names `norn init`**
  **After:** `version_missing`, exit 3, nothing staged ([guard-none.txt](evidence/_story/01M72KMKJMDFAQSNA4E385AB71/guard-none.txt))
- **Acting command on a pre-0.30 repo is refused with the 0.30 path**
  **Before:** ran, or pointed to `norn upgrade`. **After:** `tick` and `story start` exit 3 with `version_too_old` and the 0.30 path, and nothing is written ([guard-0.29.4.txt](evidence/_story/01M72KMKJMDFAQSNA4E385AB71/guard-0.29.4.txt), [guard-0.29.4.txt](evidence/_story/01M72KMKJMDFAQSNA4E385AB71/guard-0.29.4.txt))
- **Acting command with no version is refused, nothing written**
  **Before:** ran silently on default config. **After:** exit 3 with `version_missing`. A config that fails to load still exits 6 with `config_invalid` ([guard-none.txt](evidence/_story/01M72KMKJMDFAQSNA4E385AB71/guard-none.txt))
- **init, help, doctor and upgrade still run on such a repo**
  **After:** help exits 0, and doctor, init and upgrade each do their own check. `norn status` shows an Unblock item → `norn doctor`. `watch` refuses the ticks after the version drops to 0.29.4 (`skipped_version: 3`) ([guard-0.29.4.txt](evidence/_story/01M72KMKJMDFAQSNA4E385AB71/guard-0.29.4.txt), [02.AC5-watch.txt](evidence/_story/01M72KMKJMDFAQSNA4E385AB71/02.AC5-watch.txt))
- **doctor's version check fails with the guard's message**
  **Before:** a missing version was only a warning. **After:** `version.ok: false` with the guard's code, error and `do_instead` ([guard-0.29.4.txt](evidence/_story/01M72KMKJMDFAQSNA4E385AB71/guard-0.29.4.txt))
- **doctor: no layout section, no old layout or `norn migrate`**
  **After:** doctor has no `layout` or run-state key, and nothing in its output mentions the old layout or `migrate` ([05.AC3-06.AC3-doctor.txt](evidence/_story/01M72KMKJMDFAQSNA4E385AB71/05.AC3-06.AC3-doctor.txt))
- **init on no team file records the version**
  **After:** creates `.agents/norn.config.yaml` recording the running norn ([04.AC2-init.txt](evidence/_story/01M72KMKJMDFAQSNA4E385AB71/04.AC2-init.txt))
- **init on a team file with no version, or one below 0.30, is refused**
  **Before:** marked the repo as current. **After:** exit 3 with the 0.30 path, and the file snapshot is unchanged ([guard-0.29.4.txt](evidence/_story/01M72KMKJMDFAQSNA4E385AB71/guard-0.29.4.txt), [guard-none.txt](evidence/_story/01M72KMKJMDFAQSNA4E385AB71/guard-none.txt))
- **init on a team file from 0.30 on behaves as today**
  **After:** keeps 0.35.0 and the drifted `norn-plan`, and names `norn upgrade` ([04.AC4.txt](evidence/_story/01M72KMKJMDFAQSNA4E385AB71/04.AC4.txt))
- **A pre-0.13 repo reads as having no team file, nothing moved**
  **Before:** hit the layout guard and needed `norn migrate`. **After:** `tick`, `story start` and `sync` refuse with `version_missing`, and the old files keep their hashes. Agent hooks don't refuse ([05.AC1.txt](evidence/_story/01M72KMKJMDFAQSNA4E385AB71/05.AC1.txt), [05.AC2.txt](evidence/_story/01M72KMKJMDFAQSNA4E385AB71/05.AC2.txt))
- **`norn migrate` is unknown and gone from help**
  **After:** `unknown_command`, exit 2, the same as `norn frobnicate`. `norn help` mentions it 0 times ([03.AC10.txt](evidence/_story/01M72KMKJMDFAQSNA4E385AB71/03.AC10.txt))
- **`upgrade --json` holds only the five fields**
  **Before:** also `moves`, `config`, `run_state`, `gitattributes`. **After:** exactly `norn_version, skills, staged, commit, labels` ([03-upgrade.txt](evidence/_story/01M72KMKJMDFAQSNA4E385AB71/03-upgrade.txt))
- **`runs/` in a base or branch tree is never read, moved or warned about**
  **Before:** moved to archive refs, or off the branch on the first tick. **After:** in a stubbed story run, the branch tree's `runs/` stays the same after every tick and the story reaches done. Status and doctor say nothing about base-tree `runs/` ([06.AC1.txt](evidence/_story/01M72KMKJMDFAQSNA4E385AB71/06.AC1.txt), [06.AC2-clean.txt](evidence/_story/01M72KMKJMDFAQSNA4E385AB71/06.AC2-clean.txt))
- **Upgrade renames no keys, strips no `needs`, leaves `.gitattributes` alone**
  **After:** the spec, the slice and `.gitattributes` keep their hashes, and only the config is staged. An old config key is still flagged (`config_moved`, exit 6), with no `norn upgrade` hint ([03.AC9.txt](evidence/_story/01M72KMKJMDFAQSNA4E385AB71/03.AC9.txt))
- **Docs describe upgrade from 0.30 on, nothing old**
  **After:** the grep for old terms finds nothing, and `bun run docs:emit` leaves no diff ([03.AC11-grep.txt](evidence/_story/01M72KMKJMDFAQSNA4E385AB71/03.AC11-grep.txt), [03.AC11-docs-emit.txt](evidence/_story/01M72KMKJMDFAQSNA4E385AB71/03.AC11-docs-emit.txt))
- **Release notes call out the removals and the new refusal**
  **After:** commit `5e8451d29` names the refusal and both codes. `b45b051f0` names the removed `norn migrate` and the dropped `--json` fields ([02.AC7-03.AC12-commits.txt](evidence/_story/01M72KMKJMDFAQSNA4E385AB71/02.AC7-03.AC12-commits.txt))

Golden corpus and pinned outputs, for a person to judge (ruled acceptable at all three human QA gates): the only golden cases deleted are the four `run-state-move-*` cases and the `record.move` rule cases, and the golden corpus run passes (329 tests). Two other pinned outputs changed. One transcript line is gone: the `git cat-file -e …:runs` probe of a story branch's tree, which is the read this change removes. The five observe snapshots now record `norn.repo`/`norn.running` as 0.30.0 instead of 0.19.0, because the guard refuses the fixture's old pinned version 0.19.0 ([06.AC4.txt](evidence/_story/01M72KMKJMDFAQSNA4E385AB71/06.AC4.txt)). Minor notes the review accepted: init's `version_missing` hint loops back to `norn init`, and because upgrade checks the baseline before loading config, a broken config with no version exits 3, not 6.

## Merge danger

**Door:** one-way for users. A repo that records no `norn_version`, or one below 0.30, can no longer be moved forward by this norn and needs a 0.30.x binary first. The code itself reverts cleanly.

**Blast radius:** old repos and scripts.
- Every acting command now refuses a repo with no `norn_version`. Such a repo stops until someone runs `norn init` or follows the 0.30 path.
- Scripts that call `norn migrate`, or read the `moves`, `config`, `run_state` or `gitattributes` fields of `upgrade --json`, break.
- Accepted risk: a story whose record existed only in its branch tree, never in the machine dir or an archive ref, now reads as having no record.
