#!/bin/sh
# Pane: the interactive cockpit (HC4) in the directory the pane was opened for.
cd "$(dirname "$0")" && . ./lib.sh
cd "${NORN_COCKPIT_DIR:-$(repo_dir)}" || exit 1
"$NORN" pane --interactive >/dev/null
code=$?
if [ "$code" -ne 0 ]; then
  printf 'norn pane exited %s (is %s a norn repo?). Press Enter to close.' "$code" "$PWD"
  read -r _
fi
