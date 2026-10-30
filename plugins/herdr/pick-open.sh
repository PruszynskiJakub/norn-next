#!/bin/sh
# Action: open the cockpit as a popup over the focused pane. The directory travels
# as NORN_COCKPIT_DIR (the pane command runs from the plugin folder); NORN_BIN passes through.
# No --workspace: Herdr opens an overlay over the active pane and refuses a target.
cd "$(dirname "$0")" && . ./lib.sh
dir=$(repo_dir)
set -- plugin pane open --plugin "$HERDR_PLUGIN_ID" --entrypoint pick --placement overlay --env "NORN_COCKPIT_DIR=$dir" --focus
[ -n "${NORN_BIN:-}" ] && set -- "$@" --env "NORN_BIN=$NORN_BIN"
exec "$HERDR" "$@"
