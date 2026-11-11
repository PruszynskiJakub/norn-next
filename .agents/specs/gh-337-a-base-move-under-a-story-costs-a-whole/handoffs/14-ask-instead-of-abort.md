### Goal

A resolver that needs a person's decision can `norn ask` with the base merge kept in progress. The answer resumes the same resolve. A clean watch exit keeps that story's claim, and `story handoff` refuses the story.

### Proof

- AC1, the brief offers ask with the merge kept in progress (files, each side's intent, the decision): `packages/core/test/unit/base-sync.test.ts` › "ask instead of abort…" › "the base-update section offers norn ask with the merge kept in progress, and keeps abort + norn stuck for a merge it cannot understand". This test failed before the brief change.
- AC2, the answer resumes the same resolve with the merge still in progress:
  - core: same describe › "an answer resumes the same resolve step while the merge stays in progress".
  - S3: `packages/cli/test/integration/ask-mid-merge.test.ts` › "the resolver asks mid-merge; the answer resumes…". It runs on real git: MERGE_HEAD and the unmerged a.txt survive, and the staged b.txt stays staged. This already held before this slice; the tests pin it.
- AC3, a clean watch exit keeps that claim, releases the others' and is not blocked: `ask-mid-merge.test.ts` › "a clean watch exit keeps that story's claim…". It failed first: exit 1.
- AC4, handoff is refused with `merge_in_progress`: `ask-mid-merge.test.ts` › "story handoff refuses…". It failed first: exit 1, because the release tried to push.
- AC5, abort plus `norn stuck` escalates as before: the existing `base-sync.test.ts` › "7a: resolve reports stuck…" covers it, and the AC1 test checks that the brief still names `git merge --abort` and `norn stuck "<why>"`.
- AC6, the skill: the bundled `packages/cli/assets/skills/norn-merge/SKILL.md` now has "Ask or abort when you cannot finish". Ask when both intents are valid and a person must choose: a rule neither side has, or contradicting sides the spec does not settle. Abort when the merge cannot be understood. This is for an agent to verify.
- `bun run test` passes 1867 and `bun run typecheck` is clean.

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

Implementation is complete and committed. The next step is review.
