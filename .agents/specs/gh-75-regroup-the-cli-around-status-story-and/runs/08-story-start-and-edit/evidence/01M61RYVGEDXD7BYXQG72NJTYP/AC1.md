$ norn story start gh-7 --print
{"unit":"gh-7","step":"refine","worktree":"/private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa-gh75-08/w/repo-worktrees/gh-7-add-login-form","command":"cd /private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa-gh75-08/w/repo-worktrees/gh-7-add-login-form && claude --permission-mode auto -- 'Use the norn skill, then run `norn brief`.'","opened":false}
[exit 0]

$ norn story start gh-7 --print --json
{"unit":"gh-7","step":"refine","worktree":"/private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa-gh75-08/w/repo-worktrees/gh-7-add-login-form","command":"cd /private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa-gh75-08/w/repo-worktrees/gh-7-add-login-form && claude --permission-mode auto -- 'Use the norn skill, then run `norn brief`.'","opened":false}
[exit 0]

$ norn story start gh-7
{"unit":"gh-7","step":"refine","worktree":"/private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa-gh75-08/w/repo-worktrees/gh-7-add-login-form","command":"cd /private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa-gh75-08/w/repo-worktrees/gh-7-add-login-form && claude --permission-mode auto -- 'Use the norn skill, then run `norn brief`.'","opened":false}
[exit 0]

$ norn story start --print
{"error":"norn story start: name the unit (no terminal to ask in)","do_instead":"norn story start gh-7 | norn story start gh-9","code":"target_required"}
[exit 2]

$ norn story start --json
{"error":"norn story start: name the unit (no terminal to ask in)","do_instead":"norn story start gh-7 | norn story start gh-9","code":"target_required"}
[exit 2]

$ norn help story start
norn story start — Open an agent on the step a person starts: a Herdr tab in the unit worktree, or the command to run

    norn story start [<story|slice>] [--print]

Options
  --print  print the start command instead of opening a terminal

For the person; an agent runs it only when the person asks it to.
[exit 0]

--- picker (TTY via script), gh-9 running, gh-7 parked attended ---
{"error":"norn story start: name the unit (no terminal to ask in)","do_instead":"norn story start gh-7","code":"target_required"}
