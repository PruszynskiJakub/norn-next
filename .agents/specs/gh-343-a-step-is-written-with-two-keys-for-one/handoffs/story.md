## Goal

A workflow step opens with one head key (`agent:`, `check:`, `gate:`, a value-less verb, `use:`); agent skills become an optional `skills:` list; meanings and verdicts move to sibling `means:` / `verdict:` maps; `norn upgrade` rewrites old-wording files losslessly while old pins keep loading. The spec (spec.md) is refined and confirmed by the owner, no open questions.

## Proof

- spec.md User Stories: 50 stories in six groups (writing a step; orientation and skills; outcomes, meanings and verdicts; the old wording; norn upgrade; shipped workflows and docs). Owner confirmed the interview summary in session.

## Easy to miss

- The per-step key picking the configured agent becomes `by:` (not `runner:`, which in norn means Herdr/headless). Owner may still rename it before the build.
- Old wording is refused only for the main checkout's `.agents/workflows/` (doctor, sync, new round, upgrade). Pins and a workflow file read from a story branch (lost-record restart in `norn story checkout`) load through the same old→new translation upgrade uses; their text and hash on disk are never touched.
- One parser reads both repo files and pins today (`parseWorkflowText`, store `unit.ts`); the two reads must be told apart.
- decide reads `step.skill` in the re-refined-story check (core `decide/story.ts`, `REFINE_SKILLS`): becomes "skills include the refine skill". Golden cases embed workflows: rewrite their embedded workflows, decisions must not change.
- Lossless upgrade: comments, key order, scalar styles kept (yaml Document API); an unplaceable comment refuses only that file (naming file and line), others still rewritten; idempotent; JSON stays JSON.
- Orientation fallback in upgrade: instructions word for word → description → ``Use the `X` skill.``; gate text fallback: prompt → description → "Approve to go on, or reject with what to change." Shipped workflows and this repo's copies (incl. `release.yaml`, no shipped copy) get hand-written orientations instead.

## Not proven yet

- Nothing built. Plan not written.

## Notes

- Decisions and their reasons are in spec.md Further Notes; the design record gist (`quick.yaml`) shows the target wording.
- Owner defaults confirmed: a `like` step inherits its target's head key (writing a different one is refused as two head keys); `norn doctor` reports one issue per old-wording file naming `norn upgrade`.

## Resume

Next step plans spec.md (norn-plan): seams for the old→new translation (shared by upgrade and the pin/branch reader), the schema change, the brief's skill line, and the upgrade rewrite.
