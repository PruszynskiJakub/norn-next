gh-2 park: {"kind":"gate","reason":"Look at it","since":"2099-01-15T10:00:40.000Z"}
$ norn status --watch --interval 5s   (keys: y, q)
[exit 0]
--- first frame:
norn status · repo  1 needs you                                                                                           tick 0s ago  11:00
/ to filter
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
NEEDS YOU                                                │ gh-2 — Send receipts
▸ ● approve  gh-2  review  Look at it                 0s │ ● parked at review · auto · held here
STORIES                                                  │ last: work → done
  gh-2  Send receipts  parked review · no slices · no PR │ 
                                                         │ LINKS
                                                         │ PR      none seen yet
                                                         │ issue   https://github.com/o/r/issues/2
                                                         │ 
                                                         │ ● APPROVE gh-2 · review
                                                         │ Look at it
                                                         │ step work#1 reported done (receipt 0003) · or reject: norn story reject gh-2
                                                         │ --reason "…"
                                                         │ Report:
                                                         │ /private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/norn-cli-cbeUw3/repo-wor
                                                         │ ktrees/gh-2-send-receipts/.agents/specs/gh-2-send-receipts/runs/_story/receipts/0
                                                         │ 003-done.json
                                                         │ $ norn story approve gh-2
                                                         │ 
                                                         │ NOTES none open
                                                         │ 
                                                         │ 
                                                         │ 
                                                         │ 
                                                         │ 
                                                         │ 
                                                         │ 
                                                         │ 
                                                         │ 
                                                         │ 
                                                         │ 
                                                         │ 
                                                         │ 
                                                         │ 
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

enter orient · y approve · x reject · v trace · i issue · / filter · ? keys · q quit
--- last frame:
norn status · repo  1 needs you                                                                                           tick 0s ago  11:00
/ to filter
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
NEEDS YOU                                                │ gh-2 — Send receipts
▸ ● approve  gh-2  review  Look at it                 0s │ ● parked at review · auto · held here
STORIES                                                  │ last: work → done
  gh-2  Send receipts  parked review · no slices · no PR │ 
                                                         │ LINKS
                                                         │ PR      none seen yet
                                                         │ issue   https://github.com/o/r/issues/2
                                                         │ 
                                                         │ ● APPROVE gh-2 · review
                                                         │ Look at it
                                                         │ step work#1 reported done (receipt 0003) · or reject: norn story reject gh-2
                                                         │ --reason "…"
                                                         │ Report:
                                                         │ /private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/norn-cli-cbeUw3/repo-wor
                                                         │ ktrees/gh-2-send-receipts/.agents/specs/gh-2-send-receipts/runs/_story/receipts/0
                                                         │ 003-done.json
                                                         │ $ norn story approve gh-2
                                                         │ 
                                                         │ NOTES none open
                                                         │ 
                                                         │ 
                                                         │ 
                                                         │ 
                                                         │ 
                                                         │ 
                                                         │ 
                                                         │ 
                                                         │ 
                                                         │ 
                                                         │ 
                                                         │ 
                                                         │ 
                                                         │ 
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
ok: norn story approve gh-2
enter orient · y approve · x reject · v trace · i issue · / filter · ? keys · q quit
new receipts in gh-2 after pressing y: 0004-approve.json
{
  "kind": "approve",
  "receipt_id": "03PGFN38A0JE2S7YN3W99E5RJS",
  "run_id": null,
  "step": "review",
  "attempt": 1,
  "at": "2099-01-15T10:00:40.000Z",
  "by": "human",
  "who": "tester@box",
  "slice": null,
  "head_sha": "fb9238a7929e013914f949e3e0fe78eb39d0bf3a"
}

