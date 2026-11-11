# gh-337 — handoff

## Goal

Make a base move under a story cheap, automatic and reviewable, and make each rework loop cost one CI run: all nine changes from the issue, in this one story.

## Proof

- spec.md: 76 user stories, Plan seams S1–S5, D1–D14; 14 slices integrated; 77 criteria in frontmatter.
- Review #1: unit 1895 pass, typecheck green; QA #1's two findings (02.AC3 takeover merge, 03 push-rule test) fixed, integration files re-run green.
- Traceability: full test names in review evidence `traceability.md`. Test files: RR release-record, HR heads-ref, PRT push-rule, OG open-pr-guard, BSI base-side, RV reverify, OV overlap, RG regenerate, IN integrate, AM ask-mid-merge (cli integration); BS base-sync, UO update-outcome, CA carried-approval (core unit); LR cli unit light-route; LP e2e light-path; contract git.ts in adapters. Fn = review finding.

| Criterion | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| 01.AC1 | release pushes the same branches and record in the same order | test | RR |
| 01.AC2 | a person's push is merged at handoff, watch exit or close, never rebased | test | RR |
| 01.AC3 | update outcome done/conflict chosen in core | test | UO |
| 02.AC1 | no PR: branch plus heads ref in one push | test | HR |
| 02.AC2 | remote policy: Norn-Branch-Commit names the heads ref | test | HR |
| 02.AC3 | takeover resumes from the heads ref merged with the remote branch | test | HR · F13 |
| 02.AC4 | heads ref removed at cleanup, close, tidy; no config key | test | decide.test.ts, HR, ids-config.test.ts |
| 02.AC5 | limitations note on local-policy crash loss | agent | QA (agent) |
| 03.AC1 | PR open: boundaries move only the heads ref | test | decide.test.ts, PRT |
| 03.AC2 | update merges locally, heads ref only | test | PRT |
| 03.AC3 | open-pr pushes the branch before the PR; the PR shows that head | test | PRT · F15 |
| 03.AC4 | ready approve pushes nothing | test | PRT |
| 03.AC5 | handoff and watch exit push heads only; close pushes the branch first | test | PRT |
| 03.AC6 | a person's push and local boundaries are merged | test | PRT |
| 03.AC7 | transcript: one branch push per loop | test | test/e2e/base-sync.test.ts |
| 04.AC1 | merge type validates with stale only | test | BS |
| 04.AC2 | story/quick/release ready approve → merge | test | assets.test.ts |
| 04.AC3 | one merge item, no gate item | test | BS |
| 04.AC4 | merged/closed PR as today | test | BS |
| 04.AC5 | stale after a sync via stale_loop | test | BS |
| 04.AC6 | approve/reject refused at merge | test | merge-step.test.ts |
| 04.AC7 | no merge step: update-branch merge item as today | test | BS |
| 04.AC8 | update-branch at merge brings the base in | test | merge-step.test.ts |
| 04.AC9 | docs reference, concepts, recipe | agent | QA (agent) |
| 05.AC1 | static guard refuses agent/update path to a gate without open-pr | test | OG · F14 |
| 05.AC2 | code change the PR lacks → back to open-pr | test | OG |
| 05.AC3 | PR head at merge is the commit ci watched | test | OG |
| 06.AC1 | story edit refused with update_branch_instead | test | story-edit-update-branch.test.ts |
| 06.AC2 | other workflow / --at / no conflict still start a round | test | story-edit-update-branch.test.ts |
| 06.AC3 | AGENTS.md and recipe point at update-branch | agent | QA (agent) |
| 07.AC1 | only base merges + spec-folder commits → clean/resolved | test | UO, LP |
| 07.AC2 | implement work since approval → done | test | UO, LP |
| 07.AC3 | spec.md changed → done | test | UO, LP |
| 07.AC4 | unrouted → done | test | UO |
| 07.AC5 | deterministic; head_sha and git summary recorded | test | LP |
| 07.AC6 | git port remerge-diff and paths; old git never clean | test | contract git.ts, git.test.ts, UO |
| 08.AC1 | shipped light route validates, routes, test command once | test | LR · F1 |
| 08.AC2 | resolution input lists remerge-diff per merge | test | brief.test.ts |
| 08.AC3 | clean skips the resolution review | test | LR |
| 08.AC4 | resolution changes_requested → resolve | test | LR |
| 08.AC5 | approve → open-pr keeps body; redescribe → describe | test | LR · F9 |
| 08.AC6 | YAML anchor gives both steps the same command | test | LR |
| 09.AC1 | only clean since ready approve + green → carried approve | test | CA, ready-since.test.ts |
| 09.AC2 | any resolved → waits for a person | test | CA |
| 09.AC3 | ready item, brief, PR evidence list remerge-diffs | test | CA · F9 |
| 09.AC4 | red test or CI → never carried | test | CA |
| 10.AC1 | brief lists base commits per conflicting path | test | BSI, contract git.ts |
| 10.AC2 | trailer-less commit listed without a story | test | BSI |
| 10.AC3 | base-update section shows the base side | test | BSI |
| 10.AC4 | shipped resolve takes base_side, both copies | test | assets.test.ts, test/repo/process.test.ts |
| 10.AC5 | norn-merge reads the base side first | agent | QA (agent) |
| 11.AC1 | base.verify validation; shipped set to test | test | BS, assets.test.ts |
| 11.AC2 | clean base move runs verify on merged tree, pushes nothing | test | RV, BS |
| 11.AC3 | cached per (head, base) | test | BS |
| 11.AC4 | no free check slot → waits | test | BS |
| 11.AC5 | red → stale edge, last_check, counter max | test | BS, RV |
| 11.AC6 | green leaves it waiting | test | BS |
| 11.AC7 | no base.verify → no run | test | BS |
| 12.AC1 | one Check item naming both stories and paths | test | OV |
| 12.AC2 | ineligible stories never compared | test | OV |
| 12.AC3 | unmoved heads not recomputed | test | OV |
| 12.AC4 | item clears; no dismiss, no merge order | test | OV |
| 12.AC5 | spec-folder-only conflicts give no item | test | OV |
| 13.AC1 | regenerate key loads; malformed refused | test | config.test.ts |
| 13.AC2 | all mapped → base side, commands bounded, Norn-Regenerated, no agent | test | RG, IN |
| 13.AC3 | unmapped conflict → resolve | test | IN |
| 13.AC4 | failed/timed-out command → resolve with output | test | IN, RG |
| 13.AC5 | spec-folder-only branch takes base side | test | IN |
| 13.AC6 | regenerated clean only with trailer + mapped remerge | test | UO |
| 13.AC7 | git port merges keeping conflicts (contract) | test | contract git.ts |
| 13.AC8 | this repo maps schema:emit and docs:emit; docs | agent | QA (agent) |
| 14.AC1 | brief offers norn ask mid-merge | test | BS |
| 14.AC2 | answer resumes with merge in progress | test | AM, BS |
| 14.AC3 | watch exit keeps that claim, not blocked | test | AM |
| 14.AC4 | handoff refused merge_in_progress | test | AM |
| 14.AC5 | abort + stuck as today | test | BS |
| 14.AC6 | norn-merge says when to ask or abort | agent | QA (agent) |

