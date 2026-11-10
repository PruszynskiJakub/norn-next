## no norn_version + config that fails to load
$ norn tick --json
{"error":"`.agents/norn.config.yaml`: not valid YAML: Flow sequence in block collection must be sufficiently indented and end with a ] at line 23, column 1:","do_instead":"fix .agents/norn.config.yaml","code":"config_invalid","details":[{"code":"config_invalid","file":"repo","key":"","message":"not valid YAML: Flow sequence in block collection must be sufficiently indented and end with a ] at line 23, column 1:","path":"/private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/gh317-qa/badcfg/.agents/norn.config.yaml"}]}

exit=6  repo+machine-dir changed: no

## repo norn_version=0.29.4: commands the guard lets through
$ norn help
norn — deliver software stories with coding agents; code decides the next step, agents do it.

Agent doing a norn step? Run only `norn brief`, then report once with `norn done`, `norn ask` or `norn stuck`
(the `norn` skill says how). Every other command is the person's: run one only when the perso
exit=0  repo+machine-dir changed: no

$ norn doctor --json
{"ok":false,"live":false,"hook_command":"norn hook","machine":{"holder":"tester@box","override":"box"},"git":{"ok":true,"version":"git version 2.54.0 (Apple Git-157)"},"agents":[{"name":"claude","adapter":"claude","tier":"blocking","ok":true,"binary":{"command":"claude","path":"/Users/jakubpruszynski/.local/bin/claude","version":"2.1.322 (Claude Code)"},"hooks_installed":true,"hook_fires":{"ok":true,"command":"norn hook session-start --agent claude","exit":0,"recorded":1},"notes":[]}],"remote":{"ok":false,"provider":"gh","user":"PruszynskiJakub","git_remote":{"name":"origin","url":null},"error
exit=1  repo+machine-dir changed: YES

$ norn upgrade --json
{"error":"this repo records norn_version 0.29.4; this norn moves a repo from norn 0.30 on","do_instead":"install norn 0.30.x, run `norn upgrade`, commit, then run `norn upgrade` again with norn 0.30.0","code":"version_too_old","details":{"repo":"0.29.4","running":"0.30.0"}}

exit=3  repo+machine-dir changed: no

$ norn init --json
{"error":"this repo records norn_version 0.29.4; this norn moves a repo from norn 0.30 on","do_instead":"install norn 0.30.x, run `norn upgrade`, commit, then run `norn upgrade` again with norn 0.30.0","code":"version_too_old","details":{"repo":"0.29.4","running":"0.30.0"}}

exit=3  repo+machine-dir changed: no

### watch (5s, then killed)
{"error":"this repo records norn_version 0.29.4; this norn moves a repo from norn 0.30 on","do_instead":"install norn 0.30.x, run `norn upgrade`, commit, then run `norn upgrade` again with norn 0.30.0","code":"version_too_old","details":{"repo":"0.29.4","running":"0.30.0"}}

## repo norn_version=none: commands the guard lets through
$ norn help
norn — deliver software stories with coding agents; code decides the next step, agents do it.

Agent doing a norn step? Run only `norn brief`, then report once with `norn done`, `norn ask` or `norn stuck`
(the `norn` skill says how). Every other command is the person's: run one only when the perso
exit=0  repo+machine-dir changed: no

$ norn doctor --json
{"ok":false,"live":false,"hook_command":"norn hook","machine":{"holder":"tester@box","override":"box"},"git":{"ok":true,"version":"git version 2.54.0 (Apple Git-157)"},"agents":[{"name":"claude","adapter":"claude","tier":"blocking","ok":true,"binary":{"command":"claude","path":"/Users/jakubpruszynski/.local/bin/claude","version":"2.1.322 (Claude Code)"},"hooks_installed":true,"hook_fires":{"ok":true,"command":"norn hook session-start --agent claude","exit":0,"recorded":1},"notes":[]}],"remote":{"ok":false,"provider":"gh","user":"PruszynskiJakub","git_remote":{"name":"origin","url":null},"error
exit=1  repo+machine-dir changed: no

$ norn upgrade --json
{"error":"this repo records no norn_version","do_instead":"run `norn init` if norn was never set up here; for a repo from an older norn, install norn 0.30.x, run `norn upgrade`, commit, then run `norn upgrade` again with norn 0.30.0","code":"version_missing","details":{"repo":null,"running":"0.30.0"}}

exit=3  repo+machine-dir changed: no

$ norn init --json
{"error":"this repo records no norn_version","do_instead":"run `norn init` if norn was never set up here; for a repo from an older norn, install norn 0.30.x, run `norn upgrade`, commit, then run `norn upgrade` again with norn 0.30.0","code":"version_missing","details":{"repo":null,"running":"0.30.0"}}

exit=3  repo+machine-dir changed: no

### watch (5s, then killed)
{"error":"this repo records no norn_version","do_instead":"run `norn init` if norn was never set up here; for a repo from an older norn, install norn 0.30.x, run `norn upgrade`, commit, then run `norn upgrade` again with norn 0.30.0","code":"version_missing","details":{"repo":null,"running":"0.30.0"}}

