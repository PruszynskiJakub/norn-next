# QA gh-337 #3, head cab27ae02

Changes since QA #2 (087e1aae): norn init keeps the test command's YAML anchor; CI tests follow the heads-ref-only push after open-pr; e2e slice-workflow transcript. Every criterion re-checked on this head.

| Criterion | Verdict | Evidence | Note |
|---|---|---|---|
| 01.AC1 release pushes the same branches and record in the same order | pass | 01.AC1.md |  |
| 01.AC2 a person's push is merged at handoff, watch exit or close, never rebased | pass | 01.AC2.md |  |
| 01.AC3 update outcome done/conflict chosen in core | pass | 01.AC3.md |  |
| 02.AC1 no PR: branch plus heads ref in one push | pass | 02.AC1.md |  |
| 02.AC2 remote policy: Norn-Branch-Commit names the heads ref | pass | 02.AC2.md |  |
| 02.AC3 takeover resumes from the heads ref merged with the remote branch | pass | 02.AC3.md | no PR open: a divergence is taken as a rewrite (atomic push) |
| 02.AC4 heads ref removed at cleanup, close, tidy; no config key | pass | 02.AC4.md |  |
| 02.AC5 limitations note on local-policy crash loss | pass | 02.AC5.md |  |
| 03.AC1 PR open: boundaries move only the heads ref | pass | 03.AC1.md |  |
| 03.AC2 update merges locally, heads ref only | pass | 03.AC2.md |  |
| 03.AC3 open-pr pushes the branch before the PR; the PR shows that head | pass | 03.AC3.md |  |
| 03.AC4 ready approve pushes nothing | pass | 03.AC4.md |  |
| 03.AC5 handoff and watch exit push heads only; close pushes the branch first | pass | 03.AC5.md |  |
| 03.AC6 a person's push and local boundaries are merged | pass | 03.AC6.md |  |
| 03.AC7 transcript: one branch push per loop | pass | 03.AC7.md |  |
| 04.AC1 merge type validates with stale only | pass | 04.AC1.md |  |
| 04.AC2 story/quick/release ready approve → merge | pass | 04.AC2.md |  |
| 04.AC3 one merge item, no gate item | pass | 04.AC3.md |  |
| 04.AC4 merged/closed PR as today | pass | 04.AC4.md |  |
| 04.AC5 stale after a sync via stale_loop | pass | 04.AC5.md |  |
| 04.AC6 approve/reject refused at merge | pass | 04.AC6.md |  |
| 04.AC7 no merge step: update-branch merge item as today | pass | 04.AC7.md |  |
| 04.AC8 update-branch at merge brings the base in | pass | 04.AC8.md |  |
| 04.AC9 docs reference, concepts, recipe | pass | 04.AC9.md |  |
| 05.AC1 static guard refuses agent/update path to a gate without open-pr | pass | 05.AC1.md |  |
| 05.AC2 code change the PR lacks → back to open-pr | pass | 05.AC2.md |  |
| 05.AC3 PR head at merge is the commit ci watched | pass | 05.AC3.md |  |
| 06.AC1 story edit refused with update_branch_instead | pass | 06.AC1.md |  |
| 06.AC2 other workflow / --at / no conflict still start a round | pass | 06.AC2.md |  |
| 06.AC3 AGENTS.md and recipe point at update-branch | pass | 06.AC3.md |  |
| 07.AC1 only base merges + spec-folder commits → clean/resolved | pass | 07.AC1.md |  |
| 07.AC2 implement work since approval → done | pass | 07.AC2.md |  |
| 07.AC3 spec.md changed → done | pass | 07.AC3.md |  |
| 07.AC4 unrouted → done | pass | 07.AC4.md |  |
| 07.AC5 deterministic; head_sha and git summary recorded | pass | 07.AC5.md |  |
| 07.AC6 git port remerge-diff and paths; old git never clean | pass | 07.AC6.md |  |
| 08.AC1 shipped light route validates, routes, test command once | pass | 08.AC1.md, 08.AC1-real-anchor.log | review F1 fixed; checked on real receipts |
| 08.AC2 resolution input lists remerge-diff per merge | pass | 08.AC2.md |  |
| 08.AC3 clean skips the resolution review | pass | 08.AC3.md |  |
| 08.AC4 resolution changes_requested → resolve | pass | 08.AC4.md |  |
| 08.AC5 approve → open-pr keeps body; redescribe → describe | pass | 08.AC5.md |  |
| 08.AC6 YAML anchor gives both steps the same command | pass | 08.AC6.md, 08.AC6-init-anchor.log | init keeps the anchor (CI fix) |
| 09.AC1 only clean since ready approve + green → carried approve | pass | 09.AC1.md |  |
| 09.AC2 any resolved → waits for a person | pass | 09.AC2.md |  |
| 09.AC3 ready item, brief, PR evidence list remerge-diffs | pass | 09.AC3.md |  |
| 09.AC4 red test or CI → never carried | pass | 09.AC4.md |  |
| 10.AC1 brief lists base commits per conflicting path | pass | 10.AC1.md |  |
| 10.AC2 trailer-less commit listed without a story | pass | 10.AC2.md |  |
| 10.AC3 base-update section shows the base side | pass | 10.AC3.md |  |
| 10.AC4 shipped resolve takes base_side, both copies | pass | 10.AC4.md |  |
| 10.AC5 norn-merge reads the base side first | pass | 10.AC5.md |  |
| 11.AC1 base.verify validation; shipped set to test | pass | 11.AC1.md |  |
| 11.AC2 clean base move runs verify on merged tree, pushes nothing | pass | 11.AC2.md |  |
| 11.AC3 cached per (head, base) | pass | 11.AC3.md |  |
| 11.AC4 no free check slot → waits | pass | 11.AC4.md |  |
| 11.AC5 red → stale edge, last_check, counter max | pass | 11.AC5.md |  |
| 11.AC6 green leaves it waiting | pass | 11.AC6.md |  |
| 11.AC7 no base.verify → no run | pass | 11.AC7.md |  |
| 12.AC1 one Check item naming both stories and paths | pass | 12.AC1.md |  |
| 12.AC2 ineligible stories never compared | pass | 12.AC2.md |  |
| 12.AC3 unmoved heads not recomputed | pass | 12.AC3.md |  |
| 12.AC4 item clears; no dismiss, no merge order | pass | 12.AC4.md |  |
| 12.AC5 spec-folder-only conflicts give no item | pass | 12.AC5.md |  |
| 13.AC1 regenerate key loads; malformed refused | pass | 13.AC1.md |  |
| 13.AC2 all mapped → base side, commands bounded, Norn-Regenerated, no agent | pass | 13.AC2.md |  |
| 13.AC3 unmapped conflict → resolve | pass | 13.AC3.md |  |
| 13.AC4 failed/timed-out command → resolve with output | pass | 13.AC4.md |  |
| 13.AC5 spec-folder-only branch takes base side | pass | 13.AC5.md |  |
| 13.AC6 regenerated clean only with trailer + mapped remerge | pass | 13.AC6.md |  |
| 13.AC7 git port merges keeping conflicts (contract) | pass | 13.AC7.md |  |
| 13.AC8 this repo maps schema:emit and docs:emit; docs | pass | 13.AC8.md |  |
| 14.AC1 brief offers norn ask mid-merge | pass | 14.AC1.md |  |
| 14.AC2 answer resumes with merge in progress | pass | 14.AC2.md |  |
| 14.AC3 watch exit keeps that claim, not blocked | pass | 14.AC3.md |  |
| 14.AC4 handoff refused merge_in_progress | pass | 14.AC4.md |  |
| 14.AC5 abort + stuck as today | pass | 14.AC5.md |  |
| 14.AC6 norn-merge says when to ask or abort | pass | 14.AC6.md |  |
