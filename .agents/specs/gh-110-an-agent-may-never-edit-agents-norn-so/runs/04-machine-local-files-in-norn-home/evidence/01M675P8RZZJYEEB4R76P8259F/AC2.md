# AC2: unit worktree uses main checkout's machine dir
- Test: machine-dir.test.ts AC2 (hook session-start, brief, tick from the unit worktree gh-4-four; checks no machine files in the worktree, hook event in main machine dir, same heartbeat id, only one repos/ entry) passes.
- By hand: `git worktree add ../app-wt; cd ../app-wt; norn tick` → home/repos still only app-f8c1edd7 (until the separate clone of AC3), heartbeat_id 01M675QBF4H2T8R7R865Q4DTDR unchanged with last_tick_at updated; app-wt/.agents/norn has only config.yaml+workflows; git status clean.
