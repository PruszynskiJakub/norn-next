# AC1 (B5): pass
Ran `norn hook post-tool-use --agent claude` in gh-1's worktree with a Claude PostToolUse payload (command `echo qa-ac1-marker`) → `{}` exit 0.
- hook file `trace/hooks/gh-1/_story.jsonl`: 420 → 421 lines; today's day file: 670 → 671 lines.
- `cmp` of the hook file's last line and the day-file line with the marker: identical ("SAME LINE"). Line: `{"type":"hook","id":"01M671948MK1T90VQSJGRCG4RY","fact":{"event":"tool_use",…,"native":"PostToolUse",…,"command":"echo qa-ac1-marker","story":"gh-1","run_id":"01M66CKKZSK12P2CXYHTSJJNPP"}}`
- `norn trace gh-1 --events` (AC1-trace-events.md) lists `10-30 18:31:14 hook claude tool_use Bash`. The plain `norn trace gh-1` shows only the step table, by design (events take `--events`).
Test: agent-protocol AC1, green. Output: manual-out.txt.
