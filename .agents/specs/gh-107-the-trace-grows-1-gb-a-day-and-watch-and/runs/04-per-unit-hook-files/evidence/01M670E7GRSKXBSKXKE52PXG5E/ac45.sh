#!/usr/bin/env bash
D=$(cat $TMPDIR/qa-04/benchdir); R=$D/repo; W=$D/repo-worktrees/gh-1-long-step; T=$R/.agents/norn/trace; HF=$T/hooks/gh-1/_story.jsonl
export NORN_HOME_DIR=$D/home NORN_MACHINE=bench; unset NORN_HOME NORN_AGENT NORN_RUN NORN_STORY NORN_SLICE NORN_AGENT_SESSION_ID
n() { bun $SRC/packages/cli/src/main.ts "$@"; }
SRC=$1; MODE=$2
[ "$MODE" = wo ] && chmod 200 $T/????-??-??.jsonl
echo "== AC5 Stop hooks (day files: $MODE)"
for i in 1 2 3 4 5; do
  out=$(cd $W && echo '{"session_id":"qa-s5","transcript_path":"/tmp/qa.jsonl","cwd":"'$W'","hook_event_name":"Stop","stop_hook_active":false}' | n hook stop --agent claude); echo "stop #$i exit=$? -> $(echo "$out" | cut -c1-160)"
done
echo "blocked lines in hook file: $(grep -c '"blocked":true' $HF)"
echo "== AC4 tick (day files: $MODE)"
(cd $R && n tick --json) > $TMPDIR/qa-04/AC4-tick-$MODE.json; echo "tick exit=$?"; cut -c1-600 $TMPDIR/qa-04/AC4-tick-$MODE.json; echo
chmod 644 $T/????-??-??.jsonl
