Precondition: gh-9 manual, ready implement#1 (agent step, unattended); runner headless (fake claude logging to claude.log).
$ norn story edit gh-9 --auto --manual
{"error":"story edit: --auto and --manual exclude each other","do_instead":"norn story edit [<story|slice>] --auto|--manual | --workflow <name> [--at <step>]","code":"usage"}
[exit 2]

$ norn story edit gh-9
{"error":"story edit: nothing to change (pass --auto, --manual or --workflow <name>)","do_instead":"norn story edit [<story|slice>] --auto|--manual | --workflow <name> [--at <step>]","code":"usage"}
[exit 2]

$ norn story edit gh-9 --auto --workflow quick
{"error":"story edit: change the mode or the workflow, one at a time","do_instead":"norn story edit [<story|slice>] --auto|--manual | --workflow <name> [--at <step>]","code":"usage"}
[exit 2]

$ norn story edit gh-9 --auto
{"unit":"gh-9","mode":"auto","previous":"manual","changed":true,"receipt":{"kind":"mode","receipt_id":"01M61SGVGAGJ2WE1BQVRJTTQFD","run_id":null,"step":"implement","attempt":1,"at":"2026-10-28T17:39:27.370Z","by":"human","who":"jakubpruszynski@mac","slice":null,"mode":"auto","previous":"manual"},"delivered":{"via":"local","claim":"mine","n":2,"file":".agents/specs/gh-9-fix-typo/runs/_story/receipts/0002-mode.json"},"next":"norn tick"}
[exit 0]

$ norn story edit gh-9 --auto --json
{"unit":"gh-9","mode":"auto","changed":false}
[exit 0]

$ norn tick --json
{"tick_id":"01M61SGWFHTK24TN6Y0JAG2870","at":"2026-10-28T17:39:28.369Z","duration_ms":1016,"sync":{"ran":false,"ok":true},"decisions":[{"unit":"gh-7","rule":"unit.parked.attended","kind":"noop","ok":true},{"unit":"gh-9","rule":"receipts.apply","kind":"apply_receipts","ok":true}],"notified":[],"trace":"2026-10-28.jsonl","failed":0}
[exit 0]

$ cat claude.log

$ norn status gh-9
gh-9 Fix typo
  quick · auto · mine · ready implement#1 14s
  → cd /private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa-gh75-08/w/repo-worktrees/gh-9-fix-typo && claude --permission-mode auto -- 'Use the norn skill, then run `norn brief`.'
  base main: 1 behind

heartbeat: last tick 0s ago on jakubpruszynski@mac
1 item needs you — norn inbox
[exit 0]

$ norn tick --json
{"tick_id":"01M61SH46BH3QP85JH9QG0WQDH","at":"2026-10-28T17:39:36.267Z","duration_ms":850,"sync":{"ran":false,"ok":true},"decisions":[{"unit":"gh-7","rule":"unit.parked.attended","kind":"noop","ok":true},{"unit":"gh-9","rule":"agent.start","kind":"start_run","ok":true}],"notified":[],"trace":"2026-10-28.jsonl","failed":0}
[exit 0]

$ cat claude.log
/private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa-gh75-08/w/repo-worktrees/gh-9-fix-typo :: -p --permission-mode auto -- Use the norn skill, then run `norn brief`.

$ norn status gh-9
gh-9 Fix typo
  quick · auto · mine · running implement#1 2s
  base main: 1 behind

Runs
  gh-9       implement#1 auto claude alive since 2026-10-28T17:39:36.854Z

heartbeat: last tick 2s ago on jakubpruszynski@mac
1 item needs you — norn inbox
[exit 0]

$ norn story edit gh-9 --manual
{"unit":"gh-9","mode":"manual","previous":"auto","changed":true,"receipt":{"kind":"mode","receipt_id":"01M61SHFYE6H4NCDY7DWTS4M8N","run_id":"01M61SH46BPVS7F6BPAJ40AKZQ","step":"implement","attempt":1,"at":"2026-10-28T17:39:48.302Z","by":"human","who":"jakubpruszynski@mac","slice":null,"mode":"manual","previous":"auto"},"delivered":{"via":"local","claim":"mine","n":5,"file":".agents/specs/gh-9-fix-typo/runs/_story/receipts/0005-mode.json"},"next":"norn tick"}
[exit 0]

$ norn status gh-9
gh-9 Fix typo
  quick · auto · mine · running implement#1 11s
  base main: 1 behind

Runs
  gh-9       implement#1 auto claude alive since 2026-10-28T17:39:36.854Z

heartbeat: last tick 11s ago on jakubpruszynski@mac
1 item needs you — norn inbox
[exit 0]

gh-9 Fix typo
  quick · manual · mine · running implement#1 25s
  base main: 1 behind
