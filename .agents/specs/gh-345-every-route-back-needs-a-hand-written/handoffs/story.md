#### Goal

Derived default counters for workflow edges (`<step>.<outcome>`, `<use step>.<exit>`, `max:` on the edge). All six slices are built and integrated. Story QA has run.

#### Proof

QA (qa#1) checked all 33 slice criteria through the dev CLI and the loader. 32 are `pass` and 1 is `person`. The evidence pack is in the run's evidence (criteria.json, report.md, one `<id>.md` per criterion):
- **Pins of today's workflows:** all 13 of today's files, bundled and repo with release, pin byte for byte the same under the base loader and the head loader.
- **Invariant table:** a counting table built without counter names shows the edited shipped files bound the same edges as today. The one difference is `integrate.conflict` also resetting on `integrate.done`. A changed bound makes `shipped-workflow-counting.test.ts` fail (checked with a mutation, then reverted).
- **Derivation:** every row and refusal was checked on crafted workflows (evidence `derive-workflows/`, `derive-loaded.json`): check fail and exits outcomes 5, reject 2, conflict 2 with its reset, stale 10, agent send-back 3, `max:` on an edge, max+counter refused, max to `$done`/`$stuck` refused, dotted declared names refused, shared-exit counters, and the mixed-kind refusal.
- **norn doctor (dev build) in a throwaway repo:** it passes all-default workflows and the bundled ones. It reports each refusal with its edge or exit (`doctor-ok.txt`, `doctor-bad.txt`).
- **Running unit (harness through the CLI, `04-run.md`):**
  - An exhausted park and the Unblock item name `review.changes_requested`.
  - A machine that doesn't hold the unit sees it in `norn status` and `norn story view` as `review.changes_requested 1/3`.
  - `rerun --reset review.changes_requested` works. An unknown name is refused, listing the counters the unit has.
  - A unit pinned with `ready_loop` keeps that name.
- **`integrate.conflict`:** it has the same bound as `conflict_loop` (`04.AC7.txt`).
- **Golden cases:** `bun run golden -- --update` changed 0 of 139 cases, because they pin their own workflows. `docs:emit` leaves no diff, and the docs lints pass.

#### Easy to miss

- Derivation happens once, at load, before pinning. A file that derives nothing keeps its pin byte for byte.
- Dotted names are valid in state.json, receipts and the pinned workflow.yaml. This is one-way: it belongs in the PR's merge danger.
- The cycle check (`cycle without a counter`) runs in doctor and validation, not in `loadWorkflows`. A file with an uncounted loop still loads in the store listing.

#### Not proven yet

- Criterion 04.AC2 (the brief warns `Last round on review.changes_requested (2/3)`) is `person`. The brief's last-round line names the derived counter and appears exactly one send-back before stuck, but it reads `(3/3)` with the counter at 3 of 3. At 2/3 the brief shows only `fix round … 2/3`. The threshold is the same as for named counters, and this story does not change it. A person confirms that the user story's intent is met, or rules otherwise.

#### Notes

- In the throwaway repo, doctor also reported `FAIL remote`, because gh has no auth under the sandboxed HOME. This has nothing to do with the story.

#### Resume

QA has reported `partial`. Next is the person's QA (human-qa) on the one `person` criterion, then describe.
