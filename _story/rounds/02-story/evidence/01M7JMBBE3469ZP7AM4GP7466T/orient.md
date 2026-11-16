
### reproduce.yaml

| step | skills | orientation |
|---|---|---|
| reproduce | norn-diagnose | The issue is mirrored in spec.md; read its comments too. First follow the report as a user, through the real interface (the UI, the command, the request), and record what you saw. Then build a loop that goes red on that exact symptom, minimise it and confirm the cause. You are told not to fix: change no file, spec.md included, but the handoff. Post the findings as an issue comment that starts with `## Reproduce` (`## Reproduce (updated)` on a rerun): the loop command, the minimised repro, what it prints, the confirmed cause (`file:line`, or the ranked hypotheses left) and the seam for a regression test. That one comment is the only remote write this step allows, an exception to the brief's rule on remote writes; never edit the issue, label, assign or close. Write the same under Notes in the handoff (the next agent does not see your Resume); a long loop output goes in evidence, with a pointer. |

### triage.yaml

| step | skills | orientation |
|---|---|---|
| explore | norn-triage | The issue is mirrored in spec.md. Post the `## Triage` comment on it and add the kind, risk and priority labels: `norn:kind:bug\|feature\|security\|chore\|docs`, `norn:risk:low\|medium\|high`, `norn:priority:low\|medium\|high\|extreme`; a label missing on the remote is named in the comment with "norn upgrade creates it". That comment and those labels are the only remote writes this step allows, an exception to the brief's rule on remote writes; never remove a label, the intake label `norn` included. Change no file, spec.md included, but the handoff. The recommendation lives only in that comment: report `norn done done --handoff "<recommendation>: <reason>"`. |

### slice.yaml

| step | skills | orientation |
|---|---|---|
| implement | norn-implement | Build this slice test-first: each acceptance criterion in the slice file, or each rework point from a red check or a review, ends with a passing test. Stay inside the slice; later slices have their own steps. |
| review | norn-review | Review this slice's diff against its acceptance criteria and the spec, before it integrates into the story branch. |
| merge | norn-merge | Integrating this slice into the story branch conflicted: resolve each conflict keeping the intent of both sides, and prove it with the tests. |

### story.yaml

| step | skills | orientation |
|---|---|---|
| slice | norn-slice | Write slice files to slices/<nn>-<slug>.md in the spec folder. A slice has no QA of its own: list every slice's criteria in spec.md's frontmatter `criteria` too, each id prefixed with its slice number (`01.AC1`), next to the story's own, so the story's QA gives each one a verdict. First check the Plan section of spec.md against the code on this base: when spec.md has no Plan section, or the base changed what the plan relies on so that it no longer holds, write no slice files, say what no longer holds in the handoff's Notes and report `replan`. |
| qa | norn-qa | The criteria are spec.md's frontmatter `criteria`; an id `<nn>.<id>` is criterion `<id>` of slice file `<nn>-*.md`, which says what it means. |
| implement | norn-implement | Rework the story in its worktree: the failing check, QA repro, CI failure or person's rejection the inputs name. Each rework point gets a test that fails before the code changes. |
| review | norn-review | Review the story-level rework against the findings it answers and the spec: it fixes what they ask and nothing else. |
| describe | norn-pr | Write the PR body to pr.md in the spec folder; norn puts the issue link under it. |

### quick.yaml

| step | skills | orientation |
|---|---|---|
| implement | norn-implement | Work from what the story already holds: the Plan section of spec.md when a refinement round wrote one, otherwise the issue mirrored in spec.md and its latest `## Triage` comment. Keep to what they ask. A change in behaviour gets a test first; a change to docs or a pure refactor needs none beyond the suite staying green. A bug comes from a reproduce round with a red loop in the handoff's Notes and the issue's latest `## Reproduce` comment: turn it into a failing test at the seam named there before changing any code, then fix the cause. |
| review | norn-review | Review the change against what the story asks (its Plan, or the issue and its latest triage): it does that and nothing else. |
| describe | norn-pr | Write the PR body to pr.md in the spec folder; norn puts the issue link under it. |

### refinement.yaml

| step | skills | orientation |
|---|---|---|
| sync-resolve | norn-merge | Base mode: merge the base commit named in Rework into the story branch in this worktree, resolve, commit the merge; never rebase. |
| refine | norn-refine | Write the spec into the body of spec.md; keep its frontmatter unchanged. |
| clarify | norn-clarify | Settle the spec's open questions with the person, one question at a time, folding each answer into the section it changes. |
| plan | norn-plan | Write the Plan section of spec.md. |

### shared/base-update.yaml

| step | skills | orientation |
|---|---|---|
| resolve | norn-merge | Base mode: merge the base commit named in Rework into the story branch in this worktree, resolve, commit the merge; never rebase. When Rework holds the resolution review's findings instead, fix the resolution they name and commit; never rebase. |
| resolution-review | norn-review | Review only the resolution: each remerge-diff under Inputs is where a merge differs from git's own merge of its parents, a base change the resolver dropped included. Judge whether it keeps the intent of both sides. Report `redescribe` when the merge danger pr.md describes no longer holds. |

### shared/sync.yaml

| step | skills | orientation |
|---|---|---|
| sync-resolve | norn-merge | Base mode: merge the base commit named in Rework into the story branch in this worktree, resolve, commit the merge; never rebase. |
