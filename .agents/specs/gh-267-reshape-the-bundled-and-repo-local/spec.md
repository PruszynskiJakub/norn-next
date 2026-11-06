---
id: gh-267
slug: reshape-the-bundled-and-repo-local
provider: gh
number: 267
url: https://github.com/PruszynskiJakub/norn-next/issues/267
title: Reshape the bundled and repo-local skills after the skill-shaper review
assignee: PruszynskiJakub
labels:
  - norn
  - norn:wf:quick
workflow: quick
status: done
intake_at: 2026-11-06T16:47:04.143Z
body_hash: d5e2e1e84c01c05271b53d2502bd50ff203e776b23a048e472cf3811871c88b9
merge:
  pr: 270
  url: https://github.com/PruszynskiJakub/norn-next/pull/270
  head_sha: c8cfeef0a1ca5dc063112ddfa1772dfb526f782b
  merge_commit_sha: 97d47e8003ea04ebaf9c33315ad172d288f5a159
  merged_by: PruszynskiJakub
  merged_at: 2026-11-06T17:35:31.000Z
---

Follows #266.

## Observed

A skill-shaper review of every skill in `.agents/skills/` produced a proposed reshaped `SKILL.md` per skill (plus changed reference files for norn-codebase-design, norn-prototype, norn-tdd), with a report of each change, the fences kept and why. Proposals and the summary table are on the supervisor's machine at:

`/private/tmp/claude-501/-Users-jakubpruszynski-Projects-norn/db2762fd-b1c8-4de3-96d2-8261c6cbb38d/scratchpad/skill-shaper/` — `SUMMARY.md` (verdict, key changes, open questions per skill) and `<skill>/SKILL.md` (+ reference files).

## Wanted

Apply the proposals — **skill text only**:

- the 20 bundled skills: edit the source in `packages/cli/assets/skills/<name>/`, then refresh the `.agents/skills/` copies to match;
- the repo-local `issue`, `release`, `release-start` in `.agents/skills/<name>/`;
- the skill-to-skill cleanups from SUMMARY.md's cross-cutting list: drop rules now duplicated across interview/refine/clarify and tdd/implement (keep them in the skill the others invoke), norn-tdd's "seam is the public boundary" → "interface", norn-qa's description pointing QA-with-a-person to norn-qa-person.

Decisions already made by the person:
- norn-retro becomes model-invocable (drop `disable-model-invocation`);
- norn-prototype's default home is `<spec folder>/prototype/`; web variants that must mount sit beside their page;
- every other open question: take the proposal's guess.

Treat each proposal as a draft, not gospel: keep every string the skill lints pin (`packages/cli/test/unit/assets.test.ts`, P7 "unaware of norn", glossary, docs lint) and fix any proposal line that contradicts the code.

## Out of scope

Workflow and RULES changes (follow-up issues): a `waiting` outcome for `clarify`, instructions for the slice `merge` step, `last_findings` as a review input, the RULES §16 prototype line.
