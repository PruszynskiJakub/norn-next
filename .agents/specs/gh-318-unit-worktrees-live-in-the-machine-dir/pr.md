## Summary

Unit worktrees now go in the checkout's machine dir, next to its run state, so norn no longer adds a `<repo>-worktrees/` folder beside your repository. Store's `worktreesDir` is the only code that names the folder. The folder reaches decide as `Facts.repo.worktrees`, so core stays pure.

```
~/projects/
  norn-next/                         # your checkout; nothing of norn's sits beside it now
- norn-next-worktrees/               # gone
~/.norn/repos/norn-next-<hash>/      # the checkout's machine dir
  runs/                              # run state, as before
+ worktrees/
+   gh-318-<slug>                    # story worktree
+   gh-318-<slug>--03-<slug>         # slice worktree, beside its story's
```

## Evidence

QA ran at 2a61bb35, from the user's side: real ticks through the cli harness, with real git and a fake gh. All 16 criteria `pass`; the full table is in [report.md](evidence/_story/01M72D9497M0WB3M03R7R54VNR/report.md).

- **`norn sync` creates the story worktree in the machine dir**
  **Before:** `<repo>-worktrees/<story>-<slug>`
  **After:** `git worktree list` shows `…/home/repos/repo-9ab17767/worktrees/gh-2-split-work`, and the repo's folder has no `*-worktrees` sibling ([observe-output.md](evidence/_story/01M72D9497M0WB3M03R7R54VNR/observe-output.md), [03.AC1](evidence/_story/01M72D9497M0WB3M03R7R54VNR/03.AC1.md)).
- **A slice worktree sits beside its story's**
  **Before:** `<repo>-worktrees/<story>-<slug>--<nn>-<slug>`
  **After:** after a slice starts, `git worktree list` shows `…/worktrees/<story>-<slug>--<nn>-<slug>` ([03.AC2](evidence/_story/01M72D9497M0WB3M03R7R54VNR/03.AC2.md)).
- **No `<repo>-worktrees/` folder from any command**
  **Before:** every repo norn ran in got one.
  **After:** the harness cleanup throws if a `*-worktrees` folder exists beside the test repo, so every integration and e2e test checks this; e2e passed 74/74 with the check on ([03.AC3](evidence/_story/01M72D9497M0WB3M03R7R54VNR/03.AC3.md)).
- **Worktrees follow a bound home**
  **Before:** always beside the repo, whatever the home.
  **After:** with `NORN_HOME_DIR`, and with the home passed to the command, the worktree lands under that home's `repos/<id>/worktrees/` ([03.AC4](evidence/_story/01M72D9497M0WB3M03R7R54VNR/03.AC4.md)).
- **Two clones never share a worktree folder**
  **Before:** each clone used its own sibling folder.
  **After:** both clones run `gh-10`; the worktrees land in `repo-5b1acd67/worktrees/` and `repo-b-c0ffee9f/worktrees/`, two different paths ([03.AC5](evidence/_story/01M72D9497M0WB3M03R7R54VNR/03.AC5.md)).
- **`--print`, the inbox, the brief and Herdr tabs show the new path**
  **Before:** they showed the `<repo>-worktrees/` path.
  **After:** the inbox's `$ cd …/home/repos/repo-3268e406/worktrees/gh-7-add-login-form && claude …` line, the `story start --print` JSON, the Herdr tab's cwd and `status --json` reach all show the machine-dir path ([observe2-output.md](evidence/_story/01M72D9497M0WB3M03R7R54VNR/observe2-output.md), [03.AC6](evidence/_story/01M72D9497M0WB3M03R7R54VNR/03.AC6.md)).
- **`norn tidy` cleans orphans at the new location**
  **Before:** it looked only in `<repo>-worktrees/`.
  **After:** `tidy` reports `worktrees/gh-97-gone` (clean) and `worktrees/gh-96-dirty` (uncommitted changes), removes only the clean one, and keeps the dirty one ([03.AC7](evidence/_story/01M72D9497M0WB3M03R7R54VNR/03.AC7.md)).
- **`story start` notices a deleted worktree**
  **Before:** it checked the old folder.
  **After:** after `rm -rf` of the machine-dir worktree, `norn story start gh-7` exits 0 and the worktree is back on its branch ([03.AC8](evidence/_story/01M72D9497M0WB3M03R7R54VNR/03.AC8.md)).
- **The view finds unit worktrees**
  **Before:** `scanWorktrees` read `<repo>-worktrees/`.
  **After:** `status --json` gives each unit's `reach.worktree` under `…/worktrees/` ([03.AC9](evidence/_story/01M72D9497M0WB3M03R7R54VNR/03.AC9.md)).
- **The docs say where worktrees live**
  **Before:** they said worktrees sit beside the repo.
  **After:** the run-state paragraph and the glossary's worktree row in `docs/concepts.md` name `<machine dir>/worktrees/`. `git grep -e '-worktrees'` finds nothing in the docs or in `packages/*/src` ([03.AC11](evidence/_story/01M72D9497M0WB3M03R7R54VNR/03.AC11.md)).

The golden corpus (136 cases) is rewritten to the new paths. `bun run golden -- --update` changes 0 of 136. At the prefactor commit, decisions were byte-identical to base ([01.AC2](evidence/_story/01M72D9497M0WB3M03R7R54VNR/01.AC2.md), [03.AC10](evidence/_story/01M72D9497M0WB3M03R7R54VNR/03.AC10.md)). The integration tier only runs in CI and has not run on this branch yet; QA ran its slice-03 flows by hand.

## Merge danger

**Door:** two-way: a revert puts the code back. Worktrees created while this was merged stay in `~/.norn/repos/<id>/worktrees/`, and the reverted norn will not see them. Units started in that window would have to be recreated.

**Blast radius:** every user: from this version on, new unit worktrees appear under `~/.norn`. Any `<repo>-worktrees/` folder from an earlier version is ignored, not migrated (the person ruled out migration). Most of the diff is mechanical path churn in pinned outputs (golden cases, observe snapshots, three e2e transcripts).
