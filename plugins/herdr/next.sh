#!/bin/sh
# Action: focus the agent pane of the oldest Your turn item (HC10); a toast when there is none.
cd "$(dirname "$0")" && . ./lib.sh
cd "$(repo_dir)" || exit 1
out=$("$NORN" pane --next 2>/dev/null) || { notify "norn" "norn pane --next failed in $PWD"; exit 1; }
case "$out" in
  *'"item":null'*) notify "norn" "No agent waits for you" ;;
  *'"focused":null'*) notify "norn · Your turn" "No agent pane found; run: $(printf '%s' "$out" | sed -n 's/.*"command":"\([^"]*\)".*/\1/p')" ;;
esac
