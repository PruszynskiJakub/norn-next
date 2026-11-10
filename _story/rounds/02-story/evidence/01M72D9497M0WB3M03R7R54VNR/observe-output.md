## setup: repo /private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/norn-cli-PpfPl1/repo home /private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/norn-cli-PpfPl1/home
## machine dir: /private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/norn-cli-PpfPl1/home/repos/repo-9ab17767
## AC1 git worktree list after intake ticks:
/private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/norn-cli-PpfPl1/repo                                               8c38474 [main]
/private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/norn-cli-PpfPl1/home/repos/repo-9ab17767/worktrees/gh-2-split-work 15c1cb5 [gh-2-split-work]
story wt exists: true branch: gh-2-split-work
siblings of repo: [
 "home",
 "seed",
 "repo",
 "remote.git"
]
## AC9/AC6 status --json reach/command for gh-2: [
 {
  "slice": null,
  "command": "norn run list gh-2",
  "reach": {
   "worktree": "/private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/norn-cli-PpfPl1/home/repos/repo-9ab17767/worktrees/gh-2-split-work",
   "agent_session_id": null,
   "pane_id": "p-1"
  }
 }
]
## AC6 story start --print (exit 3):
{"error":"gh-2 plan: nothing for a person to start — it is running","do_instead":"norn status","code":"nothing_to_open"}

## AC2 git worktree list after slice start:
/private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/norn-cli-PpfPl1/repo                                                         8c38474 [main]
/private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/norn-cli-PpfPl1/home/repos/repo-9ab17767/worktrees/gh-2-split-work           01e59ae [gh-2-split-work]
/private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/norn-cli-PpfPl1/home/repos/repo-9ab17767/worktrees/gh-2-split-work--01-first fc2953e [gh-2/01-first]
## AC9 status --json after slice start: [
 {
  "slice": null
 },
 {
  "slice": "gh-2/01",
  "reach": {
   "worktree": "/private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/norn-cli-PpfPl1/home/repos/repo-9ab17767/worktrees/gh-2-split-work--01-first",
   "agent_session_id": null,
   "pane_id": "p-2"
  }
 }
]
story list root: [
 {
  "key": "gh-2",
  "root": "/private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/norn-cli-PpfPl1/home/repos/repo-9ab17767/worktrees/gh-2-split-work"
 }
]
## AC8 deleted /private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/norn-cli-PpfPl1/home/repos/repo-9ab17767/worktrees/gh-2-split-work exists: false
story start exit 3 stdout:
{"error":"gh-2 slices: nothing for a person to start — it is ready","do_instead":"norn status","code":"nothing_to_open"}
undefined
after: exists true
## AC7 tidy --dry-run: {
 "dry_run": true,
 "would_remove": {
  "worktrees": [
   "/private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/norn-cli-PpfPl1/home/repos/repo-9ab17767/worktrees/gh-97-gone"
  ],
  "stale_worktree_records": [],
  "branches": [],
  "leases": [],
  "reserve_files": [],
  "rejected_receipts": [],
  "superseded": []
 },
 "trace": {
  "retain": "14d",
  "days": [],
  "hook_files": [],
  "runs": [],
  "bytes": 0
 },
 "kept": [
  {
   "item": "/private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/norn-cli-PpfPl1/home/repos/repo-9ab17767/worktrees/gh-96-dirty",
   "reason": "worktree has uncommitted changes"
  }
 ]
}
tidy: {
 "dry_run": false,
 "removed": {
  "worktrees": [
   "/private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/norn-cli-PpfPl1/home/repos/repo-9ab17767/worktrees/gh-97-gone"
  ],
  "stale_worktree_records": [],
  "branches": [],
  "leases": [],
  "reserve_files": [],
  "rejected_receipts": [],
  "superseded": []
 },
 "trace": {
  "retain": "14d",
  "days": [],
  "hook_files": [],
  "runs": [],
  "bytes": 0
 },
 "kept": [
  {
   "item": "/private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/norn-cli-PpfPl1/home/repos/repo-9ab17767/worktrees/gh-96-dirty",
   "reason": "worktree has uncommitted changes"
  }
 ]
}
clean exists false dirty exists true
## AC5 A: /private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/norn-cli-PpfPl1/home/repos/repo-9ab17767/worktrees/gh-10-two-places false
B: /private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/norn-cli-PpfPl1/home-repo-b/repos/repo-b-aeb6c3e7/worktrees/gh-10-two-places true
siblings of repo (AC3): [
 "home",
 "repo-b",
 "seed",
 "home-repo-b",
 "repo",
 "remote.git"
]
## AC4 tick with --home exit 2 
worktree list in repo-c:
/private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/norn-cli-PpfPl1/repo-c 8c38474 [main]