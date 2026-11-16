## Goal

Triage gh-345 (derived default counters for workflow edges): done; recommendation is refinement.

## Proof

- `## Triage` comment: https://github.com/PruszynskiJakub/norn-next/issues/345#issuecomment-6925701113
- Labels added: norn:kind:feature, norn:risk:medium, norn:priority:medium (intake label `norn` kept)
- Repro: in a throwaway repo, `init`, drop `counter: review_loop` from quick.yaml's `review.changes_requested`; `doctor` reports `cycle without a counter`.

## Easy to miss

- `CounterName` (`packages/schema/src/common.ts:30`) forbids `.`; it is used in `state.json` `counters` and the exhausted park (`packages/schema/src/state.ts:90,162`), so the derived-name format is a persisted, one-way choice.
- #342 is closed (PR #352), so the issue's precondition is met.

## Not proven yet

- Nothing for triage. Design questions (name format, agent-outcome derivation rule) are for refinement.

## Notes

- Base checked: 0edbb1a7c. Ran the dev build only under $TMPDIR.

## Resume

A person picks the next round (refinement recommended).
