Precondition: gh-9 started on workflow fix, parked at diagnose#1.
$ norn story edit gh-9 --workflow quick
{"error":"gh-9 already runs workflow fix; switching a started unit needs --at <step> (S7)","do_instead":"norn story edit gh-9 --workflow quick --at <diagnose|implement|ready>","code":"needs_to"}
[exit 3]

$ norn story edit gh-9 --workflow quick --at nope
{"error":"no step 'nope' in workflow quick","do_instead":"norn story edit gh-9 --workflow quick --at <diagnose|implement|ready>","code":"unknown_step"}
[exit 3]

$ norn story edit gh-9 --at implement
{"error":"story edit: --at needs --workflow","do_instead":"norn story edit [<story|slice>] --auto|--manual | --workflow <name> [--at <step>]","code":"usage"}
[exit 2]

$ norn story edit gh-9 --workflow quick --at implement --json
{"unit":"gh-9","workflow":"quick","previous":"fix","started":true,"to":"implement","receipt":{"kind":"workflow","receipt_id":"01M61SG7F080HJV8M7NY2B4Y4G","run_id":null,"step":"diagnose","attempt":1,"at":"2026-10-28T17:39:06.848Z","by":"human","who":"jakubpruszynski@mac","slice":null,"name":"quick","from_hash":"e254209e9391ac3511e4cb31bd4f84e5b46af8ddd70d3cc9932c1b37175da410","to_hash":"372b3436fbdd0900d313e97a8183f0c375158e966eb96c28e46d1aa4e84db5b1","to":"implement"},"delivered":{"via":"local","claim":"mine","n":1,"file":".agents/specs/gh-9-fix-typo/runs/_story/receipts/0001-workflow.json"},"file":"/private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa-gh75-08/w/repo-worktrees/gh-9-fix-typo/.agents/specs/gh-9-fix-typo/story.md","next":"norn tick"}
[exit 0]

$ norn status gh-9
gh-9 Fix typo
  fix · manual · mine · parked diagnose#1 (attended: attended step diagnose: work with the agent in the worktree) 22s
  → cd /private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa-gh75-08/w/repo-worktrees/gh-9-fix-typo && claude --permission-mode auto -- 'Use the norn skill, then run `norn brief`.'
  base main: 1 behind

heartbeat: last tick 21s ago on jakubpruszynski@mac
2 items need you — norn inbox
[exit 0]

$ cat state.json

$ ls receipts
$ norn tick --json
{"tick_id":"01M61SGF4WMR3K6P5WX0R1Z17M","at":"2026-10-28T17:39:14.716Z","duration_ms":906,"sync":{"ran":false,"ok":true},"decisions":[{"unit":"gh-7","rule":"unit.parked.attended","kind":"noop","ok":true},{"unit":"gh-9","rule":"receipts.apply","kind":"apply_receipts","ok":true}],"notified":["your_turn:gh-9:implement#1"],"trace":"2026-10-28.jsonl","failed":0}

$ norn status gh-9
gh-9 Fix typo
  quick · manual · mine · ready implement#1 1s
  → cd /private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa-gh75-08/w/repo-worktrees/gh-9-fix-typo && claude --permission-mode auto -- 'Use the norn skill, then run `norn brief`.'
  base main: 1 behind

heartbeat: last tick 0s ago on jakubpruszynski@mac
2 items need you — norn inbox
$ state.json
{
  "version": 1,
  "story": "gh-9",
  "slice": null,
  "unit_dir": "_story",
  "workflow": "quick",
  "workflow_hash": "372b3436fbdd0900d313e97a8183f0c375158e966eb96c28e46d1aa4e84db5b1",
  "step": "implement",
  "attempt": 1,
  "visits": {
    "diagnose": 1,
    "implement": 1
  },
  "step_entered_at": "2026-10-28T17:39:14.722Z",
  "status": "ready",
  "park": null,
  "counters": {},
  "nudges_used": 0,
  "retries_used": 0,
  "applied_through": 1,
  "run": null,
  "last_outcome": null,
  "created_at": "2026-10-28T17:38:44.389Z",
  "updated_at": "2026-10-28T17:39:14.722Z",
  "last_tick_id": "01M61SGF4WMR3K6P5WX0R1Z17M",
  "mode": "manual"
}

0001-workflow.json
$ git log
81bfd06 norn: gh-9 diagnose.workflow → implement
bfbfeae norn: start gh-9 (fix)
45c3025 norn: intake gh-9 Fix typo
162e2b5 norn init
