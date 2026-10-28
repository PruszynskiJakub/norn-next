$ norn config list
# Config

- user: `/private/tmp/claude-501/-Users-jakubpruszynski-Projects-norn-worktrees-gh-75-regroup-the-cli-around-status-story-and--13-config-list-get-set-unset/d994b8ef-932a-462d-adef-2c45a5be9f60/scratchpad/qa/home/config.yaml` (not created)
- repo: `.agents/norn/config.yaml`

The repo file overrides the user file, except machine caps, which it can only lower.

## This machine (usually in the user file)

| Setting | Value | From | What it does |
|---|---|---|---|
| `runner` | none | built-in | starts agents in auto mode; none: every story runs manual |
| `max_agents` | `2` | built-in | agents running at once on this machine, across repos |
| `max_checks` | `2` | built-in | checks running at once on this machine |
| `slots.min` | `1` | built-in | lowest port slot number |
| `slots.max` | `3` | repo | highest port slot number |
| `slots.port_base` | `4000` | built-in | first port of slot 0 |
| `slots.ports_per_slot` | `10` | built-in | ports reserved per worktree |
| `notifiers` | `[{"adapter":"os"}]` | built-in | how you are told about new inbox items |

## You (usually in the user file)

| Setting | Value | From | What it does |
|---|---|---|---|
| `agents.claude` | `{"adapter":"claude","args":["--permission-mode","auto"]}` | built-in | a coding agent norn can brief or start |
| `default_agent` | `claude` | built-in | agent for steps that do not name one |
| `default_mode` | `manual` | repo | who starts unattended steps of a story with no mode set: manual (you) or auto (the tick) |

## The team (usually in the repo file)
$ norn config get default_mode
# Config

- user: `/private/tmp/claude-501/-Users-jakubpruszynski-Projects-norn-worktrees-gh-75-regroup-the-cli-around-status-story-and--13-config-list-get-set-unset/d994b8ef-932a-462d-adef-2c45a5be9f60/scratchpad/qa/home/config.yaml` (not created)
- repo: `.agents/norn/config.yaml`

The repo file overrides the user file, except machine caps, which it can only lower.

## You (usually in the user file)

| Setting | Value | From | What it does |
|---|---|---|---|
| `default_mode` | `manual` | repo | who starts unattended steps of a story with no mode set: manual (you) or auto (the tick) |
[exit 0]
$ norn config get default_mode --json
{"files":{"user":{"path":"/private/tmp/claude-501/-Users-jakubpruszynski-Projects-norn-worktrees-gh-75-regroup-the-cli-around-status-story-and--13-config-list-get-set-unset/d994b8ef-932a-462d-adef-2c45a5be9f60/scratchpad/qa/home/config.yaml","exists":false},"repo":{"path":"/private/tmp/claude-501/-Users-jakubpruszynski-Projects-norn-worktrees-gh-75-regroup-the-cli-around-status-story-and--13-config-list-get-set-unset/d994b8ef-932a-462d-adef-2c45a5be9f60/scratchpad/qa/repo/.agents/norn/config.yaml","exists":true}},"entries":[{"key":"default_mode","value":"manual","source":"repo","group":"person","meaning":"who starts unattended steps of a story with no mode set: manual (you) or auto (the tick)"}],"notes":[]}
[exit 0]
$ norn config default_mode --json
{"error":"Unknown command: config default_mode","do_instead":"norn help config — verbs: list, get, set, unset","code":"unknown_command"}
[exit 2]

## released norn (baseline) for comparison
$ norn config default_mode --json (released)
{"files":{"user":{"path":"/private/tmp/claude-501/-Users-jakubpruszynski-Projects-norn-worktrees-gh-75-regroup-the-cli-around-status-story-and--13-config-list-get-set-unset/d994b8ef-932a-462d-adef-2c45a5be9f60/scratchpad/qa/home/config.yaml","exists":false},"repo":{"path":"/private/tmp/claude-501/-Users-jakubpruszynski-Projects-norn-worktrees-gh-75-regroup-the-cli-around-status-story-and--13-config-list-get-set-unset/d994b8ef-932a-462d-adef-2c45a5be9f60/scratchpad/qa/repo/.agents/norn/config.yaml","exists":true}},"entries":[{"key":"default_mode","value":"manual","source":"repo","group":"person","meaning":"who starts unattended steps of a story with no mode set: manual (you) or auto (the tick)"}],"notes":[]}
[exit 0]
list --json identical to released 'config --json'
