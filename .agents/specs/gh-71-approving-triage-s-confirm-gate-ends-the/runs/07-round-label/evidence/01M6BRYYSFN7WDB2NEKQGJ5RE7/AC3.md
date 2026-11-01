# AC3 (B20) — a failed label call warns; the round starts anyway
Test `B20 (D9): a failed label call warns in the tick's output and the trace; the round starts anyway` (human.test.ts:811) passed with 10 assertions.
Action: FakeRemote.labelError = Error("gh: could not connect"); `norn story edit gh-15 --workflow quick`; then tick.
Observed:
- tick decision round.start ok=true, warnings=["issue #15 label norn:wf:story → norn:wf:quick not updated: gh: could not connect"]; tick failed=0
- the label call was attempted (`label 15 -norn:wf:story +norn:wf:quick`)
- the round started: runs dir rounds/04-quick, state workflow quick, round 4, step work
- trace tick event: result {ok: true, warnings: [same]} (the schema gained an optional `warnings`)
- the `watch --human` line ends with `round.start → round_start  WARNING: issue #15 …not updated: gh: could not connect`
Reading: AC3 says "round 2 starts as in 06". The test checks this on gh-15's round 4, which goes through the same round_start path. Per the slice notes, "the command's output" means the tick or watch output, because `story edit` itself only writes the receipt.
