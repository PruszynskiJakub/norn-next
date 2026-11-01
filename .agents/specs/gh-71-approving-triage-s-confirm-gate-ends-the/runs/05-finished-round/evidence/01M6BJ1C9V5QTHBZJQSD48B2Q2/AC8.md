# AC8 — pass
Throwaway repo $TMPDIR/qa71b/repo: bare origin, fake `gh` on PATH serving issue #12 (labelled norn, assigned to me), HOME=$TMPDIR/qa71b/home, default_workflow: triage (this repo's triage.yaml and skill), run with this branch's build (`bun packages/cli/src/main.ts`).
`norn sync` (intake) → ticks → explore ready (manual) → in the worktree `norn brief`, `norn done story` → tick → confirm gate (AC8-before-approve.txt).
`norn story approve gh-12` → tick applies → $done/done → ticks and sync: story.round_done. `norn status`:
    Your turn (1) · work only you can do
      gh-12      $done: gh-12: triage round done, no PR · 3s
          or close the issue
          $ norn story edit gh-12 --workflow <name>
`status --json`: your_turn holds it, pending 1, recently_done empty. AC8.txt.
