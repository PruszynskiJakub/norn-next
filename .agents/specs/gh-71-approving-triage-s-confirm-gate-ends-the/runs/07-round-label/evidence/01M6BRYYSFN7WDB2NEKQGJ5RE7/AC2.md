# AC2 (B19) — a label edited on the remote is never read back as a round request
Test `B19: a norn:wf label edited on the remote starts no round and changes no workflow` (human.test.ts:770) passed with 5 assertions.
Action: #14's labels set to `norn, norn:wf:quick` on the fake remote, then 3 `tick --sync` runs 10 min apart.
Observed: no `round.start` decision for gh-14; the runs dir is unchanged; state is still `workflow: story, round: 2`, same step; spec.md is still `workflow: story`; still only 1 label call.
Review nit (non-blocking): the test restores #14's label outside a finally (human.test.ts:785).