## Easy to miss

- Light-path anchor = latest `approve` at any step; human-qa has `stale: update`, and a gate goes stale on a local conflict even with no PR.
- Heads ref is pushed at every boundary; while the PR is open it replaces the branch push. Only open-pr pushes the branch; `story close` pushes the branch first.

## Not proven yet

- F1 (blocking, 08.AC1 / light path): a conflicting base move at human-qa (or anywhere before the PR exists) takes the light route and skips the human-qa gate and describe. No test covers it.
- No UNTRACED criterion. Agent-verified: 02.AC5, 04.AC9, 06.AC3, 10.AC5, 13.AC8, 14.AC6.

## Notes

- Review #1: 15 findings, 1 blocking (F1); the minor and nit findings (F2–F15) are notes for the person, not rework (findings file in review evidence).
- Takeover: a divergence is merged only while the PR is open.
- No GitPort fake exists: 07.AC6/13.AC7 run against the real adapter only.
- Friction: a fresh worktree needs `bun install`.

## Resume

Fix F1 in `packages/core/src/update-outcome.ts` (or its caller `act/git-step.ts:69`): `clean`/`resolved` only when open-pr has a done receipt after the anchor in this round, else `done`. Red-first core test: round 1, review approve → test → qa partial → human-qa, conflicting base move → update ends `done`.
