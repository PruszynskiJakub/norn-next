## 03.AC1 relink: a removed agent skill link is relinked
$ norn upgrade --json
{"norn_version":{"from":"0.30.0","to":"0.31.0","changed":true},"skills":{"updated":["norn-qa"],"linked":["norn-pr"]},"staged":[".agents/skills/norn-qa",".claude/skills/norn-pr",".agents/norn.config.yaml"],"commit":"git commit -m \"Upgrade norn to 0.31.0 (norn upgrade)\"","labels":{"checked":false,"reason":"no git remote","fix":null,"do_instead":null}}

exit=0  repo+machine-dir changed: YES

lrwxr-xr-x@ 1 jakubpruszynski  staff  28 Nov 10 11:12 .claude/skills/norn-pr -> ../../.agents/skills/norn-pr
## 03.AC5 backward: repo 0.31.0, norn 0.30.0
$ norn upgrade --json
{"error":"this repo is set up for norn 0.31.0; upgrade will not move it back","do_instead":"install norn 0.31.x","code":"version_backward","details":{"repo":"0.31.0","running":"0.30.0"}}

exit=3  repo+machine-dir changed: no

## 03.AC5 not main checkout: a linked worktree
$ norn upgrade --json
{"error":"/private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/gh317-qa/up5-wt is not the main checkout; norn upgrade moves the main checkout only, so the move never lands in a story's branch","do_instead":"cd /private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/gh317-qa/up5 && norn upgrade","code":"not_main_checkout","details":{"main_checkout":"/private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/gh317-qa/up5"}}

exit=3  repo+machine-dir changed: no

## 03.AC5 tick lock held
{"ok":true,"path":"/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/gh317-qa/home/repos/up5-b24dc2db/tick.lock","content":{"holder":{"pid":87247,"pid_start":"Tue Nov 10 11:12:49 2026"},"acquired_at":"
$ norn upgrade --json
{"error":"a tick is running (pid 87247); norn upgrade never rewrites the repo under a running tick","do_instead":"stop `norn watch` and run it again","code":"tick_locked"}

exit=3  repo+machine-dir changed: no

## 03.AC9: old key, criteria needs, .gitattributes runs/**
/private/tmp/claude-501/-Users-jakubpruszynski-Projects-norn-worktrees-gh-317-simplify-norn-upgrade-assume-every-repo/527dee8e-973f-4907-9cdc-011c713f87ac/scratchpad/mk.sh: line 2: 87247 Terminated: 15          NORN_HOME_DIR=${TMPDIR}gh317-qa/home bun $E/hold.ts $E/up5
$ norn upgrade --json
{"error":"`.agents/norn.config.yaml`: `default_mode` is now `mode`","do_instead":"fix .agents/norn.config.yaml","code":"config_moved","details":[{"code":"config_moved","file":"repo","key":"default_mode","message":"`default_mode` is now `mode`","path":"/private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/gh317-qa/up6/.agents/norn.config.yaml"}]}

exit=6  repo+machine-dir changed: no

staged:
files unchanged: yes
### config validation on the old key
$ norn config validate --json
{"error":"Unknown command: config validate","do_instead":"norn help config — verbs: list, get, set, unset","code":"unknown_command"}

exit=2  repo+machine-dir changed: no

                      → run `norn upgrade` and commit (git diff .agents/skills/ shows the change)
                      → run `norn upgrade` to move this repo to norn 0.31.0 and commit the change, or install norn 0.30.x
                      ! default_mode: `default_mode` is now `mode`
## 03.AC10
$ norn migrate
{"error":"Unknown command: migrate","do_instead":"norn help — commands: init, uninstall, sync, tick, watch, brief, done, ask, stuck, hook, check-run, status, tidy, doctor, upgrade, help, story, run, config","code":"unknown_command"}

exit=2  repo+machine-dir changed: no

$ norn migrate --json
{"error":"Unknown command: migrate","do_instead":"norn help — commands: init, uninstall, sync, tick, watch, brief, done, ask, stuck, hook, check-run, status, tidy, doctor, upgrade, help, story, run, config","code":"unknown_command"}

exit=2  repo+machine-dir changed: no

help mentions migrate: 0
