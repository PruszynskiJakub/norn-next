$ norn story checkout gh-7 --force --json  (clone A)
{"story":"gh-7","taken_from":{"holder":"uB@B","since":"2026-10-28T19:53:36.775Z","expires_at":"2026-10-28T20:03:36.775Z","expired":false},"forced":true,"journal":{"line":"- 2026-10-28T19:53:51.446Z take --force by uA@A from uB@B (heartbeat 01M6216G872E2NEVN72N9K201K, expires 2026-10-28T20:03:36.775Z)","commit":"50cd5b1fba6dd1e8337da2ad0aefe6cb2116576a","pushed":true}}
exit=
$ git show origin/gh-7-add-login-form:.../runs/_story/handoff.md | grep force
- 2026-10-28T19:53:51.446Z take --force by uA@A from uB@B (heartbeat 01M6216G872E2NEVN72N9K201K, expires 2026-10-28T20:03:36.775Z)
--- AC6: B (not holder) closes
$ norn story close gh-7 --yes --json  (clone B)
{"error":"Unknown option '--yes --json'. To specify a positional argument starting with a '-', place it at the end of the command after '--', as in '-- \"--yes --json\"","do_instead":"norn story close --help","code":"usage"}
exit=2
$ norn story close gh-7 --yes  (clone B)
{"error":"gh-7 is held by uA@A since 2026-10-28T19:53:51.446Z","do_instead":"norn story checkout gh-7","code":"claim_held"}
exit=3
$ (clone B, from slice worktree) norn story close --yes --json
{"error":"gh-7 is held by uA@A since 2026-10-28T19:53:51.446Z","do_instead":"norn story checkout gh-7","code":"claim_held"}
exit=3
remote refs unchanged
B worktrees unchanged: gh-7-add-login-form
gh-7-add-login-form--01-form
