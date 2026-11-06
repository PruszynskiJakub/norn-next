### Goal

Apply the skill-shaper proposals (skill text only) to the 20 bundled skills (source in `packages/cli/assets/skills/`, copies in `.agents/skills/`) and the repo-local `issue`, `release`, `release-start`, plus the cross-cutting skill-to-skill cleanups.

### Progress

- Copied every proposal (`SKILL.md` plus the changed reference files of norn-codebase-design, norn-prototype, norn-tdd) over the sources and the three repo-local skills; refreshed every `.agents/skills/norn*` copy from source (rsync), so the copies match source again (norn-fsd-round's copy was stale).
- Proposal lines fixed against the lints and the code:
  - P7 "unaware of norn" (craft skills): removed `norn`, brief, step, workflow, receipt and outcome words from norn-clarify, norn-slice, norn-qa, norn-qa-person, norn-merge, norn-pr and norn-prototype. Dropped rule ids the merge (GR4, BS4, gh-80) and PR (GR9) proposals cited. norn-qa's report section names no flags now: it says "the report command your instructions name", like before.
  - norn-slice: the proposal said the workflow's check step runs slice `checks`. Nothing reads them (only the brief's "checks since last report" uses check steps), so the text now says nothing runs them for the implementer.
  - norn-fsd-round: put back the pinned phrases the proposal reworded (after every wait, Never start another round, `--until merged`, not `--until gate`, Bash timeout about 178 s, never through a script or in the background, One report, `--step <check>`, below).
  - norn-implement: put back "fast suite after each change" and "(slower tiers run in their own check)" (repo.test AC4).
- Cross-cutting cleanups: norn-tdd now defines a seam as where a module's interface lives (it said "public boundary"); norn-qa points to norn-qa-person; norn-refine drops the terse-answer rule (already in norn-interview); norn-clarify defers terse answers to the interview; norn-implement drops the "read helpers before a test" sentence (already in norn-tdd, which it invokes).
- The person's decisions: norn-retro has no `disable-model-invocation`; norn-prototype's default home is `<spec folder>/prototype/`, with mounted web variants beside their page.
- Checked against the code: the receipt fields retro names (classify outcomes, update from/to, round forced/left_at/comment, take forced/expired/record_lost), `norn story take` assigning the issue (issue skill), release-start's `--assignee @me`, release's `pr.md`, and the integrate conflict wording in norn-merge's table.
- `bun run test` (1277 pass) and `bun run typecheck` are green.
- Out of scope, left for follow-up issues (SUMMARY.md): a `waiting` outcome for `clarify`, instructions for the slice `merge` step, `last_findings` as a review input, the RULES §16 prototype line. RULES.md line 691 still calls norn-retro something a person runs. That stays true, since being model-invocable does not make it a step.

- review#1: changes requested. One blocking finding: norn-qa's description has no pointer to norn-qa-person (W7). Minor findings: a lowercase "nothing" in norn-slice:67, and norn-fsd-round's description lost "through their current round". Traceability:

| Item | Verifier | Proven by |
| --- | --- | --- |
| W1 20 bundled skills applied | test | Diffed against the proposals: 10 are identical; the other 10 differ only where a lint requires it (`packages/cli/test/unit/assets.test.ts` P7 + fsd-round pinned phrases, `test/repo/repo.test.ts` AC4) |
| W2 `.agents/skills` copies refreshed | test | `diff -r` against source is clean |
| W3 issue/release/release-start | person | Identical to the proposals (QA (person)) |
| W4 interview/refine/clarify dedup | person | norn-interview:16 keeps it; refine dropped it; clarify:26 defers |
| W5 tdd/implement dedup | person | norn-tdd:21 keeps it; implement dropped it |
| W6 tdd seam = interface | person | norn-tdd:12 |
| W7 norn-qa description → norn-qa-person | person | norn-qa:3 ("QA alongside a person is norn-qa-person."), fixed in implement#2 |
| D1 retro model-invocable | person | norn-retro frontmatter |
| D2 prototype home | person | norn-prototype:23 |

