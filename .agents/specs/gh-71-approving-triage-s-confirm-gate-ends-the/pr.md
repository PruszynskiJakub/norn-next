## Summary

A story now goes through numbered **rounds**, one workflow after another on the same issue, branch, worktree and PR. `$done` ends a round, not the story. Approving triage's `confirm` gate no longer strands the story: `norn story edit gh-N --workflow <name>` starts the next round. A closed issue with no PR and no unfinished round now ends the story by itself.

```diff
 story gh-61
   runs/_story/
     handoff.md                       # one handoff, shared by every round
-    state.json  workflow.yaml  receipts/ ...
+    rounds/01-triage/  state.json (ended: workflow | person)  workflow.yaml  receipts/0001… 
+    rounds/02-story/   state.json (counters 0, mode carried)   workflow.yaml  receipts/0001…

 norn story edit gh-61 --workflow story [--at s] [--force]
-  done story            → refused (unit_done)
-  unfinished story      → switch workflow in place
+  finished round        → write a 'round' receipt; next tick: round.start (new folder, label swap)
+  unfinished round      → refused (round_unfinished) unless --force
+  --force               → refused while an agent runs (agent_running) or a slice is unfinished
 norn story edit gh-61 --at s           # now: move the cursor inside the current round

 decide on a finished round
-  GR6: "workflow done — waiting for the PR merge" forever; GR7 could rewrite $done to stuck
+  no PR      → Your turn: "gh-61: triage round done, no PR"  (story.round_done)
+  open PR    → "Merge PR #N" as before
+  issue seen closed, no PR, no unfinished slice → story closed as `norn story close` does (GR6b)
+  flat record from an older norn → round.migrate: git mv into rounds/01-<wf>/, one commit
```

PRD amended: §5 (*round*), §7, S7, W7, W9, new §11.1 (RD1–RD8), GR6b, GR7. Prefactors: one record-folder resolver in `packages/store/src/paths.ts`, `story close`'s effects as a runtime function, a label-replace method on the remote port (gh, glab, fake; contract runs).

## Evidence

