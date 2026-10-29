#!/bin/sh
# Action: focus the agent pane of the oldest Your turn item (HC10, `norn run attach --next`); a toast
# when there is none, or when its agent has no live pane (the refusal's do_instead starts it).
cd "$(dirname "$0")" && . ./lib.sh
cd "$(repo_dir)" || exit 1
out=$("$NORN" run attach --next --json 2>/dev/null) && exit 0
err=$(printf '%s' "$out" | sed -n 's/.*"error":"\([^"]*\)".*/\1/p')
hint=$(printf '%s' "$out" | sed -n 's/.*"do_instead":"\([^"]*\)".*/\1/p')
case "$err" in
  '') notify "norn" "norn run attach --next failed in $PWD" ;;
  'No agent waits for you') notify "norn" "$err" ;;
  *) notify "norn · Your turn" "$err; run: $hint" ;;
esac
