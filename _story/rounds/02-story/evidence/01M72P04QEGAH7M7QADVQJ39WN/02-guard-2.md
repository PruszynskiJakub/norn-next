### 0.30.0 repo with norn 0.31.0: the usual mismatch rule, not the baseline
On branch main
nothing to commit, working tree clean
$ norn tick --json
{"error":"this repo needs norn 0.30.x (you run 0.31.0)","do_instead":"run `norn upgrade` to move this repo to norn 0.31.0 and commit the change, or install norn 0.30.x","code":"version_mismatch","details":{"repo":"0.30.0","running":"0.31.0"}}

exit=3  repo+machine-dir changed: no

## 02.AC4: no norn_version and a config that fails to load
$ norn tick --json
{"error":"`.agents/norn.config.yaml`: not valid YAML: Flow sequence in block collection must be sufficiently indented and end with a ] at line 23, column 1:","do_instead":"fix .agents/norn.config.yaml","code":"config_invalid","details":[{"code":"config_invalid","file":"repo","key":"","message":"not valid YAML: Flow sequence in block collection must be sufficiently indented and end with a ] at line 23, column 1:","path":"/private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa6-gh317/vbad/.agents/norn.config.yaml"}]}

exit=6  repo+machine-dir changed: no

## 02.AC5: commands the guard does not stop (0.29.4 and none)
### repo: 0.29.4
$ norn help | head -3
norn — deliver software stories with coding agents; code decides the next step, agents do it.

Agent doing a norn step? Run only `norn brief`, then report once with `norn done`, `norn ask` or `norn stuck`
exit=0

$ norn doctor --json
{"ok":false,"live":false,"hook_command":"\"${NORN_BIN:-norn}\" hook","machine":{"holder":"jakubpruszynski@mac","override":null},"git":{"ok":true,"version":"git version 2.54.0 (Apple Git-157)"},"agents":[{"name":"claude","adapter":"claude","tier":"blocking","ok":true,"binary":{"command":"claude","path":"/Users/jakubpruszynski/.local/bin/claude","version":"2.1.322 (Claude Code)"},"hooks_installed":true,"hook_fires":{"ok":true,"command":"\"${NORN_BIN:-norn}\" hook session-start --agent claude","exit":0,"recorded":1},"notes":[]}],"remote":{"ok":false,"provider":"gh","user":"PruszynskiJakub","git_remote":{"name":"origin","url":null},"error":"this repository has no git remote named origin","do_instead":"git remote add origin <url>"},"labels":{"checked":false,"reason":"no git remote","fix":null,"do_instead":null},"runner":{"ok":true,"configured":true,"required":false,"name":"herdr","available":true,"norn_on_path":{"ok":true,"expected":"/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa6-gh317/home/bin/norn","resolved":"/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa6-gh317/home/bin/norn"},"cockpit_plugin":{"linked":true,"enabled":true,"root":"/Users/jakubpruszynski/.config/herdr/plugins/github-installations/norn-2d93e9449bde/95167-0/checkout/plugins/herdr"}},"skills":{"ok":true,"dir":"/private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa6-gh317/g0.29.4/.agents/skills","missing":[],"drifted":[],"unlinked":{}},"repo":{"ok":false,"version":{"ok":false,"running":"0.30.0","repo":"0.29.4","match":null,"code":"version_too_old","error":"this repo records norn_version 0.29.4; this norn moves a repo from norn 0.30 on","do_instead":"install norn 0.30.x, run `norn upgrade`, commit, then run `norn upgrade` again with norn 0.30.0"},"skills":{"ok":true,"drifted":[]},"workflows":[{"name":"quick","file":".agents/workflows/quick.yaml","ok":true,"issues":[]},{"name":"refinement","file":".agents/workflows/refinement.yaml","ok":true,"issues":[]},{"name":"reproduce","file":".agents/workflows/reproduce.yaml","ok":true,"issues":[]},{"name":"slice","file":".agents/workflows/slice.yaml","ok":true,"issues":[]},{"name":"story","file":".agents/workflows/story.yaml","ok":true,"issues":[]},{"name":"triage","file":".agents/workflows/triage.yaml","ok":true,"issues":[]}],"config":{"ok":true,"file":".agents/norn.config.yaml","present":true,"errors":[]}},"warnings":["labels not checked: no git remote"],"hints":[]}
exit=1  repo+machine-dir changed: YES
doctor version check: ["ok","live","hook_command","machine","git","agents","remote","labels","runner","skills","repo","warnings","hints"]
$ norn init --json
{"error":"this repo records norn_version 0.29.4; this norn moves a repo from norn 0.30 on","do_instead":"install norn 0.30.x, run `norn upgrade`, commit, then run `norn upgrade` again with norn 0.30.0","code":"version_too_old","details":{"repo":"0.29.4","running":"0.30.0"}}

exit=3  repo+machine-dir changed: no

$ norn upgrade --json
{"error":"this repo records norn_version 0.29.4; this norn moves a repo from norn 0.30 on","do_instead":"install norn 0.30.x, run `norn upgrade`, commit, then run `norn upgrade` again with norn 0.30.0","code":"version_too_old","details":{"repo":"0.29.4","running":"0.30.0"}}

exit=3  repo+machine-dir changed: no

### repo: none
$ norn help | head -3
norn — deliver software stories with coding agents; code decides the next step, agents do it.

