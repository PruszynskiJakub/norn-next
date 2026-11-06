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

### Resume

Nothing left in implement: the change is committed. The next step reviews the diff.
