### Goal

A resolver that needs a person's decision can `norn ask` with the base merge kept in progress. The answer resumes the same resolve. A clean watch exit keeps that story's claim, and `story handoff` refuses the story.

### Proof

Review #1 approved: no findings. Traceability:

| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| AC1 (story 71) | the resolve brief's base-update section offers `norn ask` with files, each side's intent and the decision, keeping the merge in progress; abort + `norn stuck` stay for a merge it cannot understand | test | `packages/core/test/unit/base-sync.test.ts` › "ask instead of abort…" › "the base-update section offers norn ask with the merge kept in progress, and keeps abort + norn stuck…" |
| AC2 (story 72) | an answer resumes the same resolve step with the merge still in progress | test | `base-sync.test.ts` › "an answer resumes the same resolve step while the merge stays in progress"; `packages/cli/test/integration/ask-mid-merge.test.ts` › "the resolver asks mid-merge; the answer resumes the same resolve with the merge still in progress" (real git: MERGE_HEAD, unmerged a.txt, staged b.txt survive) |
| AC3 (story 73) | a clean watch exit keeps that story's claim, releases the others' and is not blocked | test | `ask-mid-merge.test.ts` › "a clean watch exit keeps that story's claim, releases the others' and is not blocked" |
| AC4 (story 74) | `story handoff` is refused with `merge_in_progress` and a do_instead to answer or unstick first | test | `ask-mid-merge.test.ts` › "story handoff refuses the story with merge_in_progress and says to answer or unstick first" |
| AC5 (story 75) | abort + `norn stuck` escalates as today | test | `base-sync.test.ts` › "7a: resolve reports stuck … → $stuck with its reason"; the AC1 test asserts the brief still names `git merge --abort` and `norn stuck "<why>"` |
| AC6 (story 76) | bundled `norn-merge` says when to ask (both intents valid, a person must choose) and when to abort (merge cannot be understood) | agent | QA (agent): `packages/cli/assets/skills/norn-merge/SKILL.md` › "Ask or abort when you cannot finish" (read in review; matches) |

Review ran: unit tier `base-sync.test.ts` 29 pass; `bun test --config=bunfig.integration.toml packages/cli/test/integration/ask-mid-merge.test.ts` 3 pass; check test#1 (`bun run test` + `typecheck`) pass.

### Easy to miss

- `askingMidMerge` (core `policy.ts`) needs all three: the unit is parked, its park is an `ask`, and observe reports `in_progress.operation === "merge"`. A merge in progress while the resolver still runs does not count, and neither does a rebase.
- A watch-exit "kept" entry is `ok: true` with `kept: "merge_in_progress"`, so the exit code stays 0 and the exit is never blocked.

### Not proven yet

- The integration and e2e tiers did not run in full; they run in CI. Locally I ran only the new file `ask-mid-merge.test.ts` (3 pass) to see red and then green.

### Notes

- The handoff refusal's do_instead says: answer the question with `norn story answer <unit> "…"`, or unstick the step with `norn run rerun <unit>`; let the resolve conclude the merge; then hand over.
- I added a sentence to `docs/recipes.md` › "Hand a story over" on the refusal and on the claim a watch exit keeps.
- I did not edit `.agents/skills/norn-merge` (it is the copy).
- Claim release code (`runtime/release.ts`) is also touched by slices 01 and 03. A conflict there is resolved at merge.

### Resume

Review approved; the next step is QA (AC6 is an agent verifier: read the bundled norn-merge skill).
