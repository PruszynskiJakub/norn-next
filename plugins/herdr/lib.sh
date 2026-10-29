#!/bin/sh
# Shared helpers for norn's Herdr plugin. Sourced, not executed.

HERDR=${HERDR_BIN_PATH:-herdr}
CTX=${HERDR_PLUGIN_CONTEXT_JSON:-'{}'}

# norn on PATH, else the launch shim (R8.1), else $NORN_BIN.
if [ -n "${NORN_BIN:-}" ]; then NORN=$NORN_BIN
elif command -v norn >/dev/null 2>&1; then NORN=norn
else NORN="$HOME/.norn/bin/norn"
fi

# json_get <key>: a string field of the flat JSON on stdin (no jq needed); escaped quotes are kept.
json_get() {
  sed -nE "s/.*\"$1\":\"(([^\"\\\\]|\\\\.)*)\".*/\\1/p"
}

# ctx_get <key>: a string field of the plugin context JSON.
ctx_get() {
  printf '%s' "$CTX" | json_get "$1"
}

# The directory the cockpit runs in: the focused pane's, else the workspace's, else $PWD.
repo_dir() {
  dir=$(ctx_get focused_pane_cwd)
  [ -n "$dir" ] || dir=$(ctx_get workspace_cwd)
  printf '%s\n' "${dir:-$PWD}"
}

notify() {
  "$HERDR" notification show "$1" --body "${2:-}" --sound none >/dev/null 2>&1 || true
}
