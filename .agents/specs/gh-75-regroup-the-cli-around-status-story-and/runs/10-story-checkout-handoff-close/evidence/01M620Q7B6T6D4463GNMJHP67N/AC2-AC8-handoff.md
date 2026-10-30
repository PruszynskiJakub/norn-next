(cwd: slice worktree gh-7-add-login-form--01-form)
$ norn story handoff --json
{"story":"gh-7","released":true,"pushed":["gh-7-add-login-form","gh-7/01-form"],"remote":"origin","next":"norn story checkout gh-7 (on the other machine)"}
exit=0
$ git ls-remote origin
2ce5cb25362a7eb39887a47a0bc629a4a3cb235a	HEAD
8982ca208f1d7e076284e1d2c9b114aeac866bdb	refs/heads/gh-7-add-login-form
d4fa70ab0a29f057c86ccb6b7163039a71f4b1d4	refs/heads/gh-7/01-form
2ce5cb25362a7eb39887a47a0bc629a4a3cb235a	refs/heads/main
$ git show origin/gh-7/01-form:.../runs/01-form/handoff.md | tail -3

## Resume
Form done; use blue.
$ git show origin/gh-7/01-form:wip.txt
fatal: path 'wip.txt' does not exist in 'origin/gh-7/01-form'
