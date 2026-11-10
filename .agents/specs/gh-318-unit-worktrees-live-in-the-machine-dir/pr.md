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

Because worktrees now sit inside the machine dir, wiping the machine dir removes them too. Two small changes keep that recoverable. Observe ignores a worktree whose folder is gone, and intake leaves a story whose branch is already on the remote to `story checkout`, even if a local branch is left behind.

## Evidence

QA ran from the user's side at head 2ab50a63. It drove real ticks through the cli harness in temp repos, with real git and a fake gh. All 16 criteria `pass`. The full table is in [report.md](evidence/_story/01M72KED0YCEMYHRQ6CKN1CP3F/report.md).

- **`sync` / `story start` create the story worktree in the machine dir**
  **Before:** `<repo>-worktrees/<story>-<slug>`
  **After:** `git worktree list` shows `…/home/repos/repo-<id>/worktrees/gh-2-split-work`, and the repo's only siblings are the harness's own folders ([03.AC1](evidence/_story/01M72KED0YCEMYHRQ6CKN1CP3F/03.AC1.md), [observe-output.md](evidence/_story/01M72KED0YCEMYHRQ6CKN1CP3F/observe-output.md)).
- **A slice worktree sits beside its story's**
  **Before:** `<repo>-worktrees/<story>-<slug>--<nn>-<slug>`
  **After:** `…/worktrees/gh-2-split-work--01-first` (on `gh-2/01-first`) sits next to `…/worktrees/gh-2-split-work` ([03.AC2](evidence/_story/01M72KED0YCEMYHRQ6CKN1CP3F/03.AC2.md)).
- **No `<repo>-worktrees/` folder from any command**
  **Before:** every repo norn ran in got one.
  **After:** harness cleanup throws if a `*-worktrees` folder sits beside the test repo, so every integration and e2e test checks this. QA planted `repo-worktrees` and saw cleanup throw ([03.AC3](evidence/_story/01M72KED0YCEMYHRQ6CKN1CP3F/03.AC3.md), [guard-output.md](evidence/_story/01M72KED0YCEMYHRQ6CKN1CP3F/guard-output.md)).
- **Worktrees follow a bound home, including a symlinked one**
  **Before:** always beside the repo, whatever the home.
  **After:** with a home given to the command, the worktree lands at `home-c/repos/repo-c-<id>/worktrees/gh-10-two-places`. With `NORN_HOME_DIR` pointing at a symlink, it lands under the resolved real home ([03.AC4](evidence/_story/01M72KED0YCEMYHRQ6CKN1CP3F/03.AC4.md), [observe3-output.md](evidence/_story/01M72KED0YCEMYHRQ6CKN1CP3F/observe3-output.md)).
- **Two clones never share a worktree folder**
  **Before:** each clone had its own sibling folder.
  **After:** both clones take in `gh-10`, and their worktrees land in `home/repos/repo-<id>/worktrees/` and `home-repo-b/repos/repo-b-<id>/worktrees/` ([03.AC5](evidence/_story/01M72KED0YCEMYHRQ6CKN1CP3F/03.AC5.md)).
- **`--print`, the inbox, the brief and the Herdr tab show the new path**
  **Before:** they showed the `<repo>-worktrees/` path.
  **After:** the inbox's `$ cd …` line, `story start --print` and the Herdr tab's cwd all use `…/worktrees/gh-7-add-login-form`, and `norn brief` run from there exits 0 ([03.AC6](evidence/_story/01M72KED0YCEMYHRQ6CKN1CP3F/03.AC6.md), [brief-gh7.md](evidence/_story/01M72KED0YCEMYHRQ6CKN1CP3F/brief-gh7.md)).
- **`norn tidy` cleans orphans at the new location**
  **Before:** it looked only in `<repo>-worktrees/`.
  **After:** `tidy` reports `worktrees/gh-97-gone` (clean) and `worktrees/gh-96-dirty` (uncommitted changes), and removes only the clean one. It finds an orphan under a symlinked home too ([03.AC7](evidence/_story/01M72KED0YCEMYHRQ6CKN1CP3F/03.AC7.md)).
- **`story start` notices a deleted worktree**
  **Before:** it checked the old folder.
  **After:** after the story worktree is removed, `norn story start gh-7` exits 0 and the worktree is back on its branch ([03.AC8](evidence/_story/01M72KED0YCEMYHRQ6CKN1CP3F/03.AC8.md)).
- **The view finds unit worktrees**
  **Before:** `scanWorktrees` read `<repo>-worktrees/`.
  **After:** `status --json` gives each unit's `reach.worktree` under `…/worktrees/`, and `story list` gives the story's root there ([03.AC9](evidence/_story/01M72KED0YCEMYHRQ6CKN1CP3F/03.AC9.md)).
- **The docs say where worktrees live**
  **Before:** they said worktrees sit beside the repo.
  **After:** the run-state paragraph and the glossary's worktree entry in `docs/concepts.md` name `<machine dir>/worktrees/`. `git grep -e '-worktrees'` finds nothing in docs, README or the shipped assets ([03.AC11](evidence/_story/01M72KED0YCEMYHRQ6CKN1CP3F/03.AC11.md), [greps.md](evidence/_story/01M72KED0YCEMYHRQ6CKN1CP3F/greps.md)).

The golden corpus (136 cases) is rewritten to the new paths. With the worktree prefix normalised, its decisions match base 3666341f exactly. At the prefactor commit, with the old folder as the fact, they matched too ([01.AC2](evidence/_story/01M72KED0YCEMYHRQ6CKN1CP3F/01.AC2.md), [03.AC10](evidence/_story/01M72KED0YCEMYHRQ6CKN1CP3F/03.AC10.md), [golden-cmp.txt](evidence/_story/01M72KED0YCEMYHRQ6CKN1CP3F/golden-cmp.txt)).

Recovery after a wiped machine dir is proven by a test, not by QA. `takeover-record-lost.test.ts` › "AC4: no ref: A's next tick no longer holds the claim…" now asserts that after the wipe, A's tick emits only a skipped `intake_story` and no worktree, and that `checkout --force` still restarts implement. Three e2e transcripts (recovery, base-sync, slice workflow) each lose only intake's local `show-ref` line.

Not shown yet: the integration and e2e tiers on CI at this head. Locally, e2e passes 76/76. The last CI run failed on the wiped-machine-dir case fixed above.

## Merge danger

**Door:** two-way: a revert puts the code back. Worktrees created while this was merged stay in `~/.norn/repos/<id>/worktrees/`, and a reverted norn won't see them, so units started in that window would have to be recreated.

**Blast radius:** every user. New unit worktrees go under `~/.norn`, so wiping `~/.norn` now takes uncommitted worktree changes with it. A `<repo>-worktrees/` folder from an earlier version is ignored, not migrated (the person ruled out migration). Machine-dir paths are now built on the resolved home. For a symlinked home (such as `/tmp` on macOS), that changes how paths are spelled but not which folder they point to. Most of the 372-file diff is mechanical path churn in pinned outputs (golden cases, observe snapshots, e2e transcripts).
