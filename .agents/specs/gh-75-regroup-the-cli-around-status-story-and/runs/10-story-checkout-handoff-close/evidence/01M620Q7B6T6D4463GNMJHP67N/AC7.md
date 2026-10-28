$ norn story close gh-7 --yes --json  (clone B)
{"error":"gh-7 is already closed","do_instead":null,"code":"already_closed"}
exit=3
$ norn story close gh-7 --yes  (clone A, still has its old worktrees)
{"error":"gh-7 is already closed","do_instead":null,"code":"already_closed"}
exit=3
remote refs unchanged
A worktrees unchanged: gh-7-add-login-form
gh-7-add-login-form--01-form
