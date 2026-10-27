#!/bin/sh
# Popup: `norn cockpit` over the focused pane, on any workspace (outside a norn repo, the last one).
cd "$(dirname "$0")" && . ./lib.sh
cd "${NORN_COCKPIT_DIR:-$(repo_dir)}" || cd "$HOME" || exit 1
"$NORN" cockpit >/dev/null
code=$?
if [ "$code" -ne 0 ]; then
  printf 'norn cockpit exited %s in %s. Press Enter to close.' "$code" "$PWD"
  read -r _
fi
