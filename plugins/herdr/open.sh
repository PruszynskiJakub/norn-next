#!/bin/sh
# Action: open the cockpit below the focused pane, without taking focus: `norn status --watch --pane`
# splits the pane and runs the cockpit there, in the repo of the focused pane.
cd "$(dirname "$0")" && . ./lib.sh
cd "$(repo_dir)" || cd "$HOME" || exit 1
"$NORN" status --watch --pane --json >/dev/null 2>&1 || notify "norn" "norn status --watch --pane failed in $PWD"
