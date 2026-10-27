#!/bin/sh
# Action: open the picker as a popup over the focused pane. As for the cockpit, the directory travels
# as NORN_COCKPIT_DIR (the pane command runs from the plugin folder); NORN_BIN passes through.
cd "$(dirname "$0")" && . ./lib.sh
dir=$(repo_dir)
set -- plugin pane open --plugin "$HERDR_PLUGIN_ID" --entrypoint pick --placement overlay --env "NORN_COCKPIT_DIR=$dir" --focus
[ -n "${NORN_BIN:-}" ] && set -- "$@" --env "NORN_BIN=$NORN_BIN"
[ -n "${HERDR_WORKSPACE_ID:-}" ] && set -- "$@" --workspace "$HERDR_WORKSPACE_ID"
exec "$HERDR" "$@"
