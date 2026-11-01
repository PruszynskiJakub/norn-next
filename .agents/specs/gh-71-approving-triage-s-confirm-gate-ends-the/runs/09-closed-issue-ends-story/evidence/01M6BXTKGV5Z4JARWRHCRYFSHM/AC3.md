# AC3 (B23) — reopen, then round 2
- Integration test "AC3: reopening the issue and `story reopen` …": pass.
- Observed at the CLI (AC3-cli.txt): issue reopened on fake gh; `norn story reopen gh-8` exit 0, reopened:true, unit at `$done/done`, worktree restored;
  after a tick `norn status` shows Your turn "tri round done, no PR"; `norn story edit gh-8 --workflow story` exit 0, round 2 → refine; rounds/02-story state round 2, workflow story, step refine; 01-tri still $done.
