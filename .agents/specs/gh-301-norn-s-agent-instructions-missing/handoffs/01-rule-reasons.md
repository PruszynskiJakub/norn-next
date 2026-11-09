## Goal

Every hard rule in the brief's How to work carries the one clause saying what breaks if it is not followed, all rendered from one list of hard rules in core that the hooks (gh-301/05–07) will reuse.

## Proof

- One list: `HARD_RULES` in `packages/core/src/hard-rules.ts` (id, rule, reason), exported from `@norn/core`; `ruleWithReason(id)` renders `<rule> — <reason>.`; `protocolLines` in `packages/core/src/brief.ts` builds each hard rule from it.
- No-survey rule says why (AC1): `packages/core/test/unit/brief.test.ts` › "How to work gives every hard rule its reason" › "the no-survey rule says the brief holds what the step needs and other units are not this unit's".
- Only brief/done/ask/stuck, read-only commands included (AC2): same describe › "the four-commands rule says why, read-only commands included".
- Run state → `corrupt`, push has no receipt, switch leaves the unit's branch (AC3): same describe › "the run state, no-push and no-switch rules say what breaks".
- Every rendered hard rule has a non-empty reason from the one list (AC4): same describe › "every hard rule comes from the one list, each with a non-empty reason after it" (an entry with an empty reason fails it).
- All four went red first (module missing), then green. `bun run test` 1563 pass, `bun run typecheck` clean.
- Brief snapshots changed only in the five rule lines (17 snapshots × 5 lines); nothing else in them moved.

Traceability (review #1, all at seam S1, the brief renderer):

| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| AC1 | the no-survey rule says the brief holds what the step needs, a survey spends context, other units' state isn't this unit's | test | `packages/core/test/unit/brief.test.ts` › "How to work gives every hard rule its reason" › "the no-survey rule says the brief holds what the step needs and other units are not this unit's" |
| AC2 | the only-four-commands rule says why, read-only `norn status --json` / `norn story view` included | test | same describe › "the four-commands rule says why, read-only commands included" |
| AC3 | run state edit → `corrupt`; push outside norn has no receipt; a switch leaves the unit's branch | test | same describe › "the run state, no-push and no-switch rules say what breaks" |
| AC4 | every rendered hard rule has a non-empty reason, all from the one list (an empty reason fails a test) | test | same describe › "every hard rule comes from the one list, each with a non-empty reason after it" |

## Easy to miss

- The reasons have no closing period: the renderer adds it, and a hook will reuse the bare clause.
- A reason must not name a step of any shipped workflow (`assets.test.ts` › "the brief's protocol name no step of any template"): "review" tripped it once.
- `test/repo/repo.test.ts` › "only runs/ off limits" now reads the rule before its " — " reason, since the reason holds the `corrupt` code span.

## Not proven yet

- Nothing for this slice. The hooks' use of the list is gh-301/05–07.

## Notes

- Seven hard rules: no-survey, this-step (work only in this worktree and step), four-commands, no-push, no-switch, no-remote-write, no-run-state. The handoff and naming bullets are guidance, not hard rules, so they have no entry.
- The no-survey entry's rule is the "This brief is complete…" sentence only; "Read the Inputs…" stays guidance in front of it in the bullet.
- The four-commands bullet keeps its trailing "it is rendered from the unit's state each time"; its reason now says nearly the same. Left in place so the snapshot diff is only the added reasons; gh-301/03 rewrites that bullet anyway.

## Resume

Review #1 approved with no findings; next is whatever step the workflow gives after review.
