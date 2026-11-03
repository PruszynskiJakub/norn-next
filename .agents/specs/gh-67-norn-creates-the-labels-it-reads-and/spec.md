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

# norn creates the labels it reads, and triage sets kind, risk and priority labels

## Problem

norn reads and writes issue labels, but it never makes sure they exist on the remote. A person setting up a repo has to create `norn` and every `norn:wf:<name>` label by hand: `norn init` only hints `gh label create norn`, on GitHub only, and names no workflow label at all. When a label is missing, norn's own label writes fail: `norn story create --workflow <name>` cannot create its issue, and the round label swap (RD5) only warns, so the issue shows the wrong workflow. This repo shows the drift: its remote has `norn:wf:fix`, a workflow that no longer exists, and lacks `norn:wf:triage` and `norn:wf:reproduce`.

Separately, an issue leaves triage with a `## Triage` comment but no label for its kind, risk or priority. Nobody can filter or sort the backlog on GitHub or GitLab without reading every triage comment, and the person adds such labels by hand or not at all.

## Solution

`norn init` and `norn upgrade` make sure the remote has every label norn uses: the intake label `norn`, one `norn:wf:<name>` per workflow in the repo, and a fixed set of triage labels (`norn:kind:*`, `norn:risk:*`, `norn:priority:*`). They create what is missing, never change or delete an existing label, and say in their report what they created, what already existed and what looks unused. When the remote cannot be reached or written, they finish everything else and say what to run. `norn doctor` checks the same labels and warns about missing ones, pointing at `norn upgrade`.

The shipped triage step judges each issue's kind, risk and priority, gives the reason for each in its `## Triage` comment, and puts one label from each set on the issue, never overriding a label already there.

## Behaviour

### Creating labels

- B1 As a person setting up a repo, I want `norn init` to create the labels norn uses on the remote, so that I do not create them by hand.
  Example: a GitHub repo with none of them → `norn init` → the remote now has `norn`, `norn:wf:triage`, `norn:wf:reproduce`, `norn:wf:refinement`, `norn:wf:story`, `norn:wf:slice`, `norn:wf:quick` and the twelve triage labels; the report lists all of them as created.
- B2 As a person who added or renamed a workflow, I want `norn upgrade` to create its label, so that the label matches the workflows the repo has.
  Example: a repo adds a `release` workflow → `norn upgrade` → `norn:wf:release` is created; the report lists it as created and the others as already there. This happens even when `upgrade` has nothing else to move or refresh.
- B3 As a person on GitLab, I want the same labels created there, so that norn behaves the same on both providers.
  Example: a GitLab repo → `norn init` → the same labels exist on the GitLab project; the report reads as on GitHub.
- B4 As a person, I want a `norn:wf:<name>` label for every valid workflow in the repo's workflows folder, the slice workflow and repo-local ones included, so that any workflow can be picked by label (W8, W9).
  Example: the folder holds `triage`, `reproduce`, `refinement`, `story`, `slice`, `quick` and `release` → seven workflow labels.
- B5 As a person with a broken workflow file, I want it named and left without a label, so that norn never creates a label for a workflow it cannot run.
  Example: the `spike` workflow file fails validation → no `norn:wf:spike`; the report says `norn:wf:spike not created: workflow spike is invalid` and points at `norn doctor`.
- B6 As a person, I want the triage set created on every repo, whether or not it runs `triage`, so that the set is the same everywhere.
  Example: the twelve labels `norn:kind:bug`, `norn:kind:feature`, `norn:kind:security`, `norn:kind:chore`, `norn:kind:docs`, `norn:risk:low`, `norn:risk:medium`, `norn:risk:high`, `norn:priority:low`, `norn:priority:medium`, `norn:priority:high`, `norn:priority:extreme` are created by `init` on a repo whose config picks `refinement` as the default workflow.
- B7 As a person, I want running `init` or `upgrade` again to change nothing on the remote when every label exists, so that it is safe to repeat.
  Example: a second `norn upgrade` right after the first → the report lists every label as already there and none as created.
- B8 As a person who styled a label by hand, I want norn to leave an existing label alone, so that my colour and description stay.
  Example: `norn` exists with a red colour and the description "pick me" → `norn upgrade` → it is unchanged and listed as already there.
- B9 As a person browsing labels on the remote, I want each label norn creates to say what it is for, so that others understand it.
  Example: a created `norn:wf:quick` has the `quick` workflow's description; `norn` has "norn takes in issues assigned to you with this label"; `norn:risk:high` says it means a one-way door or a wide blast radius. Every label norn creates has the norn colour `#5319E7`.
- B10 As a person, I want a `norn:wf:<name>` label that names no workflow listed as unused, with the command to delete it, so that I can tidy up myself.
  Example: the remote has `norn:wf:fix` and no `fix` workflow → the `init`/`upgrade`/`doctor` report lists `norn:wf:fix` as unused, with `gh label delete norn:wf:fix`; norn deletes nothing, because deleting a label strips it from every issue that carries it.
- B11 As a person whose checkout has no git remote, I want `init` and `upgrade` to finish and say labels were not checked, so that a local-only repo can still be set up.
  Example: a repo with no remote → `norn init` succeeds with its usual exit code; the report says `labels: not checked — no git remote`.
- B12 As a person without `gh`/`glab` installed or logged in, I want `init` and `upgrade` to finish and tell me how to fix it, so that a missing tool does not block setup.
  Example: `gh` not logged in → `norn upgrade` finishes everything else with its usual exit code; the report says `labels: not checked — gh is not logged in: run gh auth login, then norn upgrade`.
