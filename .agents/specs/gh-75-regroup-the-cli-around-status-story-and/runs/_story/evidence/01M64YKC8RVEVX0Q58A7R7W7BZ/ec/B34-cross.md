$ norn story handoff gh-4
{"story":"gh-4","released":true,"pushed":["gh-4-split-work","gh-4/01-part"],"remote":"origin","next":"norn story checkout gh-4 (on the other machine)"}
[exit 0]

claim gh-4 after handoff: ''
$ (ann@laptop) norn story checkout gh-4
{"story":"gh-4","branch":"gh-4-split-work","claim":{"holder":"ann@laptop","heartbeat_id":"03PGFN45KG0A3HFYX5NNBFFFKB","acquired_at":"2099-01-15T10:01:10.000Z","expires_at":"2099-01-15T10:11:10.000Z"},"taken_from":null,"forced":false,"journal":null,"receipt":{"file":"0005-take.json","commit":"7c39444f0bcf4f5e75b3b2cec0a0d488cecb2cb2","pushed":true},"worktrees":[{"unit":"gh-4","path":"/private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/norn-cli-AkNHHL/colleague-worktrees/gh-4-split-work","branch":"gh-4-split-work","local":"created","created":true,"slot":2},{"unit":"gh-4/01","path":"/private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/norn-cli-AkNHHL/colleague-worktrees/gh-4-split-work--01-part","branch":"gh-4/01-part","local":"created","created":true,"slot":3}],"units":[{"unit":"gh-4","worktree":"/private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/norn-cli-AkNHHL/colleague-wo
[exit 0]

claim gh-4 after ann's checkout: 1cfe4ae0f8d492be0d850fed66fd373a7f5f9679	refs/norn/claims/gh-4
ann's worktrees: gh-4 true, gh-4/01 true
$ (ann@laptop) norn story list
gh-2 Send receipts
  gated · auto · mine · parked review#1 (gate: Look at it) 30s [loop 0/2]
  → norn story approve gh-2

gh-4 Split work
  sliced · auto · mine · ready slices#1 30s
  → norn brief
  gh-4/01    First part — parked qa#1 (gate: Try the slice) 20s
      → norn story approve gh-4/01

! no heartbeat on ann@laptop yet — run `norn watch` (auto steps wait for it)
3 items need you — norn status
[exit 0]