QA (qa#2, on 1a2816c57) drove `norn` commands and `norn tick` through the cli harness (real git, bare remote, fake GitHub remote, fake runner and clock). All 36 criteria pass: [report](https://github.com/PruszynskiJakub/norn-next/blob/gh-71-approving-triage-s-confirm-gate-ends-the/.agents/specs/gh-71-approving-triage-s-confirm-gate-ends-the/runs/_story/evidence/01M6C2C629170XM79YHKC1AMYD/report.md), [criteria.json](https://github.com/PruszynskiJakub/norn-next/blob/gh-71-approving-triage-s-confirm-gate-ends-the/.agents/specs/gh-71-approving-triage-s-confirm-gate-ends-the/runs/_story/evidence/01M6C2C629170XM79YHKC1AMYD/criteria.json). Tiers: unit 1022, integration 557, e2e 72 pass, typecheck clean ([int.log](https://github.com/PruszynskiJakub/norn-next/blob/gh-71-approving-triage-s-confirm-gate-ends-the/.agents/specs/gh-71-approving-triage-s-confirm-gate-ends-the/runs/_story/evidence/01M6C2C629170XM79YHKC1AMYD/int.log), [e2e.log](https://github.com/PruszynskiJakub/norn-next/blob/gh-71-approving-triage-s-confirm-gate-ends-the/.agents/specs/gh-71-approving-triage-s-confirm-gate-ends-the/runs/_story/evidence/01M6C2C629170XM79YHKC1AMYD/e2e.log)).

- **B1** Every workflow is a numbered round of one story
  **Before:** one workflow per story.
  **After:** gh-61 ran rounds 1–3 on one branch, `rounds/01-triage/`, `02-story/`… ([B6](https://github.com/PruszynskiJakub/norn-next/blob/gh-71-approving-triage-s-confirm-gate-ends-the/.agents/specs/gh-71-approving-triage-s-confirm-gate-ends-the/runs/_story/evidence/01M6C2C629170XM79YHKC1AMYD/B6.md), [B30](https://github.com/PruszynskiJakub/norn-next/blob/gh-71-approving-triage-s-confirm-gate-ends-the/.agents/specs/gh-71-approving-triage-s-confirm-gate-ends-the/runs/_story/evidence/01M6C2C629170XM79YHKC1AMYD/B30.md), [B29](https://github.com/PruszynskiJakub/norn-next/blob/gh-71-approving-triage-s-confirm-gate-ends-the/.agents/specs/gh-71-approving-triage-s-confirm-gate-ends-the/runs/_story/evidence/01M6C2C629170XM79YHKC1AMYD/B29.md))
- **B2** `$done` ends the round, not the story
  **Before:** `story approve` at `confirm` → story done, stranded.
  **After:** round 1 state `$done`, spec still `status: active`, worktree and claim kept ([B2](https://github.com/PruszynskiJakub/norn-next/blob/gh-71-approving-triage-s-confirm-gate-ends-the/.agents/specs/gh-71-approving-triage-s-confirm-gate-ends-the/runs/_story/evidence/01M6C2C629170XM79YHKC1AMYD/B2.md))
- **B3** Fresh counters per round
  **Before:** n/a. **After:** round 2 starts with `counters: {fix: 0}` ([B3](https://github.com/PruszynskiJakub/norn-next/blob/gh-71-approving-triage-s-confirm-gate-ends-the/.agents/specs/gh-71-approving-triage-s-confirm-gate-ends-the/runs/_story/evidence/01M6C2C629170XM79YHKC1AMYD/B3.md))
- **B4** Branch, worktree and PR kept; a later `open-pr` updates the open PR
  **Before:** n/a. **After:** same worktree, PR body updated, no second PR ([B4](https://github.com/PruszynskiJakub/norn-next/blob/gh-71-approving-triage-s-confirm-gate-ends-the/.agents/specs/gh-71-approving-triage-s-confirm-gate-ends-the/runs/_story/evidence/01M6C2C629170XM79YHKC1AMYD/B4.md))
- **B5** Mode carries over
  **Before:** n/a. **After:** `manual` round 1 → `manual` round 2 ([B5](https://github.com/PruszynskiJakub/norn-next/blob/gh-71-approving-triage-s-confirm-gate-ends-the/.agents/specs/gh-71-approving-triage-s-confirm-gate-ends-the/runs/_story/evidence/01M6C2C629170XM79YHKC1AMYD/B5.md))
- **B6** `--workflow` on a finished round starts a new round
  **Before:** refused, `unit_done`. **After:** round 2 at `refine`, Your turn in the inbox ([B6](https://github.com/PruszynskiJakub/norn-next/blob/gh-71-approving-triage-s-confirm-gate-ends-the/.agents/specs/gh-71-approving-triage-s-confirm-gate-ends-the/runs/_story/evidence/01M6C2C629170XM79YHKC1AMYD/B6.md))
- **B7** A new round with an open PR
  **Before:** n/a. **After:** round starts; the story still ends only on merge ([B7](https://github.com/PruszynskiJakub/norn-next/blob/gh-71-approving-triage-s-confirm-gate-ends-the/.agents/specs/gh-71-approving-triage-s-confirm-gate-ends-the/runs/_story/evidence/01M6C2C629170XM79YHKC1AMYD/B7.md))
- **B8** Same workflow again as a new round
  **After:** triage → round 2 triage at `explore` ([B8](https://github.com/PruszynskiJakub/norn-next/blob/gh-71-approving-triage-s-confirm-gate-ends-the/.agents/specs/gh-71-approving-triage-s-confirm-gate-ends-the/runs/_story/evidence/01M6C2C629170XM79YHKC1AMYD/B8.md))
- **B9** `--workflow X --at s` starts at that step; unknown step refused
  **After:** round at `sync`; `--at nope` exit 3, nothing written ([B9](https://github.com/PruszynskiJakub/norn-next/blob/gh-71-approving-triage-s-confirm-gate-ends-the/.agents/specs/gh-71-approving-triage-s-confirm-gate-ends-the/runs/_story/evidence/01M6C2C629170XM79YHKC1AMYD/B9.md))
- **B10** Unfinished round without `--force` is refused
  **Before:** workflow switched in place. **After:** exit 3, `round_unfinished`, `do_instead: norn story edit gh-61 --workflow story --force`; state unchanged ([B10](https://github.com/PruszynskiJakub/norn-next/blob/gh-71-approving-triage-s-confirm-gate-ends-the/.agents/specs/gh-71-approving-triage-s-confirm-gate-ends-the/runs/_story/evidence/01M6C2C629170XM79YHKC1AMYD/B10.md))
- **B11** `--force` ends the round and starts the next
  **After:** gh-71 from `confirm` → round 2 at `refine`; gh-30 from `$stuck` → `--at sync` ([B11](https://github.com/PruszynskiJakub/norn-next/blob/gh-71-approving-triage-s-confirm-gate-ends-the/.agents/specs/gh-71-approving-triage-s-confirm-gate-ends-the/runs/_story/evidence/01M6C2C629170XM79YHKC1AMYD/B11.md))
- **B12** `--force` refused while an agent runs
  **After:** exit 3, `agent_running`, `do_instead: norn run cancel gh-31` ([B12](https://github.com/PruszynskiJakub/norn-next/blob/gh-71-approving-triage-s-confirm-gate-ends-the/.agents/specs/gh-71-approving-triage-s-confirm-gate-ends-the/runs/_story/evidence/01M6C2C629170XM79YHKC1AMYD/B12.md))
- **B13** `--force` refused while a slice is unfinished; finished slices don't block ([B13](https://github.com/PruszynskiJakub/norn-next/blob/gh-71-approving-triage-s-confirm-gate-ends-the/.agents/specs/gh-71-approving-triage-s-confirm-gate-ends-the/runs/_story/evidence/01M6C2C629170XM79YHKC1AMYD/B13.md))
- **B14** `--force` on a finished round = without it ([B14](https://github.com/PruszynskiJakub/norn-next/blob/gh-71-approving-triage-s-confirm-gate-ends-the/.agents/specs/gh-71-approving-triage-s-confirm-gate-ends-the/runs/_story/evidence/01M6C2C629170XM79YHKC1AMYD/B14.md))
- **B15** `--at` alone moves inside the round, counters kept; unknown step refused ([B15](https://github.com/PruszynskiJakub/norn-next/blob/gh-71-approving-triage-s-confirm-gate-ends-the/.agents/specs/gh-71-approving-triage-s-confirm-gate-ends-the/runs/_story/evidence/01M6C2C629170XM79YHKC1AMYD/B15.md))
- **B16** `--at` alone on a finished round refused, points to `--workflow` ([B16](https://github.com/PruszynskiJakub/norn-next/blob/gh-71-approving-triage-s-confirm-gate-ends-the/.agents/specs/gh-71-approving-triage-s-confirm-gate-ends-the/runs/_story/evidence/01M6C2C629170XM79YHKC1AMYD/B16.md))
- **B17** Unknown workflow refused (`unknown_workflow`) even with `--force`; round untouched ([B17](https://github.com/PruszynskiJakub/norn-next/blob/gh-71-approving-triage-s-confirm-gate-ends-the/.agents/specs/gh-71-approving-triage-s-confirm-gate-ends-the/runs/_story/evidence/01M6C2C629170XM79YHKC1AMYD/B17.md))
- **B18** Refused while another machine holds the claim, with holder and `story checkout` ([B18](https://github.com/PruszynskiJakub/norn-next/blob/gh-71-approving-triage-s-confirm-gate-ends-the/.agents/specs/gh-71-approving-triage-s-confirm-gate-ends-the/runs/_story/evidence/01M6C2C629170XM79YHKC1AMYD/B18.md))
- **B19** Issue label follows the round
  **After:** fake remote recorded `label 61 -norn:wf:triage +norn:wf:story`; an edited label started nothing ([B19](https://github.com/PruszynskiJakub/norn-next/blob/gh-71-approving-triage-s-confirm-gate-ends-the/.agents/specs/gh-71-approving-triage-s-confirm-gate-ends-the/runs/_story/evidence/01M6C2C629170XM79YHKC1AMYD/B19.md))
- **B20** Failed label update warns only
  **After:** round 2 started; output and trace carry `label norn:wf:triage → norn:wf:story not updated: gh: could not connect` ([B20](https://github.com/PruszynskiJakub/norn-next/blob/gh-71-approving-triage-s-confirm-gate-ends-the/.agents/specs/gh-71-approving-triage-s-confirm-gate-ends-the/runs/_story/evidence/01M6C2C629170XM79YHKC1AMYD/B20.md))
- **B21** Merging the PR ends the story in any round, cleanup as today ([B21-C](https://github.com/PruszynskiJakub/norn-next/blob/gh-71-approving-triage-s-confirm-gate-ends-the/.agents/specs/gh-71-approving-triage-s-confirm-gate-ends-the/runs/_story/evidence/01M6C2C629170XM79YHKC1AMYD/B21-C.md))
- **B22** Closed issue, no PR, finished round → norn closes the story
  **Before:** sat under "waiting for the PR merge" forever. **After:** `tick --sync` → `remote.issue_closed`; branch pushed, worktree, branch, claim and refs gone, out of the inbox ([B22-C](https://github.com/PruszynskiJakub/norn-next/blob/gh-71-approving-triage-s-confirm-gate-ends-the/.agents/specs/gh-71-approving-triage-s-confirm-gate-ends-the/runs/_story/evidence/01M6C2C629170XM79YHKC1AMYD/B22-C.md))
- **B23** Such a story reopens at its finished round; `--workflow` then starts round 2 ([B23-C](https://github.com/PruszynskiJakub/norn-next/blob/gh-71-approving-triage-s-confirm-gate-ends-the/.agents/specs/gh-71-approving-triage-s-confirm-gate-ends-the/runs/_story/evidence/01M6C2C629170XM79YHKC1AMYD/B23-C.md), [B23](https://github.com/PruszynskiJakub/norn-next/blob/gh-71-approving-triage-s-confirm-gate-ends-the/.agents/specs/gh-71-approving-triage-s-confirm-gate-ends-the/runs/_story/evidence/01M6C2C629170XM79YHKC1AMYD/B23.md))
- **B24** Closed issue with an unfinished round still parks `remote: issue closed` ([B24-C](https://github.com/PruszynskiJakub/norn-next/blob/gh-71-approving-triage-s-confirm-gate-ends-the/.agents/specs/gh-71-approving-triage-s-confirm-gate-ends-the/runs/_story/evidence/01M6C2C629170XM79YHKC1AMYD/B24-C.md))
- **B25** Finished round, no PR → Your turn item
  **Before:** "workflow done — waiting for the PR merge (GR6)". **After:** `gh-61: triage round done, no PR`, command `norn story edit gh-61 --workflow <name>` ([B25](https://github.com/PruszynskiJakub/norn-next/blob/gh-71-approving-triage-s-confirm-gate-ends-the/.agents/specs/gh-71-approving-triage-s-confirm-gate-ends-the/runs/_story/evidence/01M6C2C629170XM79YHKC1AMYD/B25.md))
- **B26** The item stays generic (`<name>`, no recommendation) ([B26](https://github.com/PruszynskiJakub/norn-next/blob/gh-71-approving-triage-s-confirm-gate-ends-the/.agents/specs/gh-71-approving-triage-s-confirm-gate-ends-the/runs/_story/evidence/01M6C2C629170XM79YHKC1AMYD/B26.md))
- **B27** Finished round with an open PR keeps the merge item
  **After:** `gh-33 round 2 · quick · Merge PR #100 (still a draft)` before any sync ([B27](https://github.com/PruszynskiJakub/norn-next/blob/gh-71-approving-triage-s-confirm-gate-ends-the/.agents/specs/gh-71-approving-triage-s-confirm-gate-ends-the/runs/_story/evidence/01M6C2C629170XM79YHKC1AMYD/B27.md), [B27-C](https://github.com/PruszynskiJakub/norn-next/blob/gh-71-approving-triage-s-confirm-gate-ends-the/.agents/specs/gh-71-approving-triage-s-confirm-gate-ends-the/runs/_story/evidence/01M6C2C629170XM79YHKC1AMYD/B27-C.md))
- **B28** Round shown in status, story view, handoff header
  **After:** `round 1 · triage · …` in `norn status`; handoff `Round 2 · Workflow: story · Step: refine (attempt 1)` ([B28](https://github.com/PruszynskiJakub/norn-next/blob/gh-71-approving-triage-s-confirm-gate-ends-the/.agents/specs/gh-71-approving-triage-s-confirm-gate-ends-the/runs/_story/evidence/01M6C2C629170XM79YHKC1AMYD/B28.md))
- **B29** `run list` groups by round and says how each ended
  **After:** `round 1 · triage · ended by the person at confirm` / `round 2 · story` ([B29](https://github.com/PruszynskiJakub/norn-next/blob/gh-71-approving-triage-s-confirm-gate-ends-the/.agents/specs/gh-71-approving-triage-s-confirm-gate-ends-the/runs/_story/evidence/01M6C2C629170XM79YHKC1AMYD/B29.md))
- **B30** Each round in its own folder, receipts from 0001 ([B30](https://github.com/PruszynskiJakub/norn-next/blob/gh-71-approving-triage-s-confirm-gate-ends-the/.agents/specs/gh-71-approving-triage-s-confirm-gate-ends-the/runs/_story/evidence/01M6C2C629170XM79YHKC1AMYD/B30.md))
- **B31** One shared `runs/_story/handoff.md`, Goal / Progress / Resume carried over ([B31](https://github.com/PruszynskiJakub/norn-next/blob/gh-71-approving-triage-s-confirm-gate-ends-the/.agents/specs/gh-71-approving-triage-s-confirm-gate-ends-the/runs/_story/evidence/01M6C2C629170XM79YHKC1AMYD/B31.md))
- **B32** How a round ended recorded in its folder (`ended` by person at step) ([B32](https://github.com/PruszynskiJakub/norn-next/blob/gh-71-approving-triage-s-confirm-gate-ends-the/.agents/specs/gh-71-approving-triage-s-confirm-gate-ends-the/runs/_story/evidence/01M6C2C629170XM79YHKC1AMYD/B32.md), [B11](https://github.com/PruszynskiJakub/norn-next/blob/gh-71-approving-triage-s-confirm-gate-ends-the/.agents/specs/gh-71-approving-triage-s-confirm-gate-ends-the/runs/_story/evidence/01M6C2C629170XM79YHKC1AMYD/B11.md))
- **B33** Slices stay at `runs/<nn>-<slug>/` and record round 2 ([B33](https://github.com/PruszynskiJakub/norn-next/blob/gh-71-approving-triage-s-confirm-gate-ends-the/.agents/specs/gh-71-approving-triage-s-confirm-gate-ends-the/runs/_story/evidence/01M6C2C629170XM79YHKC1AMYD/B33.md)). Not shown: a third round adding new slice numbers was not exercised.
- **B34** Flat record moved on first tick
  **After:** `round.migrate` → files `git mv`ed into `rounds/01-triage/` in one pushed commit, unit goes on at its step ([B34](https://github.com/PruszynskiJakub/norn-next/blob/gh-71-approving-triage-s-confirm-gate-ends-the/.agents/specs/gh-71-approving-triage-s-confirm-gate-ends-the/runs/_story/evidence/01M6C2C629170XM79YHKC1AMYD/B34.md))
- **B35** Old "done, no PR" stories become a finished round 1 with the Your turn item ([B35](https://github.com/PruszynskiJakub/norn-next/blob/gh-71-approving-triage-s-confirm-gate-ends-the/.agents/specs/gh-71-approving-triage-s-confirm-gate-ends-the/runs/_story/evidence/01M6C2C629170XM79YHKC1AMYD/B35.md))
- **B36** Merged flat records read as round 1, nothing written ([B36](https://github.com/PruszynskiJakub/norn-next/blob/gh-71-approving-triage-s-confirm-gate-ends-the/.agents/specs/gh-71-approving-triage-s-confirm-gate-ends-the/runs/_story/evidence/01M6C2C629170XM79YHKC1AMYD/B36.md))

QA notes, no verdict change: on a sync that only re-acquired an expired claim, a closed-issue story showed a Check item instead of closing (it closes on the next sync that sees the issue); `run list` labels an `--at` move "workflow switched"; the round-done status line repeats the id and `$done`.

## Merge danger

**Door:** one-way: the first tick of this norn `git mv`s every in-progress story's flat `runs/_story/` record into `rounds/01-<wf>/` and pushes it, and receipts gain a `round` kind; a reverted (older) norn does not read that layout. Records already merged into the base are never rewritten.

**Blast radius:** every active story: the record move on each held story branch on upgrade; `story edit --workflow` on an unfinished story now refuses without `--force` (callers/scripts relying on in-place switch); the GR6 "waiting for the PR merge" item is replaced; closed issues with no PR are now cleaned up automatically.
