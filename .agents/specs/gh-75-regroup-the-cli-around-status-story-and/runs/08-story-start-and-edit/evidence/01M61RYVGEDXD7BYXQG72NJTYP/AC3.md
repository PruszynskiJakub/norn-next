Precondition: gh-9 intaken, not started (status above shows 'not started').
$ norn status
gh-7 Add login form
  story · manual · unclaimed · not started
  base main: up to date

gh-9 Fix typo
  story · manual · unclaimed · not started
  base main: up to date

heartbeat: last tick 24s ago on jakubpruszynski@mac
0 items need you — norn inbox
[exit 0]

$ norn story edit gh-9 --workflow fix
{"unit":"gh-9","workflow":"fix","previous":"story","started":false,"changed":true,"file":"/private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa-gh75-08/w/repo-worktrees/gh-9-fix-typo/.agents/specs/gh-9-fix-typo/story.md"}
[exit 0]

$ norn status
gh-7 Add login form
  story · manual · unclaimed · not started
  base main: 1 behind

gh-9 Fix typo
  fix · manual · unclaimed · not started
  base main: 1 behind

heartbeat: last tick 25s ago on jakubpruszynski@mac
0 items need you — norn inbox
[exit 0]

$ norn story edit gh-9 --workflow fix --json
{"unit":"gh-9","workflow":"fix","previous":"fix","started":false,"changed":false,"file":null}
[exit 0]

$ norn story edit gh-99 --workflow fix
{"error":"unknown unit gh-99: not in this checkout or on the remote","do_instead":"norn status","code":"unknown_unit"}
[exit 3]

---
id: gh-9
slug: fix-typo
provider: gh
number: 9
url: https://github.com/acme/app/issues/9
title: Fix typo
assignee: me
11:workflow: fix
