#!/bin/sh
# Pane: the picker (`norn pick`) in the directory the popup was opened for; it closes when pick exits.
cd "$(dirname "$0")" && . ./lib.sh
cd "${NORN_COCKPIT_DIR:-$(repo_dir)}" || exit 1
"$NORN" pick >/dev/null
code=$?
if [ "$code" -ne 0 ]; then
  printf 'norn pick exited %s (is %s a norn repo?). Press Enter to close.' "$code" "$PWD"
  read -r _
fi