Agent doing a norn step? Run only `norn brief`, then report once with `norn done`, `norn ask` or `norn stuck`
exit=0

$ norn doctor --json
{"ok":false,"live":false,"hook_command":"\"${NORN_BIN:-norn}\" hook","machine":{"holder":"jakubpruszynski@mac","override":null},"git":{"ok":true,"version":"git version 2.54.0 (Apple Git-157)"},"agents":[{"name":"claude","adapter":"claude","tier":"blocking","ok":true,"binary":{"command":"claude","path":"/Users/jakubpruszynski/.local/bin/claude","version":"2.1.322 (Claude Code)"},"hooks_installed":true,"hook_fires":{"ok":true,"command":"\"${NORN_BIN:-norn}\" hook session-start --agent claude","exit":0,"recorded":1},"notes":[]}],"remote":{"ok":false,"provider":"gh","user":"PruszynskiJakub","git_remote":{"name":"origin","url":null},"error":"this repository has no git remote named origin","do_instead":"git remote add origin <url>"},"labels":{"checked":false,"reason":"no git remote","fix":null,"do_instead":null},"runner":{"ok":true,"configured":true,"required":false,"name":"herdr","available":true,"norn_on_path":{"ok":true,"expected":"/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa6-gh317/home/bin/norn","resolved":"/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa6-gh317/home/bin/norn"},"cockpit_plugin":{"linked":true,"enabled":true,"root":"/Users/jakubpruszynski/.config/herdr/plugins/github-installations/norn-2d93e9449bde/95167-0/checkout/plugins/herdr"}},"skills":{"ok":true,"dir":"/private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa6-gh317/gnone/.agents/skills","missing":[],"drifted":[],"unlinked":{}},"repo":{"ok":false,"version":{"ok":false,"running":"0.30.0","repo":null,"match":null,"code":"version_missing","error":"this repo records no norn_version","do_instead":"run `norn init` if norn was never set up here; for a repo from an older norn, install norn 0.30.x, run `norn upgrade`, commit, then run `norn upgrade` again with norn 0.30.0"},"skills":{"ok":true,"drifted":[]},"workflows":[{"name":"quick","file":".agents/workflows/quick.yaml","ok":true,"issues":[]},{"name":"refinement","file":".agents/workflows/refinement.yaml","ok":true,"issues":[]},{"name":"reproduce","file":".agents/workflows/reproduce.yaml","ok":true,"issues":[]},{"name":"slice","file":".agents/workflows/slice.yaml","ok":true,"issues":[]},{"name":"story","file":".agents/workflows/story.yaml","ok":true,"issues":[]},{"name":"triage","file":".agents/workflows/triage.yaml","ok":true,"issues":[]}],"config":{"ok":true,"file":".agents/norn.config.yaml","present":true,"errors":[]}},"warnings":["labels not checked: no git remote"],"hints":[]}
exit=1  repo+machine-dir changed: no
doctor version check: ["ok","live","hook_command","machine","git","agents","remote","labels","runner","skills","repo","warnings","hints"]
$ norn init --json
{"error":"this repo records no norn_version","do_instead":"run `norn init` if norn was never set up here; for a repo from an older norn, install norn 0.30.x, run `norn upgrade`, commit, then run `norn upgrade` again with norn 0.30.0","code":"version_missing","details":{"repo":null,"running":"0.30.0"}}

exit=3  repo+machine-dir changed: no

$ norn upgrade --json
{"error":"this repo records no norn_version","do_instead":"run `norn init` if norn was never set up here; for a repo from an older norn, install norn 0.30.x, run `norn upgrade`, commit, then run `norn upgrade` again with norn 0.30.0","code":"version_missing","details":{"repo":null,"running":"0.30.0"}}

exit=3  repo+machine-dir changed: no

## 02.AC6: status (0.29.4)
$ norn status
`norn status` now shows what needs you; the story listing moved to `norn story list`.
! this repo records norn_version 0.29.4; this norn moves a repo from norn 0.30 on: install norn 0.30.x, run `norn upgrade`, commit, then run `norn upgrade` again with norn 0.30.0
      $ norn doctor

exit=0  repo+machine-dir changed: YES

$ norn status --json
{"at":"2026-11-10T12:14:49.652Z","groups":{"your_turn":[],"answer":[],"approve":[],"unblock":[{"story":"*","slice":null,"step":null,"command":"norn doctor","since":"2026-11-10T12:14:49.652Z","id":"norn-version:0.29.4:0.30.0","group":"unblock","title":"this repo records norn_version 0.29.4; this norn moves a repo from norn 0.30 on: install norn 0.30.x, run `norn upgrade`, commit, then run `norn upgrade` again with norn 0.30.0","age":"0s"}],"check":[],"unclaimed":[],"running":[],"notes":[],"recently_done":[]},"pending":1,"delegated_counts":{},"heartbeat":{"holder":"jakubpruszynski@mac","last_tick_at":null,"age":null,"down":false,"up":false}}

exit=0  repo+machine-dir changed: no

### status (no version)
$ norn status
`norn status` now shows what needs you; the story listing moved to `norn story list`.
! this repo records no norn_version: run `norn init` if norn was never set up here; for a repo from an older norn, install norn 0.30.x, run `norn upgrade`, commit, then run `norn upgrade` again with norn 0.30.0
      $ norn doctor

exit=0  repo+machine-dir changed: YES

