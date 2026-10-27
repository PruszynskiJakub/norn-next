# norn's Herdr plugin

Install it once with `herdr plugin install PruszynskiJakub/norn-next/plugins/herdr`, or link a norn checkout with `herdr plugin link <checkout>/plugins/herdr` so it follows `git pull`.

What it gives you:

| Entry | What it does |
|---|---|
| pane `cockpit`, action `norn.open` | `norn pane --interactive` below the focused pane: the numbered inbox, one command per line |
| action `norn.next` | focuses the agent pane of the oldest Your turn item (`norn pane --next`) |
| pane `pick`, action `norn.pick` | `norn pick` as a popup: what needs you, then every story; type to filter |

## The picker

`norn pick` lists the inbox items that need you (your turn, answer, approve, stuck, check), then one row per story with its slices done, step and PR. The right side previews the story.

| Key | Does |
|---|---|
| type, ⌫, ⌃u | filter the rows (every word must match), delete a character, clear |
| ↑ ↓ (⌃p ⌃n) | move |
| enter | `norn orient <story> --open`: focus the story's `<story> orient` workspace, or create it with an agent that summarizes the story and answers your questions |
| ⌃o | open the story PR in the browser (`gh pr view <branch> --web`, or `glab mr view` on GitLab) |
| ⌃y | approve the gate on the row (`norn approve`) |
| ⌃g | go to the row's agent pane |
| ⌃t | take an unclaimed story (`norn take`) |
| ⌃r | refresh |
| esc | close |

Enter, ⌃o and ⌃g close the popup; approve and take stay, so you can do the next one.

## Config snippet

Add to Herdr's `config.toml`, then run `herdr server reload-config`:

```toml
[ui]
# one line for the repo of the focused pane, e.g. `norn·todoist-app ● 1 approve ◐ 2 running`
tab_bar_right = [{ type = "command", command = "norn status --segment", interval_seconds = 10 }]

# each `<story> orient` workspace shows what its story needs (`● approve`, `◐ running`, `✓ done`)
[ui.sidebar.spaces]
rows = [["state_icon", "workspace"], ["$norn"]]

[[keys.command]]
key = "prefix+p"
type = "plugin_action"
command = "norn.pick"

[[keys.command]]
key = "prefix+n"
type = "plugin_action"
command = "norn.open"
```

Herdr runs the tab bar command in the focused pane's directory, so the segment follows the repo you are looking at and prints an empty line outside one. While it runs inside Herdr it also writes the `$norn` sidebar token on each orient workspace of that repo and moves those workspaces, among themselves, so the ones that need you come first. Other workspaces never move.

The orient agent runs with `NORN_ORIENT=1`: its hooks record nothing, and `norn brief`, `done`, `ask` and `stuck` refuse it, so it can never start or end a step. It runs the norn that opened it.