- B13 As a contributor without permission to create labels, I want `init` and `upgrade` to name each missing label with the command to create it, so that I or a maintainer can run it.
  Example: no write access → the report lists `norn:wf:triage not created: permission denied` with the full `gh label create norn:wf:triage --color 5319E7 --description "…"` command; the exit code is unchanged.
- B14 As a person on a flaky network, I want a failed remote call to be reported the same way, so that `init` and `upgrade` never fail because of labels.
  Example: the label listing times out → `labels: not checked — <provider message>: run norn upgrade again`; everything else `upgrade` did stays done.
- B15 As a person or program reading `--json`, I want the labels result as data, so that I can act on it without parsing prose (P8).
  Example: `norn init --json` carries the labels created, already there, unused and not created (each with its reason and command), or that labels were not checked and why.

### Checking labels

- B16 As a person, I want `norn doctor` to warn about every label norn uses that is missing on the remote, naming `norn upgrade`, so that I know why a label write would fail.
  Example: the remote lacks `norn:wf:reproduce` → `doctor` shows a warning `label norn:wf:reproduce is missing on the remote: run norn upgrade`; the overall result is not a failure.
- B17 As a person, I want `doctor` to list unused `norn:wf:*` labels, so that I see drift there too.
  Example: `norn:wf:fix` with no `fix` workflow → `doctor` lists it as unused with the delete command; this is not a failure.
- B18 As a person whose remote cannot be reached, I want `doctor` to warn that labels were not checked and why, so that it never fails because of the remote.
  Example: `gh` not logged in → `doctor` warns `labels not checked: gh is not logged in (gh auth login)`; the result is not a failure.
- B19 As a CI job running `doctor --repo`, I want it never to touch the remote, so that it needs no credentials (A7).
  Example: `norn doctor --repo` in CI → no label check runs and no label line appears.
- B20 As a person, I want no label created behind my back while norn works, so that remote writes happen only when I set up or upgrade.
  Example: `norn:wf:reproduce` is missing and a `reproduce` round starts → the label swap warns as today (RD5); no label is created by the tick.

### Triage labels

- B21 As a person reading the backlog, I want triage to put one kind, one risk and one priority label on the issue, so that I can filter and sort by them.
  Example: triage on an issue reporting a crash in `norn sync` → the issue gets `norn:kind:bug`, `norn:risk:medium`, `norn:priority:high`.
- B22 As a person reading the triage comment, I want a reason for each label, so that I can correct one I disagree with.
  Example: the `## Triage` comment has the lines `**Kind:** norn:kind:bug — sync exits 1 where it should list issues`, `**Risk:** norn:risk:medium — touches intake, a two-way door`, `**Priority:** norn:priority:high — blocks every new story`.
- B23 As a person who labelled an issue before triage, I want triage to keep my label, so that it never overrides me.
  Example: the issue carries `norn:kind:feature`; triage judges it a bug → the label stays, nothing is added to the kind set, and the comment reads `**Kind:** norn:kind:feature, kept as set; triage would say norn:kind:bug — …`. Triage still adds risk and priority if those sets are empty.
- B24 As a person rerunning triage, I want the earlier triage labels kept the same way, so that an issue never carries two kinds, risks or priorities.
  Example: a rerun posts `## Triage (updated)`; the issue already has `norn:risk:low`, triage now judges high → the label stays and the updated comment says triage would now say `norn:risk:high`.
- B25 As a person whose repo has not created the triage labels yet, I want triage to post its comment anyway and say which labels it could not set, so that the step still delivers its findings.
  Example: `norn:risk:high` is missing on the remote → the issue gets the kind and priority labels; the comment has its three judgement lines and `Labels not set: norn:risk:high is missing on the remote; norn upgrade creates it`; the step ends `done`.
- B26 As a person, I want triage never to create, delete or edit a label definition, so that labels are created in one place only.
  Example: every triage label missing → triage adds none, creates none, and names them in the comment as in B25.
- B27 As a person, I want triage to keep its other limits, so that labelling is the only new remote write.
  Example: triage still never edits the issue's title or body, assigns, closes, or removes any label (the intake label `norn` included, GR7).
- B28 As a person on GitLab, I want triage to set the same labels there.
  Example: triage on a GitLab issue → the same three labels and comment lines as on GitHub.

### Where it shows

- B29 As a person reading `init`'s next steps, I want the label hint gone when labels were handled, so that I am not told to do what norn did.
  Example: after a successful label step, the next steps no longer mention `gh label create`; when labels were not checked or not created, the report's labels line says what to run instead.
- B30 As a person reading the docs, I want the labels norn uses, the triage set and what each means described, so that I can set up and read them without the code.
  Example: the user docs list the intake label, the workflow labels, the twelve triage labels with their meaning, and that `init`/`upgrade` create them while `doctor` checks them; this repo's contributor guide lists the new labels instead of telling people to create them by hand.

## Out of scope

- Creating a label at the moment norn writes one (round swap, `story create`) — remote writes stay in `init` and `upgrade`; a tick does not gain one.
- Deleting or restyling labels — destructive or unwanted; norn lists unused ones and the person acts.
- A configurable triage label set — fixed like the intake label; a repo wanting others writes its own triage skill under another name (SK1).
- `reproduce` setting or changing labels — a bug usually arrives through triage, which already labelled it; a person corrects labels after reading the findings.
- norn reading the triage labels for any decision — they are for people only; no rule, inbox item or workflow choice depends on them.
- Reusing GitHub's default `bug`/`enhancement`/`documentation` labels — they do not exist on GitLab and cover no risk or priority; they are left alone.
- Tidying this repo's existing labels (`norn:wf:fix` and others) — the person does it from the unused list.

## Open questions

None.
