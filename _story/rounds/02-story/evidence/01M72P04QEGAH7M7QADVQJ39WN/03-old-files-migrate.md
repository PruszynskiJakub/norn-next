## 03.AC9 (a): valid config; slice+spec carry criteria needs; .gitattributes has a runs/** line; norn 0.31.0
$ norn upgrade --json
{"norn_version":{"from":"0.30.0","to":"0.31.0","changed":true},"skills":{"updated":["norn-qa"],"linked":[]},"staged":[".agents/skills/norn-qa",".agents/norn.config.yaml"],"commit":"git commit -m \"Upgrade norn to 0.31.0 (norn upgrade)\"","labels":{"checked":false,"reason":"no git remote","fix":null,"do_instead":null}}

exit=0  repo+machine-dir changed: YES

files (sha1) before vs after:
4c4
< 2b10081bb2bfc5a0817599a6a2a9751fb658ba38  .agents/norn.config.yaml
---
> 3966b3a5e819d7386db6591282d03743d6bc88c3  .agents/norn.config.yaml
staged:
.agents/norn.config.yaml
.agents/skills/norn-qa/SKILL.md
needs still in slice: 1

## 03.AC9 (b): the team file holds the old key default_mode
$ norn upgrade --json
{"error":"`.agents/norn.config.yaml`: `default_mode` is now `mode`","do_instead":"fix .agents/norn.config.yaml","code":"config_moved","details":[{"code":"config_moved","file":"repo","key":"default_mode","message":"`default_mode` is now `mode`","path":"/private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa6-gh317/o2/.agents/norn.config.yaml"}]}

exit=6  repo+machine-dir changed: no

  nothing changed
porcelain: ''
   2 `default_mode` is now `mode`
### validation message mentions 'norn upgrade'? → 0 matches; upgrade's own refusal: 0 matches

## 03.AC9 (c): the user config (machine home config.yaml) holds default_mode
$ norn upgrade --json
{"error":"`~/.norn/config.yaml`: `default_mode` is now `mode`","do_instead":"fix ~/.norn/config.yaml","code":"config_moved","details":[{"code":"config_moved","file":"user","key":"default_mode","message":"`default_mode` is now `mode`","path":"/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa6-gh317/home/config.yaml"}]}

exit=6  repo+machine-dir changed: no

  nothing changed
porcelain: ''

## 03.AC10: norn migrate
$ norn migrate
{"error":"Unknown command: migrate","do_instead":"norn help — commands: init, uninstall, sync, tick, watch, brief, done, ask, stuck, hook, check-run, status, tidy, doctor, upgrade, help, story, run, config","code":"unknown_command"}

exit=2  repo+machine-dir changed: no

$ norn migrate --json
{"error":"Unknown command: migrate","do_instead":"norn help — commands: init, uninstall, sync, tick, watch, brief, done, ask, stuck, hook, check-run, status, tidy, doctor, upgrade, help, story, run, config","code":"unknown_command"}

exit=2  repo+machine-dir changed: no

$ norn frobnicate --json
{"error":"Unknown command: frobnicate","do_instead":"norn help — commands: init, uninstall, sync, tick, watch, brief, done, ask, stuck, hook, check-run, status, tidy, doctor, upgrade, help, story, run, config","code":"unknown_command"}

exit=2  repo+machine-dir changed: no

$ norn help | grep -c migrate
0
$ norn help --json | grep -c migrate
0
