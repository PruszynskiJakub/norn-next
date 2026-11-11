## Summary

A base move under a story stops costing a whole round, and a rework loop with the PR open starts one CI run instead of one per boundary. Approved stories now wait for the merge inside the workflow. A base update takes a light path when only base merges happened since the last approval. The resolver sees the base side and can ask a person. Generated-file conflicts regenerate without an agent. Waiting stories are re-verified, and overlapping open stories show in `norn status`.

```diff
 boundary (PR open)
-  push story branch                  # one CI run per push, each cancelling the last
+  push refs/norn/heads/<story> only  # the branch moves only at open-pr and `story close`

 shipped story / quick
-  ci → ready ─approve→ $done          # a conflict later shows only as a merge item
+  ci → ready ─approve→ merge ─stale→ update
 update
-  done → test → qa → … → describe → open-pr → ci → ready
+  done     → full path, as before
+  clean    → test-merge → open-pr (body kept) → ci → ready (approval carried)
+  resolved → test-resolution → resolution-review(remerge-diff) → open-pr → ci → ready (fresh approval)
+  conflict → regenerate if every path is mapped, else resolve(base_side)
```

Closes #126

## Evidence

QA #2 ran every criterion's tests on head 087e1aae: 77/77 pass (integration 62, unit 603, contract 139, e2e 18). It also read the docs behind the agent-checked criteria. Report: [report.md](evidence/_story/01M7579WPE36AHJ91ACBXPHMB9/report.md). Before = `main`.

- **No branch push at boundaries once the PR is open; update merges locally**
  **Before:** every boundary pushed the branch, so each one started a CI run.
  **After:** with the PR open, boundaries and `git: update` move only `refs/norn/heads/<story>` ([03.AC1](evidence/_story/01M7579WPE36AHJ91ACBXPHMB9/03.AC1.md), [03.AC2](evidence/_story/01M7579WPE36AHJ91ACBXPHMB9/03.AC2.md)).
- **open-pr pushes before the PR; one CI run per rework loop; the PR head at merge is the commit ci watched**
  **Before:** about 6 pushes per loop; ready pushed again after ci.
  **After:** the e2e transcript `base-sync.txt` shows exactly one branch push per loop, at open-pr. A static guard and a back-to-open-pr route keep the PR head at the commit ci watched ([03.AC7](evidence/_story/01M7579WPE36AHJ91ACBXPHMB9/03.AC7.md), [03.AC3](evidence/_story/01M7579WPE36AHJ91ACBXPHMB9/03.AC3.md), [05.AC1](evidence/_story/01M7579WPE36AHJ91ACBXPHMB9/05.AC1.md), [05.AC3](evidence/_story/01M7579WPE36AHJ91ACBXPHMB9/05.AC3.md)).
- **ready approve and entering merge push nothing**
  **Before:** approving pushed.
  **After:** no push ([03.AC4](evidence/_story/01M7579WPE36AHJ91ACBXPHMB9/03.AC4.md)).
- **handoff, watch exit and close leave the latest boundary on the remote**
  **Before:** they pushed the branch.
  **After:** handoff and watch exit push the heads ref while the PR is open; close pushes the branch first ([03.AC5](evidence/_story/01M7579WPE36AHJ91ACBXPHMB9/03.AC5.md), [01.AC1](evidence/_story/01M7579WPE36AHJ91ACBXPHMB9/01.AC1.md)).
- **record.policy: remote keeps working; no PR pushes as today**
  **Before:** n/a.
  **After:** with no PR, the branch and the heads ref go in one push, and `Norn-Branch-Commit` names the heads ref ([02.AC1](evidence/_story/01M7579WPE36AHJ91ACBXPHMB9/02.AC1.md), [02.AC2](evidence/_story/01M7579WPE36AHJ91ACBXPHMB9/02.AC2.md)).
- **takeover after a crash resumes from the real last boundary; limitations documented**
  **Before:** a takeover resumed from the last branch push.
  **After:** it resumes from the heads ref merged with the remote branch, and `docs/limitations.md` says what a crash under local policy loses ([02.AC3](evidence/_story/01M7579WPE36AHJ91ACBXPHMB9/02.AC3.md), [02.AC5](evidence/_story/01M7579WPE36AHJ91ACBXPHMB9/02.AC5.md)). QA's note: the doc says the step restarts with the counters the last record push recorded; the criterion says "fresh counters". Confirm the wording.
- **a person's push is merged with norn's local boundaries, never rebased; no setting**
  **Before:** n/a.
  **After:** both survive ([03.AC6](evidence/_story/01M7579WPE36AHJ91ACBXPHMB9/03.AC6.md), [01.AC2](evidence/_story/01M7579WPE36AHJ91ACBXPHMB9/01.AC2.md)). The heads ref is removed at cleanup, close and tidy, and no config key controls it ([02.AC4](evidence/_story/01M7579WPE36AHJ91ACBXPHMB9/02.AC4.md)).
- **merge step type; ready approves to merge in story, quick and release**
  **Before:** did not exist; ready approved to `$done`.
  **After:** the `merge` type validates with `stale` only ([04.AC1](evidence/_story/01M7579WPE36AHJ91ACBXPHMB9/04.AC1.md), [04.AC2](evidence/_story/01M7579WPE36AHJ91ACBXPHMB9/04.AC2.md)).
- **one merge item; merged or closed PR as today; stale goes back to update; nothing to approve**
  **Before:** n/a.
  **After:** [04.AC3](evidence/_story/01M7579WPE36AHJ91ACBXPHMB9/04.AC3.md), [04.AC4](evidence/_story/01M7579WPE36AHJ91ACBXPHMB9/04.AC4.md), [04.AC5](evidence/_story/01M7579WPE36AHJ91ACBXPHMB9/04.AC5.md), [04.AC6](evidence/_story/01M7579WPE36AHJ91ACBXPHMB9/04.AC6.md).
