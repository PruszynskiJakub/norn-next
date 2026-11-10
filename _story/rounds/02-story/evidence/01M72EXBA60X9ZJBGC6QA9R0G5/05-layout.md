## 05.AC1 pre-0.13 repo (.agents/norn/config.yaml, workflows, trace only)
.agents/norn/trace/x.jsonl
.agents/norn/workflows/story.yaml
.agents/norn/config.yaml
$ norn tick --json
{"error":"this repo records no norn_version","do_instead":"run `norn init` if norn was never set up here; for a repo from an older norn, install norn 0.30.x, run `norn upgrade`, commit, then run `norn upgrade` again with norn 0.30.0","code":"version_missing","details":{"repo":null,"running":"0.30.0"}}

exit=3  repo+machine-dir changed: no

$ norn story start gh-1 --json
{"error":"this repo records no norn_version","do_instead":"run `norn init` if norn was never set up here; for a repo from an older norn, install norn 0.30.x, run `norn upgrade`, commit, then run `norn upgrade` again with norn 0.30.0","code":"version_missing","details":{"repo":null,"running":"0.30.0"}}

exit=3  repo+machine-dir changed: no

old files unchanged: yes
.agents/norn/trace/x.jsonl
.agents/norn/workflows/story.yaml
.agents/norn/config.yaml
## 05.AC2 agent hook fires in that repo
{}
exit=0
{}
exit=0
## 05.AC3 + 06.AC3 doctor (0.30.0 repo, and the pre-0.13 repo)
### /var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/gh317-qa/base
top keys: ok,live,hook_command,machine,git,agents,remote,labels,runner,skills,repo,warnings,hints
repo keys: ok,version,skills,workflows,config
markdown lines matching layout|migrate|run state|runs/: 0
json matching layout|migrate|run_state: 0
### /var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/gh317-qa/old013
top keys: ok,live,hook_command,machine,git,agents,remote,labels,runner,skills,repo,warnings,hints
repo keys: ok,version,skills,workflows,config
markdown lines matching layout|migrate|run state|runs/: 0
json matching layout|migrate|run_state: 0
