# gh-337 review #1: traceability (full)

Every row names a test the reviewers read and saw assert the criterion. Paths are relative to the repo root.
Abbreviations: RR = packages/cli/test/integration/release-record.test.ts, HR = .../heads-ref.test.ts, PRT = .../push-rule.test.ts,
BS = packages/core/test/unit/base-sync.test.ts, UO = packages/core/test/unit/update-outcome.test.ts, CA = packages/core/test/unit/carried-approval.test.ts,
LR = packages/cli/test/unit/light-route.test.ts, LP = test/e2e/light-path.test.ts, OG = open-pr-guard.test.ts (core unit + cli integration),
BSI = packages/cli/test/integration/base-side.test.ts, RV = .../reverify.test.ts, OV = overlap.test.ts (core unit + cli integration),
RG = .../regenerate.test.ts, IN = .../integrate.test.ts, AM = .../ask-mid-merge.test.ts.

| Criterion | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| 01.AC1 | release pushes the same branches and record in the same order | test | RR › "AC1: under local…", "AC2: a clean watch exit…", "AC2: story close…" |
| 01.AC2 | a person's push is merged at handoff, watch exit or close, never rebased | test | RR › "story handoff merges the person's commit…", "a clean watch exit merges…", "story close merges…" |
| 01.AC3 | update outcome done/conflict chosen in core | test | UO › "a clean merge … ends done", "a conflicting merge ends conflict" |
| 02.AC1 | no PR: branch plus heads ref in one push | test | HR › "AC1: no PR yet…" |
| 02.AC2 | remote policy: Norn-Branch-Commit names the heads ref | test | HR › "AC2: record.policy remote…" |
| 02.AC3 | takeover resumes from the heads ref merged with the remote branch | test | HR › "AC3: … resumes at the heads ref", "AC3: … with the PR open, a person pushed … merges", "… clashes … refused" (no-PR narrowing: F13) |
| 02.AC4 | heads ref removed at cleanup, close, tidy; no config key | test | decide.test.ts › "PR merged → cleanup, the story's heads ref removed…"; HR › "AC4: story close…", "AC4: norn tidy…"; ids-config.test.ts |
| 02.AC5 | limitations note on local-policy crash loss | agent | QA (agent) |
| 03.AC1 | PR open: boundaries move only the heads ref | test | decide.test.ts › "an open PR, a draft one…", "a finished slice's status commit…"; PRT › "AC1, AC2, AC3, AC4…" |
| 03.AC2 | update merges locally, heads ref only | test | PRT › "AC1, AC2, AC3, AC4…" |
| 03.AC3 | open-pr pushes the branch before the PR; the PR shows that head | test | PRT › "AC1, AC2, AC3, AC4…" (partial: F15) |
| 03.AC4 | ready approve pushes nothing | test | PRT › "AC1, AC2, AC3, AC4…" |
| 03.AC5 | handoff and watch exit push heads only; close pushes the branch first | test | PRT › "AC5: story handoff…", "AC5: a clean watch exit…", "AC5: story close…" |
| 03.AC6 | a person's push and local boundaries are merged | test | PRT › "AC6: a person's push…" |
| 03.AC7 | transcript: one branch push per loop | test | test/e2e/base-sync.test.ts (base-sync.txt) |
| 04.AC1 | merge type validates with stale only | test | BS › "a merge step validates with stale as its only outcome…" |
| 04.AC2 | story/quick/release ready approve → merge | test | assets.test.ts › "story, quick and release approve at ready into a merge step…" |
| 04.AC3 | one merge item, no gate item | test | BS › "the inbox shows exactly one item for a story at the merge step…" |
| 04.AC4 | merged/closed PR as today | test | BS › "the PR merging ends the story through today's merge path…" |
| 04.AC5 | stale after a sync via stale_loop | test | BS › "a stale base move sends a story at the merge step back to update…" |
| 04.AC6 | approve/reject refused at merge | test | merge-step.test.ts › "approve and reject at the merge step are refused…" |
| 04.AC7 | no merge step: update-branch merge item as today | test | BS › "6 (core): an update receipt re-enters update from $done…" |
| 04.AC8 | update-branch at merge brings the base in | test | merge-step.test.ts › "story update-branch sends a story waiting at the merge step…" |
| 04.AC9 | docs reference, concepts, recipe | agent | QA (agent) |
| 05.AC1 | static guard refuses agent/update path to a gate without open-pr | test | OG (core) › "an agent step between open-pr and a gate…", "a git: update between open-pr and the merge step…" (narrowing: F14) |
| 05.AC2 | code change the PR lacks → back to open-pr | test | OG (core + integration) › "AC2:" tests |
| 05.AC3 | PR head at merge is the commit ci watched | test | OG (integration) › "AC3: after ci passes and ready approves…" |
| 06.AC1 | story edit refused with update_branch_instead | test | story-edit-update-branch.test.ts › "the same workflow with no --at is refused…" |
| 06.AC2 | other workflow / --at / no conflict still start a round | test | story-edit-update-branch.test.ts › three tests |
| 06.AC3 | AGENTS.md and recipe point at update-branch | agent | QA (agent) |
| 07.AC1 | only base merges + spec-folder commits → clean/resolved | test | UO › "base merges with an empty remerge-diff…", "a merge … that needed a resolution ends resolved"; LP |
| 07.AC2 | implement work since approval → done | test | UO › "a commit touching code since the approval…"; LP |
| 07.AC3 | spec.md changed → done | test | UO › "a changed spec.md…"; LP |
| 07.AC4 | unrouted → done | test | UO › "a workflow that does not route clean or resolved…" |
| 07.AC5 | deterministic; head_sha and git summary recorded | test | LP › "a clean base merge … with the git summary in the receipt", "… the resolver's done records its head" |
| 07.AC6 | git port remerge-diff and paths; old git never clean | test | packages/adapters/test/contract/git.ts › "commitPaths…"; git.test.ts › "a git too old to remerge…"; UO |
| 08.AC1 | shipped light route validates, routes, test command once | test | LR › "it validates, and git: update routes…", "the merge test passes to open-pr…" (light path skips human-qa: F1) |
| 08.AC2 | resolution input lists remerge-diff per merge | test | brief.test.ts › "lists one git show --remerge-diff <sha> per merge commit…" |
| 08.AC3 | clean skips the resolution review | test | LR › "a clean update skips the resolution review…" |
| 08.AC4 | resolution changes_requested → resolve | test | LR › "blocking findings of the resolution review go back to resolve…" |
| 08.AC5 | approve → open-pr keeps body; redescribe → describe | test | LR › "approve goes to open-pr without describe…" (routing only: F9) |
| 08.AC6 | YAML anchor gives both steps the same command | test | LR › "an aliased test command parses to the same command…" |
| 09.AC1 | only clean since ready approve + green → carried approve | test | CA › "norn approves on its own with a receipt marked carried…"; ready-since.test.ts |
| 09.AC2 | any resolved → waits for a person | test | CA › "a resolved update waits for a person's approval…" |
| 09.AC3 | ready item, brief, PR evidence list remerge-diffs | test | CA › three AC3 tests (S1 only: F9) |
| 09.AC4 | red test or CI → never carried | test | CA › "a red merge test…", "a red CI after a clean merge…" |
| 10.AC1 | brief lists base commits per conflicting path | test | BSI › "the brief lists the base side per conflicting path…"; contract git.ts › "log limited to paths…" |
| 10.AC2 | trailer-less commit listed without a story | test | BSI (same test) |
| 10.AC3 | base-update section shows the base side | test | BSI (same test) |
| 10.AC4 | shipped resolve takes base_side, both copies | test | assets.test.ts; test/repo/process.test.ts |
| 10.AC5 | norn-merge reads the base side first | agent | QA (agent) |
| 11.AC1 | base.verify validation; shipped set to test | test | BS › "base.verify naming a check step validates…"; assets.test.ts |
| 11.AC2 | clean base move runs verify on merged tree, pushes nothing | test | RV › "a clean base move runs the verify check once…"; BS |
| 11.AC3 | cached per (head, base) | test | BS › "a verify run already recorded…" |
| 11.AC4 | no free check slot → waits | test | BS › "with no check slot free…" |
| 11.AC5 | red → stale edge, last_check, counter max | test | BS › "a red verify run takes the waiting step's stale edge…"; RV |
| 11.AC6 | green leaves it waiting | test | BS › "a green verify run leaves the story where it waits" |
| 11.AC7 | no base.verify → no run | test | BS › "a workflow without base.verify…" |
| 12.AC1 | one Check item naming both stories and paths | test | OV › "two stories whose heads conflict…"; integration "one Check item names both…" |
| 12.AC2 | ineligible stories never compared | test | OV › overlapEligible tests |
| 12.AC3 | unmoved heads not recomputed | test | OV (integration) |
| 12.AC4 | item clears; no dismiss, no merge order | test | OV › "the item clears itself…", "the item offers no dismiss…" |
| 12.AC5 | spec-folder-only conflicts give no item | test | OV › "conflicts only inside the two stories' own spec folders…" |
| 13.AC1 | regenerate key loads; malformed refused | test | config.test.ts › "regenerate is a team key…" |
| 13.AC2 | all mapped → base side, commands bounded, Norn-Regenerated, no agent | test | RG › "every conflict mapped…"; IN › "every conflict mapped → base side…" |
| 13.AC3 | unmapped conflict → resolve | test | IN › "a conflicting path no glob matches…" |
| 13.AC4 | failed/timed-out command → resolve with output | test | IN › "a failing or timed-out command…"; RG › "a failing command → resolve…" |
| 13.AC5 | spec-folder-only branch takes base side | test | IN › "a branch holding only its spec folder…" |
| 13.AC6 | regenerated clean only with trailer + mapped remerge | test | UO › "a regenerated merge is clean only with its trailer…" |
| 13.AC7 | git port merges keeping conflicts (contract) | test | contract git.ts › "merge keeping its conflicts…" (real adapter only; no fake exists) |
| 13.AC8 | this repo maps schema:emit and docs:emit; docs | agent | QA (agent) (docs/reference.md mapped whole: F8) |
| 14.AC1 | brief offers norn ask mid-merge | test | BS › "the base-update section offers norn ask…" |
| 14.AC2 | answer resumes with merge in progress | test | AM › "the resolver asks mid-merge…"; BS |
| 14.AC3 | watch exit keeps that claim, not blocked | test | AM › "a clean watch exit keeps that story's claim…" |
| 14.AC4 | handoff refused merge_in_progress | test | AM › "story handoff refuses the story with merge_in_progress…" |
| 14.AC5 | abort + stuck as today | test | BS › "7a: resolve reports stuck…" |
| 14.AC6 | norn-merge says when to ask or abort | agent | QA (agent) |
