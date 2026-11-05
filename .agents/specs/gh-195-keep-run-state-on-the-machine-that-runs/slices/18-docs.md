---
id: gh-195/18
title: Docs say where run state lives and when it leaves the machine
depends_on: [ gh-195/07, gh-195/09, gh-195/11, gh-195/12, gh-195/13, gh-195/14, gh-195/15, gh-195/17 ]
status: active
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: agent }
---

## Goal
The README, `docs/`, CONTRIBUTING, AGENTS.md and the bundled skills describe run state in the machine dir, the record ref, the two record policies, takeover with and without a record, and superseded records, matching the rules refine already amended.

## Scope
Behaviour: B38. Seams: S3. Out: `.agents/RULES.md` beyond what the slice gate decided (amended in refine; touch it only to fix what a behaviour slice found wrong, and to bring T7a and R2.3 in line with D11 as amended: only a takeover without a release supersedes a local record; and to add `Norn-Outcome` and `Norn-Next` to S4's trailer list, D17).

## Acceptance
- AC1 (B38) The docs lint passes: no rule id lost or defined twice (S10 kept, marked retired), every link and anchor resolves, every `norn` command and flag named exists, and no `handoff.md` path outside a unit's run state is named; the generated block of `docs/reference.md` is current. — verifier: test
- AC2 (B38) Reading the docs set, G3, S8, S9, §7 and §7.1, GR6, GR6b, T5, T6, T6a, R3.3, T9, R10.1, C5, RD6, RD7, H2, O6, MO1, T7a and R2.3 and the new S11 and S12 agree with what the built norn does in a throwaway repo (record policy key, ref name, handoff path, superseded folder, "record lost" takeover), and no doc still says run state is committed to the branch or kept on the base. — verifier: agent

## Checks
- `bun run test`
- `bun run docs:emit && git diff --exit-code docs/reference.md`

## Notes
Lands last so it describes what was built. The docs lint's `handoff.md` check (AGENTS.md) may need its allowed location changed to `handoffs/`; change the lint in this slice, not before.
