$ norn config set agents.claude.model opus --repo
Set `agents.claude.model` to `opus` in the repo file (`.agents/norn/config.yaml`).
[exit 0]
$ norn config set limits.deadline 90m --repo
Set `limits.deadline` to `90m` in the repo file (`.agents/norn/config.yaml`).
[exit 0]
$ norn config set notifiers [{adapter: os}] --user
Set `notifiers` to `[{adapter: os}]` in the user file (`/private/tmp/claude-501/-Users-jakubpruszynski-Projects-norn-worktrees-gh-75-regroup-the-cli-around-status-story-and--13-config-list-get-set-unset/d994b8ef-932a-462d-adef-2c45a5be9f60/scratchpad/qa/home/config.yaml`).
[exit 0]
--- repo file:
default_mode: manual
agents:
  claude:
    adapter: claude
    args:
      - --permission-mode
      - auto
    model: opus
limits:
  deadline: 90m
--- user file:
default_mode: auto
notifiers:
  - adapter: os
get agents.claude.model:
[{"key":"agents.claude.model","value":"opus","source":"repo","group":"person","meaning":"a coding agent norn can brief or start"}]
get agents.claude:
[{"key":"agents.claude","value":{"adapter":"claude","args":["--permission-mode","auto"],"model":"opus"},"source":"repo","group":"person","meaning":"a coding agent norn can brief or start"}]
get limits.deadline:
[{"key":"limits.deadline","value":"90m","source":"repo","group":"team","meaning":"unattended step runs this long, then times out"}]
get notifiers:
[{"key":"notifiers","value":[{"adapter":"os"}],"source":"user","group":"machine","meaning":"how you are told about new inbox items"}]
## list replaced whole:
$ norn config set notifiers [{adapter: ntfy, topic: a}, {adapter: os}] --user
**Refused (invalid_value):** user: /notifiers/0 unknown property 'topic'

Do instead: norn config list
[exit 3]
$ norn config set notifiers [{adapter: os}] --user
`notifiers` is already `[{adapter: os}]` in the user file (`/private/tmp/claude-501/-Users-jakubpruszynski-Projects-norn-worktrees-gh-75-regroup-the-cli-around-status-story-and--13-config-list-get-set-unset/d994b8ef-932a-462d-adef-2c45a5be9f60/scratchpad/qa/home/config.yaml`); nothing changed.
[exit 0]
default_mode: auto
notifiers:
  - adapter: os
$ norn config set notifiers "[{adapter: ntfy}, {adapter: os}]" --user
Set `notifiers` to `[{adapter: ntfy}, {adapter: os}]` in the user file (`/private/tmp/claude-501/-Users-jakubpruszynski-Projects-norn-worktrees-gh-75-regroup-the-cli-around-status-story-and--13-config-list-get-set-unset/d994b8ef-932a-462d-adef-2c45a5be9f60/scratchpad/qa/home/config.yaml`).
[exit 0]
default_mode: auto
notifiers:
  - adapter: ntfy
  - adapter: os
$ norn config set notifiers "[{adapter: os}]" --user
Set `notifiers` to `[{adapter: os}]` in the user file (`/private/tmp/claude-501/-Users-jakubpruszynski-Projects-norn-worktrees-gh-75-regroup-the-cli-around-status-story-and--13-config-list-get-set-unset/d994b8ef-932a-462d-adef-2c45a5be9f60/scratchpad/qa/home/config.yaml`).
default_mode: auto
notifiers:
  - adapter: os
$ norn config set notifiers.0 x --user
**Refused (unknown_key):** no setting 'notifiers.0'

Do instead: norn config list
[exit 3]