- **workflows without a merge step and `update-branch` keep working; documented**
  **Before:** n/a.
  **After:** [04.AC7](evidence/_story/01M7579WPE36AHJ91ACBXPHMB9/04.AC7.md), [04.AC8](evidence/_story/01M7579WPE36AHJ91ACBXPHMB9/04.AC8.md), [04.AC9](evidence/_story/01M7579WPE36AHJ91ACBXPHMB9/04.AC9.md) (docs, read by QA).
- **`story edit` with the same workflow on a conflicting finished story points at update-branch**
  **Before:** it started a whole round.
  **After:** refused (exit 3) with `do_instead: norn story update-branch gh-N`. A different workflow or `--at` still starts a round. AGENTS.md and the recipe say so ([06.AC1](evidence/_story/01M7579WPE36AHJ91ACBXPHMB9/06.AC1.md), [06.AC2](evidence/_story/01M7579WPE36AHJ91ACBXPHMB9/06.AC2.md), [06.AC3](evidence/_story/01M7579WPE36AHJ91ACBXPHMB9/06.AC3.md)).
- **light path only when nothing but base merges and spec-folder bookkeeping happened since the last approval**
  **Before:** every update reran the whole tail.
  **After:** core picks `clean`/`resolved` from git and receipts. Implement work, a changed `spec.md` or an unrouted outcome gives `done` ([07.AC1](evidence/_story/01M7579WPE36AHJ91ACBXPHMB9/07.AC1.md)–[07.AC6](evidence/_story/01M7579WPE36AHJ91ACBXPHMB9/07.AC6.md)).
- **shipped route; resolution review of the remerge-diff; clean skips it; findings go back to resolve; describe only on `redescribe`**
  **Before:** did not exist.
  **After:** [08.AC1](evidence/_story/01M7579WPE36AHJ91ACBXPHMB9/08.AC1.md)–[08.AC6](evidence/_story/01M7579WPE36AHJ91ACBXPHMB9/08.AC6.md). A base move before the PR is out (e.g. at human-qa) takes the full path, checked on this story's real receipts ([log](evidence/_story/01M7579WPE36AHJ91ACBXPHMB9/08.AC1-real-anchor.log)).
- **approval carried after a clean merge; fresh approval after a resolution, showing the remerge-diff; never over red**
  **Before:** every base update needed a new approval.
  **After:** [09.AC1](evidence/_story/01M7579WPE36AHJ91ACBXPHMB9/09.AC1.md)–[09.AC4](evidence/_story/01M7579WPE36AHJ91ACBXPHMB9/09.AC4.md).
- **resolver gets `base_side`: base commits per conflicting path, their story, spec and pr.md**
  **Before:** the resolver rebuilt the base side from `git log`.
  **After:** the brief lists the base side, including trailer-less commits. Shipped `resolve` takes it, and `norn-merge` reads it first ([10.AC1](evidence/_story/01M7579WPE36AHJ91ACBXPHMB9/10.AC1.md)–[10.AC5](evidence/_story/01M7579WPE36AHJ91ACBXPHMB9/10.AC5.md)).
- **waiting stories re-verified on a clean base move (`base.verify`)**
  **Before:** a textually clean but broken merge raised nothing.
  **After:** at ready or merge, the verify check runs on the merged tree. The run is cached per (head, base), takes a slot and pushes nothing. Red goes to update with `last_check` ([11.AC1](evidence/_story/01M7579WPE36AHJ91ACBXPHMB9/11.AC1.md)–[11.AC7](evidence/_story/01M7579WPE36AHJ91ACBXPHMB9/11.AC7.md)).
- **overlap between open stories shows as a Check item**
  **Before:** no warning.
  **After:** one item names both stories and the paths. It is cached per pair of heads, skips spec-folder-only conflicts and clears by itself ([12.AC1](evidence/_story/01M7579WPE36AHJ91ACBXPHMB9/12.AC1.md)–[12.AC5](evidence/_story/01M7579WPE36AHJ91ACBXPHMB9/12.AC5.md)).
- **`regenerate` config key; mapped conflicts and spec-folder-only branches merge without an agent**
  **Before:** an agent session for every conflict.
  **After:** [13.AC1](evidence/_story/01M7579WPE36AHJ91ACBXPHMB9/13.AC1.md)–[13.AC8](evidence/_story/01M7579WPE36AHJ91ACBXPHMB9/13.AC8.md). An unmapped path or a failed command goes to resolve with the command's output. This repo maps `schema:emit` and `docs:emit`, and never golden cases.
- **resolver can `norn ask` with the merge in progress**
  **Before:** its only way out was abort and stuck.
  **After:** the answer resumes with the merge in progress. Watch exit keeps the claim, and handoff is refused with `merge_in_progress`. Abort and stuck stay available ([14.AC1](evidence/_story/01M7579WPE36AHJ91ACBXPHMB9/14.AC1.md)–[14.AC6](evidence/_story/01M7579WPE36AHJ91ACBXPHMB9/14.AC6.md)).

Not proven end to end: the light-path anchor fix is tested on the pure function and on this story's real receipts, not through a full act run. Review findings F2–F15 (minor/nit) were accepted as notes.

## Merge danger

**Door:** one-way: units pinned to the new shipped workflows (`merge` step, `clean`/`resolved` outcomes, `base.verify`) and the `refs/norn/heads/<story>` refs on the remote outlive a revert. An older norn would refuse those workflows.

**Blast radius:** every story: each delivery's push behaviour changes. If the push rule is wrong, a boundary could stay local (lost on a crash), or a PR could show a head ci never ran on. If the light path fires wrongly, a story skips a full review.
