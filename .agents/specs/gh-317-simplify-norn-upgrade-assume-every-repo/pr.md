## Summary

Every repo is now assumed to start at norn 0.30. `norn upgrade` only moves a repo from 0.30 on (skills, `norn_version`, staging, labels). A repo with no `norn_version`, or one below 0.30, is refused everywhere with one path forward. The old migrations, the old-layout guard and `norn migrate` are gone (−3097 / +1827 lines).

```diff
 every acting command, upgrade, init, doctor's version check
+  baseline(repo norn_version, running norn)        # one pure rule in @norn/core
+    none   → refuse version_missing  (exit 3): "run `norn init` …, or install 0.30.x, upgrade, commit, upgrade again"
+    < 0.30 → refuse version_too_old  (exit 3): "install 0.30.x, run `norn upgrade`, commit, upgrade again"
   versionMismatch(...)                             # as before

 norn upgrade
   main checkout?  baseline  version_backward?  tick lock?
-  move old layout · rename config keys · strip criteria `needs` · move base-tree runs/ to archive refs · edit .gitattributes
   rewrite + relink skills → write norn_version last → stage → labels
-  --json: moves, config, run_state, gitattributes
+  --json: norn_version, skills, staged, commit, labels

-norn migrate · old-layout guard · record.move (runs/ in a branch tree) · doctor layout + run-state sections
```

## Evidence

QA #2 ran the dev CLI in throwaway repos: 31 of 32 criteria pass, the last one was ruled by a person (see the golden-corpus entry).

- **Upgrade rewrites and relinks the bundled skills**
  **Before:** same, plus the old migrations. **After:** on a 0.30.0 repo with a drifted `norn-qa` and a missing `.claude` link, both are fixed and staged, HEAD is unchanged ([03-upgrade.md](evidence/_story/01M72EXBA60X9ZJBGC6QA9R0G5/03-upgrade.md))
- **`norn_version` written last, a rerun finishes**
  **After:** with `.agents/` read-only, the version write fails after the skills are rewritten. The rerun records the version ([03.AC2.txt](evidence/_story/01M72GJ07X6THTYCA62QNXSS8D/03.AC2.txt)). The rerun stages only the config, so you have to stage the skill rewritten before the interruption yourself.
- **Everything staged, nothing committed, commit printed**
  **After:** prints `git commit -m "Upgrade norn to 0.31.0 (norn upgrade)"`, or `"Refresh norn's skills (norn upgrade)"` when only skills changed ([03-upgrade.md](evidence/_story/01M72EXBA60X9ZJBGC6QA9R0G5/03-upgrade.md))
- **Labels created where missing, an unreachable remote reported**
  **After:** a stub `gh` sees 18 `label create` calls and no edits. When the remote can't be reached, or labels can't be written, upgrade still exits 0 ([03.AC3.txt](evidence/_story/01M72GJ07X6THTYCA62QNXSS8D/03.AC3.txt))
- **Already current: nothing to upgrade**
  **After:** `already on norn 0.31.0: nothing to upgrade`, `staged: []`, `commit: null` ([03-upgrade.md](evidence/_story/01M72EXBA60X9ZJBGC6QA9R0G5/03-upgrade.md))
- **Older binary refused (`version_backward`)**
  **After:** binary 0.30.5 on a 0.31.0 repo exits 3 and changes nothing (`upgrade-version.test.ts`, QA ran it too)
- **`not_main_checkout`, `tick_locked`**
  **After:** both exit 3 and change nothing ([03.AC5.txt](evidence/_story/01M72GJ07X6THTYCA62QNXSS8D/03.AC5.txt))
- **Upgrade on a pre-0.30 repo is refused with the 0.30 path**
  **Before:** ran the old migrations. **After:** on 0.29.4, `version_too_old` with exit 3, nothing staged (`upgrade.test.ts` › "a repo recording 0.29.4: version_too_old …")
- **Upgrade with no version is refused and names `norn init`**
  **After:** `version_missing` with exit 3, nothing staged (`upgrade.test.ts` › "a repo recording no norn_version …")
- **Acting command on a pre-0.30 repo is refused with the 0.30 path**
  **Before:** passed, or pointed to `norn upgrade`. **After:** `tick` and `story start` exit 3 with `version_too_old`, repo unchanged ([02-guard.md](evidence/_story/01M72EXBA60X9ZJBGC6QA9R0G5/02-guard.md), [rule output](evidence/_story/01M72GJ07X6THTYCA62QNXSS8D/02.AC1-AC2.txt))
- **Acting command with no version is refused, nothing written**
  **Before:** ran silently on default config. **After:** exit 3 with `version_missing`. A config that fails to load still exits 6 ([02-guard.md](evidence/_story/01M72EXBA60X9ZJBGC6QA9R0G5/02-guard.md))
- **init, help, doctor and upgrade still run on such a repo**
  **After:** help exits 0, doctor and init do their own checks, `norn status` shows an Unblock item → `norn doctor`, and `watch` pauses ticks ([02-guard.md](evidence/_story/01M72EXBA60X9ZJBGC6QA9R0G5/02-guard.md), [02-watch-mid.md](evidence/_story/01M72EXBA60X9ZJBGC6QA9R0G5/02-watch-mid.md))
