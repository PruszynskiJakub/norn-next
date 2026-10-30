$ norn config list
# Config

- user: `/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa13-home/config.yaml` (not created)
- repo: `.agents/norn/config.yaml`

The repo file overrides the user file, except machine caps, which it can only lower.

## This machine (usually in the user file)

| Setting | Value | From | What it does |
|---|---|---|---|
| `runner` | none | built-in | starts agents in auto mode; none: every story runs manual |
| `max_agents` | `2` | built-in | agents running at once on this machine, across repos |
| `max_checks` | `2` | built-in | checks running at once on this machine |
| `slots.min` | `1` | built-in | lowest port slot number |
| `slots.max` | `9` | built-in | highest port slot number |
| `slots.port_base` | `4000` | built-in | first port of slot 0 |
| `slots.ports_per_slot` | `10` | built-in | ports reserved per worktree |
| `notifiers` | `[{"adapter":"os"}]` | repo | how you are told about new inbox items |

## You (usually in the user file)

| Setting | Value | From | What it does |
|---|---|---|---|
| `agents.claude` | `{"adapter":"claude","args":["--permission-mode","auto"]}` | built-in | a coding agent norn can brief or start |
| `default_agent` | `claude` | built-in | agent for steps that do not name one |
| `default_mode` | `manual` | repo | who starts unattended steps of a story with no mode set: manual (you) or auto (the tick) |

## The team (usually in the repo file)

| Setting | Value | From | What it does |
|---|---|---|---|
| `remote.provider` | `gh` | built-in | where stories come from: gh or glab |
| `remote.label` | `norn` | built-in | issues assigned to you with this label become stories |
| `remote.git_remote` | `origin` | built-in | git remote to push and fetch |
| `remote.sync_interval` | `5m` | built-in | how often watch looks for new issues |
| `base_branch` | the remote's default branch | built-in | branch stories are cut from and PR'd into |
| `default_workflow` | `story` | built-in | workflow for a new story |
| `default_slice_workflow` | `slice` | built-in | workflow for a new slice |
| `watch_interval` | `30s` | built-in | time between ticks of norn watch |
| `claim.lease` | `10m` | built-in | a claim not renewed for this long is free to take |
| `claim.renew` | `3m` | built-in | how often the holder renews its claim |
| `limits.deadline` | `60m` | built-in | unattended step runs this long, then times out |
| `limits.nudges` | `2` | built-in | nudges into the same session before giving up |
| `limits.retries` | `2` | repo | fresh sessions after an agent died |
| `limits.stalled` | `15m` | built-in | no activity for this long counts as stalled |
| `limits.attended_wait` | `2m` | built-in | an attended run idle this long shows as Your turn |

## Notes

- `notifiers` is set by the repo for every machine; it usually belongs in ~/.norn/config.yaml.
- `agents.claude` passes `--permission-mode`: that is the agent's own permission mode, not norn's `default_mode`.
exit 0
$ norn config get default_mode
# Config

- user: `/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa13-home/config.yaml` (not created)
- repo: `.agents/norn/config.yaml`

The repo file overrides the user file, except machine caps, which it can only lower.

## You (usually in the user file)

| Setting | Value | From | What it does |
|---|---|---|---|
| `default_mode` | `manual` | repo | who starts unattended steps of a story with no mode set: manual (you) or auto (the tick) |
exit 0
## json dev vs released
get --json identical
list --json identical
get markdown identical
$ norn config default_mode (old form)
{"error":"Unknown command: config default_mode","do_instead":"norn help config — verbs: list, get, set, unset","code":"unknown_command"}
exit 2
$ norn config
norn config — Show the resolved config; set or unset one value in the user or repo file

  norn config list   Show the resolved config and which file set each value
  norn config get    Show one setting, or every setting under a key, and which file set it
  norn config set    Set one value in the user or repo config file
  norn config unset  Remove one value from the user or repo config file

`norn help config <verb>` shows one verb's usage and options.
exit 0
