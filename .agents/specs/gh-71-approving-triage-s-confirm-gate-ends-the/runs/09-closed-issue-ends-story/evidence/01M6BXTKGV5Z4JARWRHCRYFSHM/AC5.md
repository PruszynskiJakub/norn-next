# AC5 (B22) — throwaway repo, scripted remote, this branch's build
Setup: bare origin + clone under $TMPDIR, NORN_HOME_DIR and HOME isolated, a scripted `gh` on PATH (bun script, state in gh.json; supports api user, issue list/view/edit, pr list → [], repo view).
CLI = `bun packages/cli/src/main.ts` from this worktree. Workflow `tri` stands in for triage: check `true` → confirm gate → $done (a real triage agent step needs an agent session; the gate gives the same finished round with no PR).
Steps: init, issue #8 (label norn, assigned) → ticks: intake, start, check, gate; `norn story approve gh-8` → round done, status "Your turn: tri round done, no PR" (AC5-before.txt).
Mailbox ref refs/norn/inbox/gh-8/01JAAA… pushed to origin. Issue set closed in gh.json. `norn sync` → exit 0, decision `remote.issue_closed close_story ok:true` (AC5-sync.txt).
After (AC5-after.txt): `norn status` "Inbox empty"; `norn story list` "No stories"; origin has refs/heads/gh-8-triage-me at a new commit "norn: gh-8 dropped" holding spec.md `status: dropped` and rounds/01-tri/state.json step $done status done; claim and mailbox refs gone from origin; no local branch/worktree/lease.
