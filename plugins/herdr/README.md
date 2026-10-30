# norn's Herdr plugin

Install it once with `herdr plugin install PruszynskiJakub/norn-next/plugins/herdr`, or link a norn checkout with `herdr plugin link <checkout>/plugins/herdr` so it follows `git pull`.

What it gives you:

| Entry | What it does |
|---|---|
| action `norn.pick`, pane `pick` | the cockpit (`norn status --watch`) as a popup over the focused pane, on any workspace |
| action `norn.open` | the cockpit as a split below the focused pane (`norn status --watch --pane`) |
| action `norn.next` | focuses the agent pane of the oldest Your turn item (`norn run attach --next`) |

## The cockpit

`norn status --watch` lists what needs you (your turn, answer, approve, stuck, check), then one row per story with its step, slices done and PR. The right side previews the selected row's story: its slices, PR, what waits for you, what runs and its open notes. The footer lists the keys the selected row offers.

| Key | Does |
|---|---|
| ↑ ↓, j k, PgUp PgDn | move |
| / | filter: type words (every one must match), enter keeps the filter, esc clears it |
| enter | orient: focus the story's `<story> orient` workspace, or create it with an agent that summarizes the story and answers your questions |
| g | go to the agent's pane |
| s | start the agent of a manual step (`norn story start`) |
| a | answer the question: type it in the footer, enter sends, esc cancels |
| y, x | approve the gate, or reject it with what to change |
| u | unstick a stuck unit |
| t | take an unclaimed story |
| v | the unit's trace, in place of the preview (esc closes it) |
| o, i | open the PR, the issue, in the browser |
| r, ?, q | refresh, list the keys, quit |

Every action leaves the cockpit open with its outcome on the footer line. Each one is a norn command (`norn story approve`, `norn story answer`, …), the same you would type. Opened on a workspace outside any norn repository, the popup shows the repository the last cockpit ran in.

## Config snippet

Add to Herdr's `config.toml`, then run `herdr server reload-config`:

```toml
[ui]
# one line for the repo of the focused pane, e.g. `norn·todoist-app ● 1 approve ◐ 2 running`
tab_bar_right = [{ type = "command", command = "norn status --segment", interval_seconds = 10 }]

# each `<story> orient` workspace shows what its story needs (`● approve`, `◐ running`, `✓ done`)
[ui.sidebar.spaces]
rows = [["state_icon", "workspace"], ["$norn"]]

# the cockpit as a popup, on any workspace
[[keys.command]]
key = "prefix+p"
type = "plugin_action"
command = "norn.pick"

# the cockpit as a split below the focused pane
[[keys.command]]
key = "prefix+n"
type = "plugin_action"
command = "norn.open"
```

Herdr runs the tab bar command in the focused pane's directory, so the segment follows the repo you are looking at and prints an empty line outside one. While it runs inside Herdr it also writes the `$norn` sidebar token on each orient workspace of that repo and moves those workspaces, among themselves, so the ones that need you come first. Other workspaces never move.

The orient agent runs with `NORN_ORIENT=1`: its hooks record nothing, and `norn brief`, `done`, `ask` and `stuck` refuse it, so it can never start or end a step. It runs the norn that opened it.
