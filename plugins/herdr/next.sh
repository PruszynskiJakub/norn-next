#!/bin/sh
# Action: focus the agent pane of the oldest Your turn item (HC10, `norn run attach --next`); a toast
# when there is none, or when its agent has no live pane (the refusal's do_instead starts it).
cd "$(dirname "$0")" && . ./lib.sh
cd "$(repo_dir)" || exit 1
out=$("$NORN" run attach --next --json 2>/dev/null) && exit 0
# P8: branch on the refusal's code, never on its text
code=$(printf '%s' "$out" | json_get code)
err=$(printf '%s' "$out" | json_get error)
hint=$(printf '%s' "$out" | json_get do_instead)
case "$code" in
  nothing_to_attach) notify "norn" "$err; run: $hint" ;;
  *) notify "norn" "norn run attach --next failed in $PWD${err:+: $err}" ;;
esac
