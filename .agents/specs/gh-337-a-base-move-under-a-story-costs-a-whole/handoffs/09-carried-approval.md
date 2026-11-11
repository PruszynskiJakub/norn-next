## Goal
A person who approved at `ready` is not asked again when only clean base merges happened and test and CI are green; a resolved merge asks again and shows only what the resolver changed (remerge-diff commands in the ready item, the brief and the PR body).

## Proof
`bun run test` and `bun run typecheck` are green (test#1 pass); `bun run schema:emit` run (approve receipt gains `carried`). Review #1: approve, no blocking findings.

| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| AC1 | approved at ready, only `clean` updates since, test and CI green → norn approves itself, receipt marked carried, History "approval carried: clean base merge" | test | `packages/core/test/unit/carried-approval.test.ts` › "norn approves on its own with a receipt marked carried…", "History shows the approval as carried, not as a person's", "two clean base moves in a row still carry…", "while it carries, the inbox shows no approve item…", "without the measured story head…"; rule case `gate.carried`; wiring `packages/store/test/unit/ready-since.test.ts` › "a clean update since the ready approval, then a green check: it carries" |
| AC2 | any update since the last ready approve ended `resolved` → waits for a person's approval | test | carried-approval.test.ts › "a resolved update waits for a person's approval", "a resolved update followed by a clean one still asks", "once the person approves again, the next clean merge carries that approval"; ready-since.test.ts › "a resolved update since the ready approval…" |
| AC3 | after a resolution, the ready item, the brief and the PR evidence list the remerge-diff commands of the merges since the last approval | test | carried-approval.test.ts › "the approve item names one git show --remerge-diff per merge…", "a step after a resolved base merge sees one git show --remerge-diff…", "open-pr after a resolved base merge puts one git show --remerge-diff… in the PR body" (S1; Plan's S3 row not written, see Not proven yet) |
| AC4 | a clean merge whose test or CI is red never reaches ready with a carried approval | test | carried-approval.test.ts › "a red merge test sends the story to implement…", "a red CI after a clean merge…", "no check passed since the last clean update: nothing to carry" |

## Easy to miss
- `readySince` (`packages/core/src/ready-carry.ts`) is the one rule: window = receipts after the latest ready `approve` (voided by an `update`/`workflow` re-entry receipt, as `readyApproval` already did). Carry only when every receipt in the window is quiet (update classify `clean`, gate/merge classify `stale`, other git step `done`, check `pass`/`stale`, `mode`/`take`) and a check passed after the last update. Any agent report, red check, reject, `resolved`/`done` update → a person approves.
- The carried approve's `head_sha` is `story.base.head`; without base facts there is no carry (fail closed). That head anchors the next light-path update.
- `RE_ENTRY_KINDS` and the ready-gate test moved from `inbox/items.ts` to `ready-carry.ts` (`isReadyGate`, `readyApprovalReceipt`); `readyApproval` keeps its behaviour.
- A carried approval leaves open notes open (it acknowledges none).

## Not proven yet
- Review minor F2 (S3 for the remerge-diff evidence): the plan maps it to S3 integration; only S1 tests exist. act appends `pr.body` after pr.md (`packages/cli/src/runtime/act/git-step.ts:13`), so the wiring holds when read.
- Review minor F1 (view shows carried approve as plain approve): `packages/view/src/timeline.ts:43` and `steps.ts:192` render a carried approve as "approve ready", with nothing to say it was carried; the brief's History does mark it.
- No integration/e2e test on real git for the carried approval (S3); the store test covers the file reading, decide is covered at S1. The shipped story/quick light route is slice 08's; this slice used a scripted light workflow.

## Notes
- Merges listed are every merge in the light-path update receipts' `history` since the ready approval, deduped, oldest first (clean ones included), shown only when one update ended `resolved`.
- Slice 13 (regenerate): a regenerated merge already reaches here as an update `clean`; nothing to change in `readySince`.
- Slice 08 adds the `resolution` input from the light anchor; `remergeCommands` in ready-carry.ts can serve it.
- Cost: store reads the receipts after the ready approval each observe; after a ready reject that window grows through the rework loop until the next approval.
- Docs: one paragraph in docs/recipes.md "The base moved under a story".

## Resume
Review #1 approved (findings in the receipt, both minor); next is QA of this slice against the table above.