- **doctor's version check fails with the guard's message**
  **Before:** a missing version was only a warning. **After:** `FAIL norn` with the guard's code, error and `do_instead`, exit 1 ([04.AC1-json.txt](evidence/_story/01M72GJ07X6THTYCA62QNXSS8D/04.AC1-json.txt))
- **doctor: no layout section, no old layout or `norn migrate`**
  **After:** `repo` keys are exactly `config, ok, skills, version, workflows`, and nothing matches `layout|migrate` ([05.AC3.txt](evidence/_story/01M72GJ07X6THTYCA62QNXSS8D/05.AC3.txt))
- **init on no team file records the version**
  **After:** creates `.agents/norn.config.yaml` with the running norn ([04-AC2.md](evidence/_story/01M72EXBA60X9ZJBGC6QA9R0G5/04-AC2.md))
- **init on a team file with no version, or one below 0.30, is refused**
  **Before:** stamped the repo as current. **After:** exit 3 with the 0.30 path, git status unchanged ([04-doctor-init.md](evidence/_story/01M72EXBA60X9ZJBGC6QA9R0G5/04-doctor-init.md))
- **init on a team file from 0.30 on behaves as today**
  **After:** keeps 0.37.0, keeps the drifted skill and names `norn upgrade` ([04.AC4.txt](evidence/_story/01M72GJ07X6THTYCA62QNXSS8D/04.AC4.txt))
- **A pre-0.13 repo reads as having no team file, nothing moved**
  **Before:** layout guard and `norn migrate`. **After:** `version_missing`, and the old files keep their hashes. Agent hooks don't refuse ([05.AC1.txt](evidence/_story/01M72GJ07X6THTYCA62QNXSS8D/05.AC1.txt), [05.AC2.txt](evidence/_story/01M72GJ07X6THTYCA62QNXSS8D/05.AC2.txt))
- **`norn migrate` is unknown and gone from help**
  **After:** `unknown_command` with exit 2, the same as `norn frobnicate`, and help mentions it 0 times ([03.AC10.txt](evidence/_story/01M72GJ07X6THTYCA62QNXSS8D/03.AC10.txt))
- **`upgrade --json` holds only the five fields**
  **Before:** also had `moves`, `config`, `run_state` and `gitattributes`. **After:** exactly `norn_version, skills, staged, commit, labels` ([03-upgrade.md](evidence/_story/01M72EXBA60X9ZJBGC6QA9R0G5/03-upgrade.md))
- **`runs/` in a base or branch tree is never read, moved or warned about**
  **Before:** moved to archive refs or off the branch on the first tick. **After:** status and doctor say nothing about it ([06.AC2-AC3.txt](evidence/_story/01M72GJ07X6THTYCA62QNXSS8D/06.AC2-AC3.txt)). Ticks leave the branch tree alone (`branch-tree-run-state.test.ts`)
- **Upgrade renames no keys, strips no `needs`, leaves `.gitattributes` alone**
  **After:** the slice, spec and `.gitattributes` keep their hashes and aren't staged. An old config key is still flagged (exit 6), with no `norn upgrade` hint ([03.AC9.txt](evidence/_story/01M72GJ07X6THTYCA62QNXSS8D/03.AC9.txt))
- **Docs describe upgrade from 0.30 on, nothing old**
  **After:** the grep finds no old terms, and `bun run docs:emit` leaves no diff ([03.AC11-grep.txt](evidence/_story/01M72GJ07X6THTYCA62QNXSS8D/03.AC11-grep.txt), [03.AC11-docs-emit.txt](evidence/_story/01M72GJ07X6THTYCA62QNXSS8D/03.AC11-docs-emit.txt))
- **Release notes call out the removals and the new refusal**
  **After:** commit `5e8451d29` names the refusal and both codes. Commit `b45b051f0` names the removal of `norn migrate` and the dropped `--json` fields ([02.AC7.txt](evidence/_story/01M72GJ07X6THTYCA62QNXSS8D/02.AC7.txt), [03.AC12.txt](evidence/_story/01M72GJ07X6THTYCA62QNXSS8D/03.AC12.txt))

Golden corpus and transcripts (person, ruled at human QA): the only golden cases deleted are the four `run-state-move-*` ones. One transcript line is gone, the `git cat-file -e …:runs` probe of a story branch's tree, which is the read this change removes ([06.AC4.txt](evidence/_story/01M72GJ07X6THTYCA62QNXSS8D/06.AC4.txt)). Integration and e2e tiers run only in CI. Minor notes accepted by review: init's `version_missing` hint loops back to `norn init`. Upgrade checks the baseline before loading config, so a broken config with no version exits 3, not 6.

## Merge danger

**Door:** one-way for users: a repo that records no `norn_version`, or one below 0.30, can no longer be moved forward by this norn. It needs a 0.30.x binary first. The code itself reverts cleanly.

**Blast radius:** old repos and scripts.
- Every acting command now refuses a repo with no `norn_version`. Any repo set up without one stops until `norn init` or the 0.30 path.
- Scripts calling `norn migrate`, or reading `upgrade --json` `moves`, `config`, `run_state` or `gitattributes`, break.
- Accepted risk: a story branch whose record existed only in its tree, never in the machine dir or an archive ref, now reads as having no record.
