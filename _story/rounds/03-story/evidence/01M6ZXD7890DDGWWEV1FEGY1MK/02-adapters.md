### codex PreToolUse shell git push
exit=0
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"norn refused this call. Never `git push` (only norn pushes): a push outside norn is an effect with no receipt, and receipts come before effects; if you want this pushed, run it yourself."}}

### codex PreToolUse shell (exec/shell tool) git push
exit=0
{}

### gemini BeforeTool run_shell_command git push
exit=0
{"decision":"deny","reason":"norn refused this call. Never `git push` (only norn pushes): a push outside norn is an effect with no receipt, and receipts come before effects; if you want this pushed, run it yourself."}

### opencode pre-tool git push
exit=0
{}

### claude EnterWorktree
exit=0
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"norn refused this call. Never switch branches or worktrees: a switch leaves the unit's branch, where norn commits what is left at the report; if you want another branch or worktree, switch it yourself."}}

### claude Read (other tool)
exit=0
{}

