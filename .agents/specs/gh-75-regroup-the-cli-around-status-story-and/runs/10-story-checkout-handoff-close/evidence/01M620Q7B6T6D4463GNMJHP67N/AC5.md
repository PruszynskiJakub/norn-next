--- AC5
$ norn story close gh-7 --json  (clone B, holder)
{"error":"closing gh-7 removes its worktrees; there is no terminal to ask in","do_instead":"pass --yes","code":"confirm_required"}
exit=3
$ norn story close gh-7 </dev/null  (no TTY)
{"error":"closing gh-7 removes its worktrees; there is no terminal to ask in","do_instead":"pass --yes","code":"confirm_required"}
exit=3
$ echo y | norn story close gh-7  (stdin a pipe, no TTY)
{"error":"closing gh-7 removes its worktrees; there is no terminal to ask in","do_instead":"pass --yes","code":"confirm_required"}
exit=3
remote refs unchanged
B worktrees unchanged
