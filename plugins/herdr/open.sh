#!/bin/sh
# Action: open the cockpit below the focused pane, without taking focus (HC9).
cd "$(dirname "$0")" && . ./lib.sh
dir=$(repo_dir)
pane=$(ctx_get focused_pane_id)
set -- plugin pane open --plugin "$HERDR_PLUGIN_ID" --entrypoint cockpit --placement split --direction down --cwd "$dir" --env "NORN_COCKPIT_DIR=$dir" --no-focus
[ -n "${HERDR_WORKSPACE_ID:-}" ] && set -- "$@" --workspace "$HERDR_WORKSPACE_ID"
[ -n "$pane" ] && set -- "$@" --target-pane "$pane"
exec "$HERDR" "$@"
