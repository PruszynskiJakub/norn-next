$ (ann@laptop) norn story checkout gh-2
{"error":"held by tester@box since 2099-01-15T10:00:50.000Z (expires 2099-01-15T10:10:50.000Z)","do_instead":"wait until 2099-01-15T10:10:50.000Z, ask tester@box to run norn story handoff gh-2, or norn story checkout gh-2 --force","code":"claim_held","details":{"claim":{"version":1,"story":"gh-2","holder":"tester@box","heartbeat_id":"03PGFN2180SZB8K7EW2WP50BXJ","acquired_at":"2099-01-15T10:00:50.000Z","renewed_at":"2099-01-15T10:00:50.000Z","expires_at":"2099-01-15T10:10:50.000Z","last_tick_id":null}}}
[exit 5]

$ (ann@laptop) norn story checkout gh-2 --force
{"story":"gh-2","branch":"gh-2-send-receipts","claim":{"holder":"ann@laptop","heartbeat_id":"03PGFN45KG0A3HFYX5NNBFFFKB","acquired_at":"2099-01-15T10:01:10.000Z","expires_at":"2099-01-15T10:11:10.000Z","forced_from":"tester@box (heartbeat 03PGFN2180SZB8K7EW2WP50BXJ, expires 2099-01-15T10:10:50.000Z)"},"taken_from":{"holder":"tester@box","since":"2099-01-15T10:00:50.000Z","expires_at":"2099-01-15T10:10:50.000Z","expired":false},"forced":true,"journal":{"line":"- 2099-01-15T10:01:10.000Z take --force by ann@laptop from tester@box (heartbeat 03PGFN2180SZB8K7EW2WP50BXJ, expires 2099-01-15T10:10:50.000Z)","commit":"8f1307ac273ace6189d4b0af35d8bb135ef3f1e2","pushed":true},"receipt":{"file":"0005-take.json","commit":"8f1307ac273ace6189d4b0af35d8bb135ef3f1e2","pushed":true},"worktrees":[{"unit":"gh-2","path":"/private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/norn-cli-AkNHHL/colleague-work
[exit 0]

claim gh-2 now: 9bf2e4a19846c1c27add1d9b9df5cacac5ea6a62	refs/norn/claims/gh-2
ann's worktree for gh-2 exists: true
