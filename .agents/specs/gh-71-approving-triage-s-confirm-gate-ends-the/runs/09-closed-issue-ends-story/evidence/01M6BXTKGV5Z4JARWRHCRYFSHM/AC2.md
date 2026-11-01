# AC2 (B22) — same effects as `norn story close`
- Integration test story-reopen.test.ts "AC2: sync with the issue closed …": pass (tests.txt, 26 pass).
- Observed with this branch's build in a throwaway repo (AC5-before.txt, AC5-sync.txt, AC5-after.txt; trace detail at top of AC3-cli.txt):
  result detail committed ["gh-8"], pushed ["gh-8-triage-me"] (new commit "norn: gh-8 dropped" on origin, spec.md `status: dropped`, round 01-tri `$done/done`),
  worktrees_removed, branches_deleted, leases_released ["slot-1.json"], claim_deleted (refs/norn/claims/gh-8 gone from origin), mailbox_deleted (refs/norn/inbox/gh-8/… gone local and remote).
  `norn status`: "Inbox empty"; two more ticks: no decisions, worktree stays gone.