- implement#2 (rework of review#1): F1 added the norn-qa-person pointer to norn-qa's description; F2 capitalised "Nothing" in norn-slice:67 and line 8 now says the frontmatter is "read exactly as written"; F3 norn-fsd-round's description says "through their current round"; F5 norn-implement's Done says "agreed or fallback seam". F4 not taken: the norn-qa-person example shows a person's `pass` evidence in their own words, which norn-qa's example does not.
- review#2: approve. The four edits are correct and the `.agents` copies match source (`diff -r` clean); test#2 green. The table above is current (W7 now met). The implement#2 commit (c4b07564a) had grown this handoff to 3.4 MB: a scripted edit replaced an empty string (`"## Progress"` also matches inside `"### Progress"`, so the slice it computed was empty), which inserts the new text between every character. The Goal, the earlier Progress and the table were lost. review#2 rebuilt the handoff from d7daef4a8. Friction worth filing: norn put a 3.3 MB handoff into the brief without a size guard.

- describe#1: wrote `pr.md`. It covers the summary, evidence per W1–W7 and D1–D2 (no QA ran, so the evidence is tests and diffs) and the merge danger (two-way, agents).

- resolve#1: merged main 4340a8669 (#269, slice dependency guidance) into the branch. The one conflict was in norn-slice's steps 3–5: kept this branch's step 3 (verifiers at agreed seams, review/QA wording) and main's new dependency guidance in steps 2, 4 and 5 (critical path, drop unneeded edges, report the chain). Copied the result to `.agents/skills/norn-slice` (`diff -r` clean). Unit tier (1281 pass) and typecheck green.

- review#3: approve on 84e95497c. Since review#2 the story's own files changed only in norn-slice (source and copy), by the resolve#1 merge. It keeps main's dependency guidance (steps 2, 4, 5) and this branch's verifier wording (step 3), with nothing lost from either side. The diff against origin/main is still only skill files plus the spec folder. `diff -r` of the copies against source is clean, and test#3 is green. The traceability table above is current.

### Resume

Review approved on the merged head. The PR's CI and a person's judgement at `ready` come next.

## Progress

- implement#1 done: Applied the skill-shaper proposals to the 20 bundled skills (source + refreshed .agents copies) and issue/release/release-start. Fixed the proposal lines that broke the P7, pinned-phrase and AC4 lints or contradicted the code (slice checks are not run by norn). Made the cross-cutting cleanups: tdd seam = interface, qa→qa-person, deduplicated the interview/refine/clarify and tdd/implement rules. retro is now model-invocable, and prototype defaults to <spec>/prototype/. Unit tier and typecheck green.
- review#1 changes_requested: 1 blocking: norn-qa's description lacks the pointer to norn-qa-person the spec asks for (W7). Minor: lowercase 'nothing' in norn-slice:67; norn-fsd-round description lost its current-round bound. Everything else matches the proposals; unit tier and typecheck green.
- review#2 approve: The rework is correct (qa→qa-person pointer, slice wording, fsd-round bounded to the current round, implement fallback seam); copies match source; test#2 green. The story handoff, corrupted to 3.4 MB in c4b07564a by an empty-string replace, has been rebuilt from d7daef4a8 and updated.
- describe#1 done: Wrote pr.md: summary of the skill-text reshape, evidence per W1–W7/D1–D2 from lints, diffs and the review table (no QA), merge danger two-way with agents as blast radius.
- resolve#1 done: Merged main 4340a8669 into the story branch. Resolved norn-slice: kept our step 3 verifier wording plus main's dependency/critical-path guidance in steps 2, 4, 5; refreshed the .agents copy. Unit tier (1281) and typecheck green.
- review#3 approve: Merged head re-reviewed: the norn-slice resolution keeps main's dependency guidance and our verifier wording; copies match source; diff is still skill files plus the spec folder; test#3 green. No findings.
