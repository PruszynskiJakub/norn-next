# AC8 — pass
Throwaway repo $TMPDIR/qa71/repo (bare origin, fake `gh` on PATH serving issue #12 labelled norn and assigned to me, HOME=$TMPDIR/qa71/home), default_workflow: triage (this repo's triage.yaml + skill), this branch's build.
`norn sync` (intake) → ticks → explore ready (manual) → in the worktree `norn brief`, `norn done story` → tick → confirm gate (AC8-before-approve.txt).
Then (AC8.txt): `norn story approve gh-12` → tick applies → state step $done, status done; ticks/sync emit `story.round_done`.
`norn status`:
    Your turn (1) · work only you can do
      gh-12      $done: gh-12: triage round done, no PR · 3s
          or close the issue
          $ norn story edit gh-12 --workflow <name>
`status --json`: your_turn has title "gh-12: triage round done, no PR", command "norn story edit gh-12 --workflow <name>", detail "or close the issue"; pending 1; recently_done empty.
Spec status still active, worktree kept, refs/norn/claims/gh-12 on origin.
