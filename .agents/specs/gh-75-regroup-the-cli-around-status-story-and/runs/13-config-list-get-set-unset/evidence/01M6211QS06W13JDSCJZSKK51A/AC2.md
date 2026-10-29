$ norn config set default_mode auto --user
Set `default_mode` to `auto` in the user file (`/private/tmp/claude-501/-Users-jakubpruszynski-Projects-norn-worktrees-gh-75-regroup-the-cli-around-status-story-and--13-config-list-get-set-unset/d994b8ef-932a-462d-adef-2c45a5be9f60/scratchpad/qa/home/config.yaml`).
[exit 0]
--- user file:
default_mode: auto
$ norn config get default_mode --json
{"files":{"user":{"path":"/private/tmp/claude-501/-Users-jakubpruszynski-Projects-norn-worktrees-gh-75-regroup-the-cli-around-status-story-and--13-config-list-get-set-unset/d994b8ef-932a-462d-adef-2c45a5be9f60/scratchpad/qa/home/config.yaml","exists":true},"repo":{"path":"/private/tmp/claude-501/-Users-jakubpruszynski-Projects-norn-worktrees-gh-75-regroup-the-cli-around-status-story-and--13-config-list-get-set-unset/d994b8ef-932a-462d-adef-2c45a5be9f60/scratchpad/qa/repo/.agents/norn/config.yaml","exists":true}},"entries":[{"key":"default_mode","value":"manual","source":"repo","group":"person","meaning":"who starts unattended steps of a story with no mode set: manual (you) or auto (the tick)"}],"notes":[]}
[exit 0]
(repo2: no repo config; user file holds default_mode: auto from previous step)
default_mode: auto
get default_mode:
[{"key":"default_mode","value":"auto","source":"user","group":"person","meaning":"who starts unattended steps of a story with no mode set: manual (you) or auto (the tick)"}]
$ norn config set default_mode manual --repo
Set `default_mode` to `manual` in the repo file (`.agents/norn/config.yaml`).
[exit 0]
--- repo file:
default_mode: manual
get:
[{"key":"default_mode","value":"manual","source":"repo","group":"person","meaning":"who starts unattended steps of a story with no mode set: manual (you) or auto (the tick)"}]
