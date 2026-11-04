## Summary

`norn init` and `norn upgrade` now create every label norn uses on the remote (the intake label `norn`, one `norn:wf:<name>` per valid workflow, and twelve fixed triage labels), never editing or deleting one; `norn doctor` checks them and warns. The shipped `triage` step judges each issue's kind, risk and priority, gives a reason for each in its `## Triage` comment, and puts one label from each set on the issue without overriding one already there (GR10, GR11).

```text
norn init / norn upgrade (every run, even with nothing else to do)   norn doctor (not --repo)
  remoteLabels(create: true)                                           remoteLabels(create: false)
    no git remote / gh|glab missing or logged out / listing fails        → warnings only, never a failed check
      → "labels: not checked — <why>: <what to run>"   (exit code unchanged)
    remote.listLabels()
    planLabels(intake, workflows, remote)          # pure, packages/core/src/labels.ts
      wanted  = norn + norn:wf:<valid workflow>… + norn:kind|risk|priority:* (12)
      missing → remote.createLabel(color 5319E7, description)
                  _exists → listed as already there (never restyled)
                  other   → not created: <reason> — `gh label create … --color 5319E7 --description "…"`
      invalid workflow → not created: workflow <w> is invalid — `norn doctor`
      unused norn:wf:* → listed with `gh label delete …`, never deleted
```

A tick never creates a label: a missing one still makes the RD5 round swap warn, as before.

## Evidence

The unit tier (1163 pass), the labels integration file (12 pass) and the type check are green on HEAD (review#2). All tests below are new: before this branch the behaviour did not exist. Integration tests are in [`packages/cli/test/integration/labels.test.ts`](https://github.com/PruszynskiJakub/norn-next/blob/gh-67-norn-creates-the-labels-it-reads-and/packages/cli/test/integration/labels.test.ts).

- **B1** `init` creates every label
  **Before:** did not exist; `init` hinted `gh label create norn` only.
  **After:** test "B1, B6, B9, B15": empty remote → `norn init` → remote has `norn`, six `norn:wf:*` and the twelve triage labels, each colour `5319E7` with a description, all listed as created in the report and `--json`.
- **B2** `upgrade` creates a new workflow's label
  **Before:** did not exist.
  **After:** test "B2, B4, B7": a `release` workflow added, nothing else to upgrade → `norn upgrade` creates `norn:wf:release`, the others listed as already there.
- **B3** same on GitLab
  **Before:** did not exist.
  **After:** glab `listLabels`/`createLabel` pass the remote contract over a scripted `glab` and the glab adapter unit test; core test "label commands › glab" checks the `glab label create` command. **Not shown:** no `norn init` run end to end on GitLab (the harness's `FakeRemote` is gh only). Check: run `norn init` on a GitLab project.
- **B4** a label per valid workflow, slice and repo-local included
  **After:** test "B2, B4, B7" (repo-local `release` gets one).
- **B5** an invalid workflow gets no label
  **After:** test "B5": a workflow failing validation → no `norn:wf:spike`; report `norn:wf:spike not created: workflow spike is invalid`, pointing at `norn doctor`.
- **B6** triage set created on every repo
  **After:** test "B1, B6, B9, B15" and core `planLabels` test: the twelve labels are wanted whatever the default workflow.
- **B7** a second run changes nothing
  **After:** test "B2, B4, B7": second `upgrade` → none created, every label already there.
- **B8** an existing label is left alone
  **After:** test "B8, B10": a hand-styled `norn` keeps its colour and description; listed as already there. Contract: `createLabel` on a taken name rejects with `_exists`.
- **B9** each label says what it is for
  **After:** test "B1, B6, B9, B15" and core test "B9: descriptions…": `norn:wf:quick` has the workflow's description; fixed sentences for `norn` and the triage set.
- **B10** unused `norn:wf:*` listed with its delete command, never deleted
  **After:** test "B8, B10": `norn:wf:fix` with no `fix` workflow → listed with `gh label delete norn:wf:fix`; still on the remote afterwards.
- **B11** no git remote
  **After:** test "B11": `init` succeeds with its usual exit code; `labels: not checked — no git remote`.
- **B12** `gh` not logged in
  **After:** test "B12": `init` finishes; report names `gh auth login`, then `norn upgrade`. **Not shown:** the spec's example is `norn upgrade`; only `init` is run (the code path is shared).
- **B13** no permission to create labels
  **After:** test "B13": each label `not created: permission denied` with its full `gh label create … --color 5319E7 --description "…"`; exit code unchanged. gh adapter maps a 403 to `gh_auth`.
- **B14** a failed listing
  **After:** test "B14": listing fails → `labels: not checked — <provider message>: run norn upgrade again`; the rest of `upgrade` stays done.
- **B15** the labels result in `--json`
  **After:** tests "B1, B6, B9, B15", "B11", "B14" assert the `labels` object: created, existing, unused, not_created (reason + command), or `checked: false` with the reason.
- **B16 / B17** `doctor` warns on missing and unused labels
  **After:** test "B16, B17": warnings `label norn:wf:reproduce is missing on the remote: run norn upgrade` and the unused one with its delete command; not a failure.
- **B18** `doctor` with an unreachable remote
  **After:** test "B18": warning `labels not checked: gh is not logged in (gh auth login)`; not a failure.
- **B19** `doctor --repo` never touches the remote
  **After:** test "B19": no label listing, no label line.
- **B20** no label created by a tick
  **After:** test "B20": `norn:wf:reproduce` missing, a `reproduce` round starts → the RD5 swap warns; the remote has no new label.
- **B21–B28** triage sets kind, risk and priority labels, keeps existing ones, names missing ones, creates none, GitLab too
  **Before:** triage posted only the comment and never labelled.
  **After:** **Not shown by a test:** this is an agent's behaviour, written as instructions in `packages/cli/assets/skills/norn-triage/SKILL.md` §3–4 and both `triage.yaml` copies; review read them and judged them correct. Check: run a `triage` round on a real issue (one unlabelled, one already carrying `norn:kind:feature`) and read the labels and the `**Kind:**`/`**Risk:**`/`**Priority:**` lines.
- **B29** `init`'s `gh label create` hint is gone
  **After:** test "B1, B6, B9, B15" asserts the output does not contain `gh label create`; B12/B13 show the labels line saying what to run instead.
- **B30** docs
  **After:** **Not shown by a test:** a person reads `docs/concepts.md` (labels section), `README.md`, `docs/recipes.md` and `CONTRIBUTING.md`.

## Merge danger

**Door:** two-way: reverting removes the code; labels already created on a remote stay, which is harmless (norn never reads the triage labels, and the others are ones it already used).

**Blast radius:** `init`/`upgrade`/`doctor` users: each run now makes remote calls (one listing plus one create per missing label). Any remote failure is reported, never a changed exit code. Known minors: on GitLab, `listLabels` reads one page of 100, so a project with more labels sees false "missing" warnings in `doctor` (create still comes out right through `_exists`); on the new layout `upgrade` makes the label calls while holding the tick lock, so a concurrent tick can wait on the network.
