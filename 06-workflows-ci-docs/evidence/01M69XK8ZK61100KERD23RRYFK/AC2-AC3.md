## AC2 / AC3
### .agents/workflows/quick.yaml
3-# every step works in the story worktree. Implement, bring the story up to date with its base, check, review, describe,
4-# open the draft PR (or rewrite the body of the open one), wait for the PR's CI, and wait for a
5:# person at `ready`; the person merges the PR. The local check runs the unit and integration tiers and the type check; CI runs every tier, e2e sharded.
6-# A story waiting at ready goes back through update when the base moved under it in a way
7-# that conflicts (BS6–BS8, base.stale: conflict).
8-name: quick
9-description: Make a small change (refactor, docs, chore, a reproduced bug's fix), check and review it, open the draft PR.
--
23-      Test your change with `bun packages/cli/src/main.ts …`, never the installed `norn`.
24-      Run that dev build only in a throwaway git repo under $TMPDIR, never in this worktree: it is a live norn unit (NORN_HOME points at it) and a dev build would act on its runs/, claim and state.json.
25:      Run `bun run test` (the unit tier) after each change, and the type check; the integration tier runs in the `test` check and the e2e tier runs in CI, so do not run them before handing back.
26-    outcomes:
27-      done: { to: update, means: "the change is made; each behaviour change and rework point has a passing test" }
28-  update:
29-    type: git
--
37-    outcomes:
38-      done: { to: update, means: "base merged into the story branch, conflicts resolved and committed" }
39:  test:
40-    type: check
41:    run: "bun install --frozen-lockfile && bun run test && bun run test:integration && bun run typecheck"
42-    timeout: 15m
43-    outcomes: { pass: review, fail: { to: implement, counter: test_loop } }
44-  review:
45-    type: agent
### .agents/workflows/story.yaml
3-# bring the story up to date with its base, verify the whole story, describe it,
4-# open the draft PR (or rewrite the body of the open one), wait for the PR's CI, and wait for a
5:# person to call it ready. The local check runs the unit and integration tiers and the type check; CI runs every tier, e2e sharded.
6-# Rework found by the story-level test, QA or CI is done in the story worktree.
7-# QA reports a verdict per acceptance criterion (criteria: required) and may only report the outcome
8-# matching its worst verdict; `unverified` (could not check here) goes to a person at human-qa.
9-# A story waiting at human-qa or ready goes back through update when the base moved
--
63-    outcomes:
64-      done: { to: update, means: "base merged into the story branch, conflicts resolved and committed" }
65:  test:
66-    type: check
67:    run: "bun install --frozen-lockfile && bun run test && bun run test:integration && bun run typecheck"
68-    timeout: 15m
69-    outcomes: { pass: qa, fail: { to: implement, counter: test_loop } }
70-  qa:
71-    type: agent
--
89-    skill: norn-implement
90-    inputs: [spec, handoff, last_check, last_findings]
91:    instructions: "Run `bun run test` (the unit tier) after each change, and the type check; the integration tier runs in the `test` check and the e2e tier runs in CI, so do not run them before handing back."
92-    outcomes:
93-      done: { to: test, means: "every rework point has a passing test" }
94-  describe:
95-    type: agent
### .agents/workflows/slice.yaml
12-    skill: norn-implement
13-    inputs: [slice, spec, handoff, last_check, last_findings]
14:    instructions: "Run `bun run test` (the unit tier) after each change, and the type check; the integration tier runs in the `test` check and the e2e tier runs in CI, so do not run them before handing back."
15-    outcomes: { done: { to: test, means: "every acceptance criterion (or rework point) has a passing test" } }
16:  test:
17-    type: check
18:    run: "bun install --frozen-lockfile && bun run test && bun run test:integration && bun run typecheck"
19-    timeout: 15m
20-    outcomes: { pass: review, fail: { to: implement, counter: test_loop } }
21-  review:
22-    type: agent
### .agents/workflows/bug.yaml
24-    skill: norn-implement
25-    inputs: [slice, spec, handoff, last_check, last_findings]
26:    instructions: "Start from the loop and minimised repro in the handoff: turn them into a failing test at the seam named there before changing any code, then fix the cause. Run `bun run test` (the unit tier) after each change, and the type check; the integration tier runs in the `test` check and the e2e tier runs in CI, so do not run them before handing back."
27-    outcomes:
28-      done: { to: test, means: "the repro (and each rework point) is a passing test" }
29:  test:
30-    type: check
31:    run: "bun install --frozen-lockfile && bun run test && bun run test:integration && bun run typecheck"
32-    timeout: 15m
33-    outcomes: { pass: review, fail: { to: implement, counter: test_loop } }
34-  review:
35-    type: agent
