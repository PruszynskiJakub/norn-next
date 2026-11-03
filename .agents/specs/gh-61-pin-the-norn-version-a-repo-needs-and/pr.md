## Summary

The team config now records **the repo's norn version** (`norn_version` in `.agents/norn.config.yaml`). Today any installed binary runs against any repo, and drifted bundled skills only cause a `doctor` warning. With this change a binary that does not match the recorded version is refused on every command that acts. Commands that only read show the mismatch. Drifted bundled skills now stop agent steps from starting. `norn migrate` becomes `norn upgrade`: it moves the version, the skills and any file migration in one staged diff.

```text
runCli(command)
  locate repo, load main checkout's config            # B12: never a unit worktree's team file
  if command.versionClass == "acts"                   # tick, sync, brief, story *, run rerun|cancel|attach, tidy, config set|unset
    if norn_version recorded and !versionMatch(repo, running)   # same minor (same major ≥1.0), patch ≥ repo's
      refuse exit 3 "this repo needs norn 0.19.x (you run 0.18.1)"
  # "reads" (status, doctor, help, story list|view|wait, run list|view, config list|get) run and show the mismatch
  # "exempt" (init, upgrade/migrate, uninstall, done, ask, stuck, hook, check-run) always run
  run command

decide.startRun(unit)
+ if unit worktree's bundled norn* skills differ from the running binary's   # B18, before the mode check
+   noop "agent.skills_drift"; inbox: "bring the base in with `norn story update-branch`"
  …gates, checks, syncs and merges are decided as before
```

`norn watch` skips the ticks it may not run and sends one notification for each version pair (B11). `norn doctor` and `doctor --repo` gain a `norn` version check, and their `skills` check now fails instead of warning (B23–B25). The `release` step sets `norn_version` and refreshes `.agents/skills/norn*` in the release PR (B27). This PR does **not** add `norn_version` to this repo's own config. The next release does that.

## Evidence

