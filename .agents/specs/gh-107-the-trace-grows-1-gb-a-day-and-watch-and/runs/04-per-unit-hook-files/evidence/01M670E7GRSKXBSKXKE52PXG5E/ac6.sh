#!/usr/bin/env bash
D=$(cat $TMPDIR/qa-04/benchdir); T=$D/repo/.agents/norn/trace; W=$D/repo-worktrees/gh-1-long-step
export NORN_HOME_DIR=$D/home NORN_MACHINE=bench; unset NORN_HOME NORN_AGENT NORN_RUN NORN_STORY NORN_SLICE NORN_AGENT_SESSION_ID
n() { (cd $W && bun $1/packages/cli/src/main.ts brief --json); }
n $1 > $TMPDIR/qa-04/AC6-brief-readable.json; echo "readable exit=$?"
day=$(wc -l < $T/$(date -u +%F).jsonl)
chmod 200 $T/????-??-??.jsonl
n $1 > $TMPDIR/qa-04/AC6-brief-writeonly.json; echo "write-only day files exit=$?"
chmod 644 $T/????-??-??.jsonl
echo "today's day file lines: $day -> $(wc -l < $T/$(date -u +%F).jsonl); last type: $(tail -1 $T/$(date -u +%F).jsonl | jq -r .type)"
diff <(jq -S 'del(.. | .tick_id?, .briefing_id?, .now?, .at?)' $TMPDIR/qa-04/AC6-brief-readable.json) <(jq -S 'del(.. | .tick_id?, .briefing_id?, .now?, .at?)' $TMPDIR/qa-04/AC6-brief-writeonly.json) && echo "brief output identical (modulo ids/times)"
