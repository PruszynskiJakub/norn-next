# AC5 (B36): old flat record on the base reads as round 1, nothing written — pass

Sandbox: gh-12 (flat, from released norn) merged into main and pushed. In clone2 (no worktree, no claim
for gh-12), after pulling main (flat runs/_story/{handoff.md,state.json,workflow.yaml}):
  `run list gh-12` → "gh-12 · Flat twelve · ready at implement", implement#1 (in step)
  `run view gh-12` → "gh-12 · implement#1 (agent)" …
  `run list gh-12 --json` reads it as one unit with its step timeline.
Afterwards: `git status --short --untracked-files=all` empty, HEAD unchanged, runs/_story still flat.
In checkout 1, main's HEAD unchanged after dev ticks; main's copy stays flat.
Integration test "AC5: run list and run view read it as its one round; nothing is written…" passes (view fixture gh-1).
Note: decide's "merged" guard is the PR's merged state (D7). My hand merge had no PR, so the holder's tick
migrated the story BRANCH (not main). This is correct per D7.
