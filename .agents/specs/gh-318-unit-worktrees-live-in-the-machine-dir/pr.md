## Summary

Unit worktrees now live in the checkout's machine dir, next to its run state. norn no longer creates a `<repo>-worktrees/` folder beside your repository. Store's `worktreesDir` is the only code that names the folder. The folder reaches decide as `Facts.repo.worktrees`, so core stays pure. The machine dir is now built on the resolved norn home, so worktree paths are spelled the way `git worktree list` spells them, even when the home is reached through a symlink.

```
~/projects/
  norn-next/                         # your checkout; norn puts nothing beside it now
- norn-next-worktrees/               # gone
~/.norn/repos/norn-next-<hash>/      # the checkout's machine dir (home resolved)
  runs/                              # run state, as before
+ worktrees/
+   gh-318-<slug>                    # story worktree
+   gh-318-<slug>--03-<slug>         # slice worktree, beside its story's
```

## Evidence

QA ran at 040bcca5 (the code at the current head; only norn's commits came after) from the user's side: real ticks through the cli harness in temp repos, with real git and a fake gh. All 16 criteria `pass`. The full table is in [report.md](evidence/_story/01M72FV748N29PT1NVJMXH8818/report.md).

- **`sync` / `story start` create the story worktree in the machine dir**
  **Before:** `<repo>-worktrees/<story>-<slug>`
  **After:** `git worktree list` shows `…/home/repos/repo-97033bbb/worktrees/gh-2-split-work`, and the repo has no `*-worktrees` sibling ([03.AC1](evidence/_story/01M72FV748N29PT1NVJMXH8818/03.AC1.md), [observe-output.md](evidence/_story/01M72FV748N29PT1NVJMXH8818/observe-output.md)).
- **A slice worktree sits beside its story's**
  **Before:** `<repo>-worktrees/<story>-<slug>--<nn>-<slug>`
  **After:** `…/worktrees/gh-2-split-work--01-first` sits next to `…/worktrees/gh-2-split-work` ([03.AC2](evidence/_story/01M72FV748N29PT1NVJMXH8818/03.AC2.md)).
- **No `<repo>-worktrees/` folder from any command**
  **Before:** every repo norn ran in got one.
  **After:** the harness cleanup now throws if a `*-worktrees` folder exists beside the test repo, so every integration and e2e test checks this. e2e passed 74/74 with the check on, and no QA run left one beside its repos ([03.AC3](evidence/_story/01M72FV748N29PT1NVJMXH8818/03.AC3.md)).
- **Worktrees follow a bound home, including a symlinked one**
  **Before:** always beside the repo, whatever the home.
  **After:** with `NORN_HOME_DIR`, or with a home given to the command, the worktree goes under that home's `repos/<id>/worktrees/`. With `NORN_HOME_DIR` pointing at a symlink, the worktree is at the resolved `real-home/repos/repo-s-fabc4f21/worktrees/gh-11-linked-home` ([03.AC4](evidence/_story/01M72FV748N29PT1NVJMXH8818/03.AC4.md), [observe3-output.md](evidence/_story/01M72FV748N29PT1NVJMXH8818/observe3-output.md)).
- **Two clones never share a worktree folder**
  **Before:** each clone had its own sibling folder.
  **After:** both clones take in `gh-10`. Their worktrees land in `home/repos/repo-5289e172/worktrees/` and `home-repo-b/repos/repo-b-a35604fa/worktrees/`, two different paths ([03.AC5](evidence/_story/01M72FV748N29PT1NVJMXH8818/03.AC5.md)).
- **`--print`, the inbox, the brief and the Herdr tab show the new path**
  **Before:** they showed the `<repo>-worktrees/` path.
  **After:** all of these use `…/worktrees/gh-7-add-login-form`: the inbox's `$ cd …` line, the `story start --print` JSON and the Herdr tab's cwd. `norn brief` run from that worktree exits 0 ([03.AC6](evidence/_story/01M72FV748N29PT1NVJMXH8818/03.AC6.md)).
- **`norn tidy` cleans orphans at the new location**
  **Before:** it looked only in `<repo>-worktrees/`.
  **After:** `tidy` reports `worktrees/gh-97-gone` (clean) and `worktrees/gh-96-dirty` (uncommitted changes), and removes only the clean one. Under a symlinked home it finds the orphan too ([03.AC7](evidence/_story/01M72FV748N29PT1NVJMXH8818/03.AC7.md)).
- **`story start` notices a deleted worktree**
  **Before:** it checked the old folder.
  **After:** after `rm -rf` of the story worktree, `norn story start gh-7` exits 0 and the worktree is back on its branch ([03.AC8](evidence/_story/01M72FV748N29PT1NVJMXH8818/03.AC8.md)).
- **The view finds unit worktrees**
  **Before:** `scanWorktrees` read `<repo>-worktrees/`.
  **After:** `status --json` gives each unit's `reach.worktree` under `…/worktrees/`, and `story list` gives the story's root there ([03.AC9](evidence/_story/01M72FV748N29PT1NVJMXH8818/03.AC9.md)).
- **The docs say where worktrees live**
  **Before:** they said worktrees sit beside the repo.
  **After:** the run-state paragraph and the glossary's worktree row in `docs/concepts.md` name `<machine dir>/worktrees/`. `git grep -e '-worktrees'` finds nothing in docs, README, AGENTS.md or the shipped assets ([03.AC11](evidence/_story/01M72FV748N29PT1NVJMXH8818/03.AC11.md), [greps.md](evidence/_story/01M72FV748N29PT1NVJMXH8818/greps.md)).

The golden corpus (136 cases) is rewritten to the new paths. With the worktree prefix normalised, its decisions are identical to base. At the prefactor commit they were byte-identical with the old folder as the fact ([01.AC2](evidence/_story/01M72FV748N29PT1NVJMXH8818/01.AC2.md), [03.AC10](evidence/_story/01M72FV748N29PT1NVJMXH8818/03.AC10.md), [golden-cmp.txt](evidence/_story/01M72FV748N29PT1NVJMXH8818/golden-cmp.txt)). The integration tier runs only in CI. It has not passed on this head yet: the last CI run failed in `machine-dir.test.ts`, a test-only fix has landed since, and that file passes locally. QA covered the slice-03 flows by hand.

## Merge danger

**Door:** two-way: a revert puts the code back. Worktrees created while this was merged stay in `~/.norn/repos/<id>/worktrees/`, and a reverted norn will not see them. Units started in that window would have to be recreated.

**Blast radius:** every user. From this version on, new unit worktrees go under `~/.norn`. A `<repo>-worktrees/` folder from an earlier version is ignored, not migrated (the person ruled out migration). Every machine-dir path is now built on the resolved home. For a symlinked home (such as `/tmp` on macOS or a dotfiles link), that changes how paths are spelled but not which folder they point to. Most of the diff is mechanical path churn in pinned outputs (golden cases, observe snapshots, e2e transcripts).
