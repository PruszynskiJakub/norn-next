#!/bin/sh
# Action: open the cockpit below the focused pane, without taking focus (HC9).
# The directory travels as NORN_COCKPIT_DIR, not --cwd: the pane command runs from its cwd, so
# `sh cockpit.sh` must start in the plugin folder. A target pane already names its workspace.
cd "$(dirname "$0")" && . ./lib.sh
dir=$(repo_dir)
pane=$(ctx_get focused_pane_id)
set -- plugin pane open --plugin "$HERDR_PLUGIN_ID" --entrypoint cockpit --placement split --direction down --env "NORN_COCKPIT_DIR=$dir" --no-focus
if [ -n "$pane" ]; then set -- "$@" --target-pane "$pane"
elif [ -n "${HERDR_WORKSPACE_ID:-}" ]; then set -- "$@" --workspace "$HERDR_WORKSPACE_ID"
fi
exec "$HERDR" "$@"
