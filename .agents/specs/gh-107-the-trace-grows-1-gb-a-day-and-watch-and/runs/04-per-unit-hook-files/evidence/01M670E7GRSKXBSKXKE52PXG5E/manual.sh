#!/usr/bin/env bash
set -u
WT_SRC=$1; D=$(cat $TMPDIR/qa-04/benchdir); R=$D/repo; W=$D/repo-worktrees/gh-1-long-step
norn() { bun $WT_SRC/packages/cli/src/main.ts "$@"; }
export NORN_HOME_DIR=$D/home NORN_MACHINE=bench; unset NORN_HOME NORN_AGENT NORN_RUN NORN_STORY NORN_SLICE NORN_AGENT_SESSION_ID
T=$R/.agents/norn/trace; HF=$T/hooks/gh-1/_story.jsonl; DAY=$T/$(date -u +%F).jsonl
short() { cut -c1-400; }
echo "== AC1 (B5) PostToolUse in gh-1's worktree"
hb=$(wc -l < $HF); db=$(wc -l < $DAY)
(cd $W && echo '{"session_id":"qa-s1","transcript_path":"/tmp/qa.jsonl","cwd":"'$W'","hook_event_name":"PostToolUse","tool_name":"Bash","tool_input":{"command":"echo qa-ac1-marker"},"tool_response":{}}' | norn hook post-tool-use --agent claude); echo " exit=$?"
echo "hook file lines: $hb -> $(wc -l < $HF); day file lines: $db -> $(wc -l < $DAY)"
echo "hook file last line:"; tail -1 $HF | short
echo "day file lines with marker: $(grep -c qa-ac1-marker $DAY)"
cmp <(tail -1 $HF) <(grep -F qa-ac1-marker $DAY) && echo "SAME LINE in hook file and day file"
(cd $R && norn trace gh-1 --json) > $TMPDIR/qa-04/AC1-trace.json; echo "norn trace gh-1 exit=$? ; mentions marker: $(grep -c qa-ac1-marker $TMPDIR/qa-04/AC1-trace.json)"
(cd $R && norn trace gh-1) 2>&1 | grep -n "qa-ac1-marker" | short
echo "== AC2 (B6) hook in the main checkout"
before=$(find $T -type f | sort | md5); dbe=$(wc -l < $DAY); hbe=$(wc -l < $HF)
(cd $R && echo '{"session_id":"qa-s2","cwd":"'$R'","hook_event_name":"PostToolUse","tool_name":"Bash","tool_input":{"command":"echo qa-ac2-marker"}}' | norn hook post-tool-use --agent claude); echo " exit=$?"
[ "$before" = "$(find $T -type f | sort | md5)" ] && echo "same set of trace files (no new hook file)"
echo "day lines $dbe -> $(wc -l < $DAY); gh-1 hook lines $hbe -> $(wc -l < $HF); marker anywhere in trace: $(grep -rl qa-ac2-marker $T | wc -l)"; find $T/hooks -type f
echo "== AC3 (B7) SessionStart (no run id) in gh-1's worktree"
hb=$(wc -l < $HF)
(cd $W && echo '{"session_id":"qa-s3","transcript_path":"/tmp/qa.jsonl","cwd":"'$W'","hook_event_name":"SessionStart","source":"startup"}' | norn hook session-start --agent claude); echo " exit=$?"
echo "hook file lines: $hb -> $(wc -l < $HF)"; tail -1 $HF | short; echo
echo "== AC6 (B10) brief with day files unreadable (chmod 000)"
(cd $W && norn brief --json) > $TMPDIR/qa-04/AC6-brief-readable.json; echo "brief (readable) exit=$?"
chmod 000 $T/????-??-??.jsonl
(cd $W && norn brief --json) > $TMPDIR/qa-04/AC6-brief-unreadable.json; echo "brief (day files 000) exit=$?"
chmod 644 $T/????-??-??.jsonl
cmp $TMPDIR/qa-04/AC6-brief-readable.json $TMPDIR/qa-04/AC6-brief-unreadable.json && echo "brief output identical with day files unreadable"
