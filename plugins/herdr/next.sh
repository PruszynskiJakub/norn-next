#!/bin/sh
# Action: focus the pane of the agent that has waited on you longest (`norn run attach --next`); a
# toast when there is none, or when its run has no pane here (the refusal's do_instead says what to do).
cd "$(dirname "$0")" && . ./lib.sh
cd "$(repo_dir)" || exit 1
out=$("$NORN" run attach --next --json 2>/dev/null) && exit 0
# branch on the refusal's code, never on its text
code=$(printf '%s' "$out" | json_get code)
err=$(printf '%s' "$out" | json_get error)
hint=$(printf '%s' "$out" | json_get do_instead)
case "$code" in
  nothing_to_attach) notify "norn" "$err; run: $hint" ;;
  *) notify "norn" "norn run attach --next failed in $PWD${err:+: $err}" ;;
esac
