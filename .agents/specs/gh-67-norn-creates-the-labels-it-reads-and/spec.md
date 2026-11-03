---
id: gh-67
slug: norn-creates-the-labels-it-reads-and
provider: gh
number: 67
url: https://github.com/PruszynskiJakub/norn-next/issues/67
title: norn creates the labels it reads, and triage sets kind, risk and priority labels
assignee: PruszynskiJakub
labels:
  - friction
  - norn
  - norn:wf:refinement
workflow: refinement
status: active
intake_at: 2026-11-03T17:17:58.227Z
body_hash: 48c57d21d27a9cff37c69c2aa2e9116ff62e73a4ca7983a0f3316e393355e194
---

One change about labels: `norn init` (and upgrade) creates the intake and `norn:wf:<name>` labels on the remote (#67), and triage sets kind, risk and priority labels from a set norn creates the same way (#116). Bundled in bypass #133.

Folds in: #116. Each one's original text is kept below, under its own heading.

---

# From #67: norn init should create the labels norn needs on the remote

### Observed

`norn init` creates no labels on the remote. It only prints a hint for the intake label, and only for GitHub: "`gh label create norn` (once)" (`packages/cli/src/commands/init.ts:122`). On GitLab there is no hint at all. The workflow labels `norn:wf:<name>` (W9) are never created or mentioned, so a repo has to create every `norn:wf:<name>` label by hand before it can select a workflow by label.

Seen while bootstrapping self-hosting (#63): CONTRIBUTING lists `norn` and `norn:wf:{triage,story,fix,quick,spec,release}` as labels to create by hand.

### Wanted

`norn init` makes sure the remote has the labels norn reads, on GitHub (`gh`) and GitLab (`glab`):

- the intake label `config.remote.label` (default `norn`, GR1);
- one `norn:wf:<name>` per story workflow the repo has (built-in plus `.agents/norn/workflows/`, W9).

Existing labels are left alone, so the step is idempotent. Re-running `init` after adding a workflow creates its label. When the CLI is missing, unauthenticated or lacks permission, `init` says so in its report with the command to run, instead of failing. The `init` report lists which labels it created and which already existed.

Open for triage: does this belong in `init`, or in `norn doctor` (check, with `--fix`), or in both? Should it be a new `RemotePort` method (`ensureLabels`), given that ports perform one effect each?

### Where

- `packages/cli/src/commands/init.ts:119-123`: the hint.
- `packages/core/src/ports.ts:311`: `RemotePort` has no label operation.
- `packages/adapters/src/gh`, `packages/adapters/src/glab`.

### PRD

GR1 (intake label), W9 (`norn:wf:<name>`), X2 (ports).


---

# From #116: Triage sets risk, priority and kind labels on the issue

### Observed

The `triage` skill posts a `## Triage` comment and recommends a workflow, but it is told "never label, assign or close" (`.agents/skills/triage/SKILL.md`, section 4). An issue leaves triage with no labels for its kind (bug, enhancement, chore, …), its risk or its priority. The person has to add them by hand, or they never get added, so nobody can filter or sort the backlog by them on GitHub.

### Wanted

Triage judges the issue and sets three labels on it:

- **kind**: one of bug, enhancement, chore, docs, … (the existing `bug`, `enhancement` and `documentation` labels could be reused, or a namespaced set like `kind:*` could be used)
- **risk**: e.g. `risk:low|medium|high`: how much the change could break (blast radius, one-way vs two-way door)
- **priority**: e.g. `priority:p0..p3`

It also gives the reason for each label in the `## Triage` comment (new `**Kind:**`, `**Risk:**` and `**Priority:**` lines), so the person can correct them at `confirm`. The reason this is needed: the person can sort and filter the backlog on GitHub without reading every triage comment.

Open questions for refine:
- The exact label sets and their names: reuse GitHub's defaults or use namespaced labels.
- Whether `reproduce` also sets kind, risk and priority for bugs, or only `kind:bug`.
- What happens on a rerun (`## Triage (updated)`): replace the earlier triage labels, and leave labels a person set alone.
- Who creates the labels on the remote if they are missing (overlaps with #67).
- Whether this stays repo-local (the triage skill is repo-local) or becomes a shipped norn feature.

### Where

- `.agents/skills/triage/SKILL.md`: section 3 (comment shape) and section 4 (the "never label" rule, and the one remote write allowed)
- `.agents/norn/workflows/triage.yaml`: the `explore` instructions and the `confirm` prompt
- `.agents/norn/workflows/reproduce.yaml`: "never edit the issue, label, assign or close"

### PRD

- W9: workflow selection by the `norn:wf:<name>` label. The new labels must not clash with it.
- GR7: an unlabelled issue parks the story. Triage must never remove `norn`.
- §20 deferred row "Write-back to GitHub/GitLab (… `norn:stuck` label)": v1 writes only pushes. A repo-local skill setting labels goes further than that.
- Related: #67 (norn init creates the labels norn needs), #71 (triage confirm gate).

