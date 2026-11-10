## Summary

Unit worktrees now live in the checkout's machine dir, next to its run state. norn no longer creates a `<repo>-worktrees/` folder beside your repository. Store's `worktreesDir` is the only code that names the folder, and it reaches decide as `Facts.repo.worktrees`, so core stays pure. The machine dir is built on the resolved norn home, so worktree paths are spelled the way `git worktree list` spells them, even when the home is a symlink.

```diff
 ~/projects/
   norn-next/                         # your checkout; norn puts nothing beside it now
-  norn-next-worktrees/               # gone
 ~/.norn/repos/norn-next-<hash>/      # the checkout's machine dir (home resolved)
   runs/                              # run state, as before
+  worktrees/
+    gh-318-<slug>                    # story worktree
+    gh-318-<slug>--03-<slug>         # slice worktree, beside its story's
```

## Evidence

QA ran from the user's side at the current head (c892491c, after main 3666341f was merged in). It drove real ticks through the cli harness in temp repos, with real git and a fake gh. All 16 criteria `pass`. The full table is in [report.md](evidence/_story/01M72HNM90W87PFC8WR4VJPDGK/report.md).

- **`sync` / `story start` create the story worktree in the machine dir**
  **Before:** `<repo>-worktrees/<story>-<slug>`
  **After:** `git worktree list` shows `<home>/repos/repo-<id>/worktrees/gh-2-split-work`, and the repo's only siblings are the harness's own folders ([03.AC1](evidence/_story/01M72HNM90W87PFC8WR4VJPDGK/03.AC1.md), [observe-output.md](evidence/_story/01M72HNM90W87PFC8WR4VJPDGK/observe-output.md)).
- **A slice worktree sits beside its story's**
  **Before:** `<repo>-worktrees/<story>-<slug>--<nn>-<slug>`
  **After:** `…/worktrees/gh-2-split-work--01-first` (on `gh-2/01-first`) sits next to `…/worktrees/gh-2-split-work` ([03.AC2](evidence/_story/01M72HNM90W87PFC8WR4VJPDGK/03.AC2.md)).
- **No `<repo>-worktrees/` folder from any command**
  **Before:** every repo norn ran in got one.
  **After:** harness cleanup throws if a `*-worktrees` folder exists beside the test repo, so every integration and e2e test checks this. QA planted `repo-worktrees` and saw cleanup throw and still remove the dir ([03.AC3](evidence/_story/01M72HNM90W87PFC8WR4VJPDGK/03.AC3.md), [guard-output.md](evidence/_story/01M72HNM90W87PFC8WR4VJPDGK/guard-output.md)).
- **Worktrees follow a bound home, including a symlinked one**
  **Before:** always beside the repo, whatever the home.
  **After:** with a home given to the command, the worktree lands at `home-c/repos/repo-c-<id>/worktrees/gh-10-two-places`. With `NORN_HOME_DIR` pointing at a symlink, it lands under the resolved `real-home/repos/<id>/worktrees/` ([03.AC4](evidence/_story/01M72HNM90W87PFC8WR4VJPDGK/03.AC4.md), [observe3-output.md](evidence/_story/01M72HNM90W87PFC8WR4VJPDGK/observe3-output.md)).
- **Two clones never share a worktree folder**
  **Before:** each clone had its own sibling folder.
  **After:** both clones take in `gh-10`, and their worktrees land in `home/repos/repo-<id>/worktrees/` and `home-repo-b/repos/repo-b-<id>/worktrees/` ([03.AC5](evidence/_story/01M72HNM90W87PFC8WR4VJPDGK/03.AC5.md)).
- **`--print`, the inbox, the brief and the Herdr tab show the new path**
  **Before:** they showed the `<repo>-worktrees/` path.
  **After:** the inbox's `$ cd …` line, `story start --print` and the Herdr tab's cwd all use `…/worktrees/gh-7-add-login-form`, and `norn brief` run from there exits 0 ([03.AC6](evidence/_story/01M72HNM90W87PFC8WR4VJPDGK/03.AC6.md)).
- **`norn tidy` cleans orphans at the new location**
  **Before:** it looked only in `<repo>-worktrees/`.
  **After:** `tidy` reports `worktrees/gh-97-gone` (clean) and `worktrees/gh-96-dirty` (uncommitted changes), and removes only the clean one. It finds an orphan under a symlinked home too ([03.AC7](evidence/_story/01M72HNM90W87PFC8WR4VJPDGK/03.AC7.md)).
- **`story start` notices a deleted worktree**
  **Before:** it checked the old folder.
  **After:** after the story worktree is removed, `norn story start gh-7` exits 0 and the worktree is back on its branch ([03.AC8](evidence/_story/01M72HNM90W87PFC8WR4VJPDGK/03.AC8.md)).
- **The view finds unit worktrees**
  **Before:** `scanWorktrees` read `<repo>-worktrees/`.
  **After:** `status --json` gives each unit's `reach.worktree` under `…/worktrees/`, and `story list` gives the story's root there ([03.AC9](evidence/_story/01M72HNM90W87PFC8WR4VJPDGK/03.AC9.md)).
- **The docs say where worktrees live**
  **Before:** they said worktrees sit beside the repo.
  **After:** the run-state paragraph and the glossary's worktree entry in `docs/concepts.md` name `<machine dir>/worktrees/`. `git grep -e '-worktrees'` finds nothing in docs, README, AGENTS.md or the shipped assets ([03.AC11](evidence/_story/01M72HNM90W87PFC8WR4VJPDGK/03.AC11.md), [greps.md](evidence/_story/01M72HNM90W87PFC8WR4VJPDGK/greps.md)).

The golden corpus (136 cases) is rewritten to the new paths. With the worktree prefix normalised, its decisions are identical to base 3666341f. At the prefactor commit, with the old folder as the fact, they were identical too ([01.AC2](evidence/_story/01M72HNM90W87PFC8WR4VJPDGK/01.AC2.md), [03.AC10](evidence/_story/01M72HNM90W87PFC8WR4VJPDGK/03.AC10.md), [golden-cmp.txt](evidence/_story/01M72HNM90W87PFC8WR4VJPDGK/golden-cmp.txt)).

Not shown yet: the full integration tier on CI at this head. The integration tier runs only in CI. The last completed CI run failed only on a known flake also seen on other branches: `rmSync` threw `EFAULT` while cleaning up a harness temp dir after the test passed. Harness cleanup now retries and then falls back to `rm -rf`. The flake can't be reproduced locally, so check the CI run on this head.

## Merge danger

**Door:** two-way: a revert puts the code back. Worktrees created while this was merged stay in `~/.norn/repos/<id>/worktrees/`, and a reverted norn won't see them, so units started in that window would have to be recreated.

**Blast radius:** every user. New unit worktrees go under `~/.norn`. A `<repo>-worktrees/` folder from an earlier version is ignored, not migrated (the person ruled out migration). Machine-dir paths are now built on the resolved home. For a symlinked home (such as `/tmp` on macOS), that changes how paths are spelled but not which folder they point to. Most of the 371-file diff is mechanical path churn in pinned outputs (golden cases, observe snapshots, e2e transcripts).
