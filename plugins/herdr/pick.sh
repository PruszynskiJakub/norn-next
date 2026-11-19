#!/bin/sh
# Popup: `norn status --watch` over the focused pane, in the repo of the pane it covers. Frames go to
# stderr; a refusal (a pane outside a norn repo) is on stdout, kept to show before the popup closes.
cd "$(dirname "$0")" && . ./lib.sh
cd "${NORN_COCKPIT_DIR:-$(repo_dir)}" || cd "$HOME" || exit 1
out=$("$NORN" status --watch)
code=$?
if [ "$code" -ne 0 ]; then
  printf '%s\n\nnorn status --watch exited %s in %s. Press Enter to close.' "$out" "$code" "$PWD"
  read -r _
fi