QA ran every tier: typecheck, unit 1151/0 fail, integration 686 pass + 3 skip, e2e 73/0 fail ([AC-tests.log](https://github.com/PruszynskiJakub/norn-next/blob/gh-61-pin-the-norn-version-a-repo-needs-and/.agents/specs/gh-61-pin-the-norn-version-a-repo-needs-and/runs/_story/rounds/02-story/evidence/01M6H3WPVF62CAVCPCDWSHDT3G/AC-tests.log)). Hands-on checks ran in a throwaway repo through `runCli` with an injected binary version. All 51 criteria pass ([criteria.json](https://github.com/PruszynskiJakub/norn-next/blob/gh-61-pin-the-norn-version-a-repo-needs-and/.agents/specs/gh-61-pin-the-norn-version-a-repo-needs-and/runs/_story/rounds/02-story/evidence/01M6H3WPVF62CAVCPCDWSHDT3G/criteria.json)).

- **B1** `init` records the version
  **Before:** did not exist
  **After:** on a fresh repo `init` (0.19.0) prints "norn version: 0.19.0 (recorded)", and `norn_version: 0.19.0` sits in the uncommitted team file ([init.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-61-pin-the-norn-version-a-repo-needs-and/.agents/specs/gh-61-pin-the-norn-version-a-repo-needs-and/runs/_story/rounds/02-story/evidence/01M6H3WPVF62CAVCPCDWSHDT3G/init.md))
- **B2** match rule
  **Before:** did not exist
  **After:** `versionMatch` table test is green. Hands-on: with the repo at 0.19.0, binary 0.19.2 matches and 0.18.1 and 0.20.0 are refused. With the repo at 0.19.2, binary 0.19.1 is refused ([B13-B17.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-61-pin-the-norn-version-a-repo-needs-and/.agents/specs/gh-61-pin-the-norn-version-a-repo-needs-and/runs/_story/rounds/02-story/evidence/01M6H3WPVF62CAVCPCDWSHDT3G/B13-B17.md), [B6-B8.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-61-pin-the-norn-version-a-repo-needs-and/.agents/specs/gh-61-pin-the-norn-version-a-repo-needs-and/runs/_story/rounds/02-story/evidence/01M6H3WPVF62CAVCPCDWSHDT3G/B6-B8.md))
- **B3** malformed or misplaced key
  **Before:** did not exist
  **After:** `norn_version: banana` gives `config_invalid` naming the file and the key, exit 6. The key in the local file or in `~/.norn/config.yaml` gives `config_wrong_file` "belongs in `.agents/norn.config.yaml`" ([B3-B5.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-61-pin-the-norn-version-a-repo-needs-and/.agents/specs/gh-61-pin-the-norn-version-a-repo-needs-and/runs/_story/rounds/02-story/evidence/01M6H3WPVF62CAVCPCDWSHDT3G/B3-B5.md))
- **B4** `config get|list`
  **Before:** no such key
  **After:** `config get norn_version` returns `0.19.0` from `repo`. Without the key it says "not recorded: `norn upgrade` records it". `config set|unset norn_version` is refused with exit 3 and `written_by_norn`, because only `upgrade` writes it ([B3-B5.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-61-pin-the-norn-version-a-repo-needs-and/.agents/specs/gh-61-pin-the-norn-version-a-repo-needs-and/runs/_story/rounds/02-story/evidence/01M6H3WPVF62CAVCPCDWSHDT3G/B3-B5.md))
- **B5** no key keeps working
  **Before:** n/a
  **After:** `tick` runs with no refusal. `doctor` warns "no norn version recorded: run `norn upgrade`", and `status` shows the same item under Check ([B3-B5.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-61-pin-the-norn-version-a-repo-needs-and/.agents/specs/gh-61-pin-the-norn-version-a-repo-needs-and/runs/_story/rounds/02-story/evidence/01M6H3WPVF62CAVCPCDWSHDT3G/B3-B5.md))
- **B6** acting commands refuse
  **Before:** any binary acted on any repo
  **After:** `tick`, `sync`, `brief`, `tidy`, `config set`, `story start` and `run cancel` on 0.18.1 with the repo at 0.19.0 each give `version_mismatch` "this repo needs norn 0.19.x (you run 0.18.1)", `do_instead` "install norn 0.19.x", exit 3, and leave `git status` clean ([B6-B8.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-61-pin-the-norn-version-a-repo-needs-and/.agents/specs/gh-61-pin-the-norn-version-a-repo-needs-and/runs/_story/rounds/02-story/evidence/01M6H3WPVF62CAVCPCDWSHDT3G/B6-B8.md)). `version-class.test.ts` checks that every command declares a class.
- **B7** a newer binary is pointed at `upgrade`
  **Before:** did not exist
  **After:** binary 0.20.0 gets `do_instead` "run `norn upgrade` to move this repo to norn 0.20.0 and commit the change, or install norn 0.19.x" ([B6-B8.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-61-pin-the-norn-version-a-repo-needs-and/.agents/specs/gh-61-pin-the-norn-version-a-repo-needs-and/runs/_story/rounds/02-story/evidence/01M6H3WPVF62CAVCPCDWSHDT3G/B6-B8.md))
- **B8** read commands work and show it
  **Before:** n/a
  **After:** `--version`, `help`, `story list`, `run list`, `config list|get` and `doctor` exit as before. The top item of `status` is "! this repo needs norn 0.19.x (you run 0.18.1): install norn 0.19.x". `status --segment` shows `norn·repo ! this repo needs norn 0.19.x (you run 0.18.1)` ([B6-B8.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-61-pin-the-norn-version-a-repo-needs-and/.agents/specs/gh-61-pin-the-norn-version-a-repo-needs-and/runs/_story/rounds/02-story/evidence/01M6H3WPVF62CAVCPCDWSHDT3G/B6-B8.md))
- **B9** `init`, `upgrade`, `migrate` and `uninstall` are never refused
  **Before:** n/a
  **After:** a mismatched `upgrade` and `init` ran (see B13 and B28). `version-guard.test.ts` covers every exempt command.
- **B10** an agent can always report
  **Before:** n/a
  **After:** `version-guard.test.ts` asserts that `done`, `ask`, `stuck` and `hook` are accepted on a mismatch, and that `check-run` writes its receipt. Test only, not observed by hand.
- **B11** `watch` pauses and resumes
  **Before:** did not exist
  **After:** in `watch --max-ticks 5`, with the repo moved to 0.20.0 mid-run, ticks 2–3 print `version_mismatch` lines. When the version moves back, ticks 4–5 run again. The summary shows `skipped_version: 2` and exit 0 ([watch.err](https://github.com/PruszynskiJakub/norn-next/blob/gh-61-pin-the-norn-version-a-repo-needs-and/.agents/specs/gh-61-pin-the-norn-version-a-repo-needs-and/runs/_story/rounds/02-story/evidence/01M6H3WPVF62CAVCPCDWSHDT3G/watch.err), [watch.out](https://github.com/PruszynskiJakub/norn-next/blob/gh-61-pin-the-norn-version-a-repo-needs-and/.agents/specs/gh-61-pin-the-norn-version-a-repo-needs-and/runs/_story/rounds/02-story/evidence/01M6H3WPVF62CAVCPCDWSHDT3G/watch.out)). `watch-version.test.ts` asserts one notification per version pair.
- **B12** the version is read from the main checkout
  **Before:** n/a
  **After:** `version-guard.test.ts` AC6 asserts that a remote base does not count until it is pulled, and that a unit worktree's team file is never read. Test only.
- **B13** `upgrade` moves version, skills and keys in one staged diff
  **Before:** `migrate` moved only the layout and config keys
  **After:** with the repo at 0.17.0 and the `norn` skill edited, `upgrade` prints "norn version 0.17.0 → 0.19.0; skills updated: norn", and both files are staged and not committed. A moved `default_mode` key is moved and listed too ([B13-B17.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-61-pin-the-norn-version-a-repo-needs-and/.agents/specs/gh-61-pin-the-norn-version-a-repo-needs-and/runs/_story/rounds/02-story/evidence/01M6H3WPVF62CAVCPCDWSHDT3G/B13-B17.md), [B13b-B29.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-61-pin-the-norn-version-a-repo-needs-and/.agents/specs/gh-61-pin-the-norn-version-a-repo-needs-and/runs/_story/rounds/02-story/evidence/01M6H3WPVF62CAVCPCDWSHDT3G/B13b-B29.md))
- **B15** running `upgrade` again does nothing
  **After:** it prints "already on norn 0.19.0: nothing to upgrade", and `git status` is empty ([B13-B17.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-61-pin-the-norn-version-a-repo-needs-and/.agents/specs/gh-61-pin-the-norn-version-a-repo-needs-and/runs/_story/rounds/02-story/evidence/01M6H3WPVF62CAVCPCDWSHDT3G/B13-B17.md))
- **B16** a patch upgrade records the patch
  **After:** binary 0.19.2 writes `norn_version: 0.19.2`. Once that is committed, `tick` on 0.19.1 is refused with exit 3 ([B13-B17.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-61-pin-the-norn-version-a-repo-needs-and/.agents/specs/gh-61-pin-the-norn-version-a-repo-needs-and/runs/_story/rounds/02-story/evidence/01M6H3WPVF62CAVCPCDWSHDT3G/B13-B17.md))
- **B17** never moves backward
  **After:** `upgrade` and `migrate` on 0.18.1 with the repo at 0.19.0 give `version_backward` "this repo is set up for norn 0.19.0; upgrade will not move it back", exit 3, and `git status` stays clean ([B13-B17.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-61-pin-the-norn-version-a-repo-needs-and/.agents/specs/gh-61-pin-the-norn-version-a-repo-needs-and/runs/_story/rounds/02-story/evidence/01M6H3WPVF62CAVCPCDWSHDT3G/B13-B17.md))
- **B18** drifted skills hold agent steps
  **Before:** `doctor` warned, and agents started anyway
  **After:** core `skills-drift.test.ts`: the drifted slice is held and its sibling is launched; a manual unit is held too; checks, gates and base sync are still decided. `skills-drift-hold.test.ts` (D14) asserts that a worktree recording a newer `norn_version` is not held. Test only.
- **B19** the inbox names the fix
  **After:** with the main checkout drifted, `status` shows under Unblock "skills differ from norn 0.19.0: run `norn upgrade` and commit" ([B23-B25.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-61-pin-the-norn-version-a-repo-needs-and/.agents/specs/gh-61-pin-the-norn-version-a-repo-needs-and/runs/_story/rounds/02-story/evidence/01M6H3WPVF62CAVCPCDWSHDT3G/B23-B25.md)). The per-unit "`norn story update-branch`" item is covered by tests only.
- **B20** `brief`, `story start` and `story chat` refuse on drift
  **After:** `skills-drift-refusal.test.ts` asserts all three give exit 3 with the B19 `do_instead`. Test only.
- **B21** repo-local skills are never checked
  **After:** a repo-local `release` skill that differs is never named by `doctor` or `status` ([B23-B25.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-61-pin-the-norn-version-a-repo-needs-and/.agents/specs/gh-61-pin-the-norn-version-a-repo-needs-and/runs/_story/rounds/02-story/evidence/01M6H3WPVF62CAVCPCDWSHDT3G/B23-B25.md))
- **B22** in-flight units wait for the base
  **After:** e2e `base-sync.test.ts` "gh-61 B22": the story is held at its agent step until a base sync brings the new skills in, then it launches with its pinned workflow unchanged. Test only.
- **B23** `doctor` reports the version
  **After:** binary 0.19.2 gives "ok norn 0.19.2 matches this repo's norn version 0.19.0". Binary 0.18.1 gives "FAIL … → install norn 0.19.x" and exit 1 ([B3-B5.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-61-pin-the-norn-version-a-repo-needs-and/.agents/specs/gh-61-pin-the-norn-version-a-repo-needs-and/runs/_story/rounds/02-story/evidence/01M6H3WPVF62CAVCPCDWSHDT3G/B3-B5.md), [B6-B8.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-61-pin-the-norn-version-a-repo-needs-and/.agents/specs/gh-61-pin-the-norn-version-a-repo-needs-and/runs/_story/rounds/02-story/evidence/01M6H3WPVF62CAVCPCDWSHDT3G/B6-B8.md)). The passing line reads `ok`, as other doctor lines do, not "PASS" as the spec's example has it.
- **B24** a drifted skill fails `doctor`
  **Before:** a warning
  **After:** "FAIL skills norn-review differs from norn 0.19.0's copy → run `norn upgrade` and commit (git diff .agents/skills/ shows the change)", exit 1 ([B23-B25.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-61-pin-the-norn-version-a-repo-needs-and/.agents/specs/gh-61-pin-the-norn-version-a-repo-needs-and/runs/_story/rounds/02-story/evidence/01M6H3WPVF62CAVCPCDWSHDT3G/B23-B25.md))
- **B25** `doctor --repo` includes both checks
  **After:** with no remote or runner set up, an edited skill gives exit 1, a repo at an older version gives `FAIL norn` and exit 1, and a clean repo gives exit 0 ([B23-B25.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-61-pin-the-norn-version-a-repo-needs-and/.agents/specs/gh-61-pin-the-norn-version-a-repo-needs-and/runs/_story/rounds/02-story/evidence/01M6H3WPVF62CAVCPCDWSHDT3G/B23-B25.md)). Adding the CI job to this repo is a follow-up (D15).
- **B26** docs
  **After:** `docs/concepts.md` "The repo's norn version" and `docs/recipes.md` "Roll out a new norn to a team" are read and match the behaviour. The generated reference lists `norn_version` and `upgrade`, and the docs lint and reference staleness tests are green ([docs-release.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-61-pin-the-norn-version-a-repo-needs-and/.agents/specs/gh-61-pin-the-norn-version-a-repo-needs-and/runs/_story/rounds/02-story/evidence/01M6H3WPVF62CAVCPCDWSHDT3G/docs-release.md))
- **B27** the release step sets the version and copies the skills
  **After:** checked by reading only. `.agents/skills/release/SKILL.md` and `.agents/workflows/release.yaml` `prepare` now set `norn_version: X.Y.Z` and copy `assets/skills/norn*` in the same diff ([docs-release.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-61-pin-the-norn-version-a-repo-needs-and/.agents/specs/gh-61-pin-the-norn-version-a-repo-needs-and/runs/_story/rounds/02-story/evidence/01M6H3WPVF62CAVCPCDWSHDT3G/docs-release.md)). It will first be exercised by the next release.
- **B28** `init` on an existing repo leaves the version alone
  **After:** binary 0.19.2 with the repo at 0.19.0: `init` copies the missing `norn-tdd`, keeps the edited `norn-review` and `norn_version: 0.19.0`, and prints "this repo is on norn 0.19.0, you run 0.19.2: `norn upgrade` moves it, with the bundled skills that differ: norn-review". On the same version, `init` repairs `norn-review` ([B28-B30-K.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-61-pin-the-norn-version-a-repo-needs-and/.agents/specs/gh-61-pin-the-norn-version-a-repo-needs-and/runs/_story/rounds/02-story/evidence/01M6H3WPVF62CAVCPCDWSHDT3G/B28-B30-K.md))
- **B29** `upgrade` runs only in the main checkout, with no tick
  **After:** in a unit worktree it gives `not_main_checkout`, exit 3. With the tick lock held it gives exit 3 with "stop `norn watch` and run it again", and nothing is changed ([B13b-B29.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-61-pin-the-norn-version-a-repo-needs-and/.agents/specs/gh-61-pin-the-norn-version-a-repo-needs-and/runs/_story/rounds/02-story/evidence/01M6H3WPVF62CAVCPCDWSHDT3G/B13b-B29.md), [B29-lock.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-61-pin-the-norn-version-a-repo-needs-and/.agents/specs/gh-61-pin-the-norn-version-a-repo-needs-and/runs/_story/rounds/02-story/evidence/01M6H3WPVF62CAVCPCDWSHDT3G/B29-lock.md)). QA note: `watch` holds the lock only during a tick, so an `upgrade` run between `watch` ticks is not refused.
- **B30** `migrate` is a deprecated alias
  **After:** `migrate` prints one deprecation line and the same output as `upgrade`. `help` lists "migrate Deprecated: the old name of norn upgrade, removed in the next minor", and every config-moved hint now says `norn upgrade` ([B28-B30-K.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-61-pin-the-norn-version-a-repo-needs-and/.agents/specs/gh-61-pin-the-norn-version-a-repo-needs-and/runs/_story/rounds/02-story/evidence/01M6H3WPVF62CAVCPCDWSHDT3G/B28-B30-K.md))
- **K8 / 04.AC6** an older norn on a repo that has the key
  **After:** released 0.18.0 gives `config_invalid` "unknown key `norn_version`", exit 6, and writes nothing. This is documented in `docs/recipes.md` ([B28-B30-K.md](https://github.com/PruszynskiJakub/norn-next/blob/gh-61-pin-the-norn-version-a-repo-needs-and/.agents/specs/gh-61-pin-the-norn-version-a-repo-needs-and/runs/_story/rounds/02-story/evidence/01M6H3WPVF62CAVCPCDWSHDT3G/B28-B30-K.md))

## Merge danger

**Door:** two-way for this PR, one-way per repo once it ships. Reverting the code undoes it, and this PR does not add `norn_version` to any repo. But once a release writes the key into a repo's team file (`init`, `upgrade`, or this repo's next `release` step), every norn ≤ 0.18 and any build without this change refuses that repo with exit 6. A `skills_drift` field on an `update` receipt is also unreadable to an older norn.

**Blast radius:** every norn user, after the next release. Possible harm:
- A wrong version class on a command would either let a mismatched binary write state, or wrongly refuse a command. `version-class.test.ts` pins each class.
- Drifted skills now hold agent steps. After an upgrade, in-flight units wait for a base sync or `norn story update-branch` (B22), and a hand-edited `norn*` skill in a worktree stops its agent steps until it is fixed.
- `doctor` exits 1 on drifted skills where it used to warn, so any script or CI that runs `doctor` can go red.
- `migrate` still works but is deprecated.
