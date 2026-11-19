# norn's Herdr plugin

Install it once with `herdr plugin install PruszynskiJakub/norn-next/plugins/herdr`, or link a norn checkout with `herdr plugin link <checkout>/plugins/herdr` so it follows `git pull`. After a norn upgrade, `herdr plugin update norn` picks up a newer copy.

What it gives you:

| Entry | What it does |
|---|---|
| action `norn.pick`, pane `pick` | the cockpit (`norn status --watch`) as a popup over the focused pane, on any workspace |
| action `norn.open` | the cockpit as a split below the focused pane, leaving the focus where it was (`norn status --watch --pane`) |
| action `norn.next` | focuses the pane of the agent that has waited on you longest (`norn run attach --next`); a toast when none does |

The cockpit, the attach and the sidebar token need the herdr runner (`norn config set executors.claude.runner herdr`): only its runs have a pane to go to.

## The cockpit

`norn status --watch` lists what needs you (your turn, an answer, a gate to approve, a stuck unit), then one row per story with the step it is at, what runs and its PR, and the intake no tick has taken in yet. The right side previews the selected row's story: its units, its PR and issue, what waits for you with the command that resolves it, and its open notes. The footer lists the keys the selected row offers.

| Key | Does |
|---|---|
| ↑ ↓, j k, PgUp PgDn | move |
| 1 2 3 | tabs: now (needs you, in flight), backlog (intake), done |
| / | filter: type words (every one must match), enter keeps the filter, esc clears it |
| enter | the story in full (`norn story view`), in place of the preview; esc closes it |
| g | go to the agent's pane (`norn run attach`) |
| s | start the agent of a manual or attended step (`norn run start`) |
| a | answer the question, or the prompt in the agent's pane: type it in the footer, enter sends, esc cancels (`norn story answer`) |
| y, x | approve the gate, or reject it with what to change (`norn story approve`, `norn story reject --reason`) |
| u | run a stuck unit's step again (`norn run rerun`) |
| t | take a story another machine holds (`norn story take`) |
| o, i | open the PR, the issue, in the browser |
| r, ?, q | refresh, list the keys, quit |

Every action leaves the cockpit open with its outcome on the footer line. Each one is the norn command you would type. The cockpit reads this machine's record every few seconds, and asks the code host about items, PRs and intake at start, on `r`, after an action and once a minute.

## Config snippet

Add to Herdr's `config.toml`, then run `herdr server reload-config`:

```toml
[ui]
# one line for the repo of the focused pane, e.g. `norn·todoist-app ● 1 approve ◐ 2 running`
tab_bar_right = [{ type = "command", command = "norn status --segment", interval_seconds = 10 }]

# each story's workspace shows what it needs (`● approve`, `◆ answer +1`, `◐ running`)
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

Herdr runs the tab bar command in the focused pane's directory, so the segment follows the repo you are looking at and prints an empty line outside one. It reads only this machine's record, never the code host, so it stays fast. While it runs inside Herdr it also writes the `$norn` sidebar token on the workspace of each story still going, which the herdr runner labels with the story's key.
