## Summary

Workflow authors can bring in steps from a shared file (`use:` with named exits) and copy a step in the same file (`like:`). norn flattens both when it loads the workflow, so the sync, base update and CI wait are each written once per workflow set. The bundled and repo `quick`/`story`/`release` are rewritten this way and still load to the same `workflowHash` as on main.

```
.agents/workflows/
  story.yaml            # sync: { use: sync, outcomes: { synced: slice } }
                        # update: { use: base-update, outcomes: { tested: qa, broken: { to: implement, counter: test_loop } } }
  shared/
    sync.yaml           # start + steps; leaves through { exit: synced }
    base-update.yaml    # update/resolve/test; test-merge, test-resolution are `like: test`
    ci.yaml | ship.yaml # the CI wait, now in one file per set
```

```
loadWorkflow(file)                                  # packages/store/src/shared-workflow.ts
  no use/like  -> source = file text byte for byte  (same fingerprint as today)
  otherwise    -> resolve like per file, splice each shared file's steps under their own names,
                  map { exit: x } to the use step's route for x (unrouted -> $stuck)
                  source = flattened YAML, hash = sha256(source)
  core validation, decide, receipts, goldens see only the flat workflow
```

## Evidence

QA ran at cee73aaa7 (since then only the handoff changed): 30 of 30 criteria pass ([report](evidence/_story/01M7JBVNCM1EBG8WWT3S4PXNT1/report.md)). The loader cases were run against hand-written fixtures in a temp repo ([loader-run.md](evidence/_story/01M7JBVNCM1EBG8WWT3S4PXNT1/loader-run.md)).

- **`use: base-update` brings in a shared file's steps**
  **Before:** did not exist: every workflow wrote the steps out again.
  **After:** the `use` step is replaced by the shared steps ([loader-run.md](evidence/_story/01M7JBVNCM1EBG8WWT3S4PXNT1/loader-run.md)).
- **Included steps keep their names**
  **Before:** did not exist.
  **After:** loaded step names are `update`, `resolve`, `test`, with no prefix ([loader-run.md](evidence/_story/01M7JBVNCM1EBG8WWT3S4PXNT1/loader-run.md)).
- **Routes, `base.step` and `base.verify` name an included step directly**
  **Before:** did not exist.
  **After:** `impl.retest → test` and `base.verify: test` load as written ([loader-run.md](evidence/_story/01M7JBVNCM1EBG8WWT3S4PXNT1/loader-run.md)).
- **A route to the `use` step enters at the shared `start`**
  **Before:** did not exist.
  **After:** `start:`, routes and `base.step` that name the `use` step go to `update`. `reset_on`/`base.verify` naming it are refused ([loader-run.md](evidence/_story/01M7JBVNCM1EBG8WWT3S4PXNT1/loader-run.md)).
- **A shared route leaves through a named exit**
  **Before:** did not exist.
  **After:** `pass: { exit: tested, means, verdict }` becomes `pass: { to: qa, means, verdict }` ([loader-run.md](evidence/_story/01M7JBVNCM1EBG8WWT3S4PXNT1/loader-run.md)).
- **An exit route takes a counter**
  **Before:** did not exist.
  **After:** `broken: { to: impl, counter: test_loop }` keeps the counter ([loader-run.md](evidence/_story/01M7JBVNCM1EBG8WWT3S4PXNT1/loader-run.md)).
- **An unrouted exit goes to `$stuck`**
  **Before:** did not exist.
  **After:** exit `odd` with no route loads as `odd: $stuck` ([loader-run.md](evidence/_story/01M7JBVNCM1EBG8WWT3S4PXNT1/loader-run.md)).
- **A shared route can go to `$done`/`$stuck`**
  **Before:** did not exist.
  **After:** kept as written. A route to a step outside the file is refused ([loader-run.md](evidence/_story/01M7JBVNCM1EBG8WWT3S4PXNT1/loader-run.md)).
- **A shared route names a counter the workflow declares**
  **Before:** did not exist.
  **After:** loads. An undeclared one is reported by `norn doctor` as `shared/back.yaml, step 'work': counter 'ghost' is not declared` ([07-doctor.md](evidence/_story/01M7JBVNCM1EBG8WWT3S4PXNT1/07-doctor.md)).
- **Workflow `defaults:` apply to included steps**
  **Before:** did not exist.
  **After:** included steps carry no limits of their own, so they are plain steps the workflow's defaults cover ([loader-run.md](evidence/_story/01M7JBVNCM1EBG8WWT3S4PXNT1/loader-run.md)).
- **`like: test` copies a step and replaces only the keys it writes**
  **Before:** YAML anchors (`&test-run`) shared only the command.
  **After:** a shallow copy in the target's key order, then the new keys. No anchor is left in either set ([loader-run.md](evidence/_story/01M7JBVNCM1EBG8WWT3S4PXNT1/loader-run.md), [workflow-hashes.md](evidence/_story/01M7JBVNCM1EBG8WWT3S4PXNT1/workflow-hashes.md)).
- **`like:` works in a shared file too**
  **Before:** did not exist.
  **After:** it is resolved inside the shared file before inclusion. Both `base-update.yaml` files use it ([loader-run.md](evidence/_story/01M7JBVNCM1EBG8WWT3S4PXNT1/loader-run.md)).
- **A bad `like:` is refused with its reason**
  **Before:** did not exist.
  **After:** all 7 cases (missing, itself, a `like` step, a `use` step, another file, …) are refused, naming the file and step ([loader-run.md](evidence/_story/01M7JBVNCM1EBG8WWT3S4PXNT1/loader-run.md)).
- **A missing shared file is refused, naming the file and folder**
  **Before:** did not exist.
  **After:** ``shared file `shared/missing.yaml` not found in `.agents/workflows/shared/` `` ([07-doctor.md](evidence/_story/01M7JBVNCM1EBG8WWT3S4PXNT1/07-doctor.md)).
- **Step name clashes and a double use are refused, naming both places**
  **Before:** did not exist.
  **After:** a clash with a workflow step, with the `use` step, or with another shared file, and a file used twice, are each refused ([loader-run.md](evidence/_story/01M7JBVNCM1EBG8WWT3S4PXNT1/loader-run.md)).
- **A routed exit the shared file lacks is refused**
  **Before:** did not exist.
  **After:** refused, naming the exit and the shared file ([loader-run.md](evidence/_story/01M7JBVNCM1EBG8WWT3S4PXNT1/loader-run.md)).
- **`use:` inside a shared file is refused**
  **Before:** did not exist.
  **After:** refused with "a shared file cannot use another shared file" ([loader-run.md](evidence/_story/01M7JBVNCM1EBG8WWT3S4PXNT1/loader-run.md)).
- **A shared-file key that belongs in the workflow is refused**
  **Before:** did not exist.
  **After:** each of `name`, `counters`, `defaults`, `mode` and `base` is refused with "`<key>` belongs in the workflow" ([loader-run.md](evidence/_story/01M7JBVNCM1EBG8WWT3S4PXNT1/loader-run.md)).
- **A validation issue on an included step names the shared file and step**
  **Before:** did not exist.
  **After:** `/steps/work: shared/back.yaml, step 'work': cycle without a counter…` ([07-doctor.md](evidence/_story/01M7JBVNCM1EBG8WWT3S4PXNT1/07-doctor.md)).
- **A shared-file refusal shows wherever a broken workflow shows**
  **Before:** did not exist.
  **After:** the workflow is broken in `norn doctor` and the listing. `story create`/`story edit` refusing it was seen only in the cli harness ([07-doctor.md](evidence/_story/01M7JBVNCM1EBG8WWT3S4PXNT1/07-doctor.md), [harness-tests.txt](evidence/_story/01M7JBVNCM1EBG8WWT3S4PXNT1/harness-tests.txt)).
- **A shared file is never listed, labelled or startable**
  **Before:** `shared/` did not exist.
  **After:** doctor and the listing never show it. `story edit --workflow <shared>` is refused as an unknown workflow (harness) ([harness-tests.txt](evidence/_story/01M7JBVNCM1EBG8WWT3S4PXNT1/harness-tests.txt)).
- **A unit pins the flattened workflow, fingerprinted over that text**
  **Before:** the pin was the file text.
  **After:** the pin has no `use`/`like`. A shared edit after `story edit` makes the round start refuse with `round.workflow_changed` (harness) ([harness-tests.txt](evidence/_story/01M7JBVNCM1EBG8WWT3S4PXNT1/harness-tests.txt)).
- **A workflow without `use`/`like` is pinned byte for byte**
  **Before:** `source` = file text.
  **After:** unchanged: `source == file`, `hash == sha256(source)` ([loader-run.md](evidence/_story/01M7JBVNCM1EBG8WWT3S4PXNT1/loader-run.md)).
- **A shared file edited mid-round takes effect next round**
  **Before:** did not exist.
  **After:** the running round keeps its pin and the next `story edit` takes the new text (harness, same test as the pin) ([harness-tests.txt](evidence/_story/01M7JBVNCM1EBG8WWT3S4PXNT1/harness-tests.txt)).
- **Bundled `quick`/`story` load to today's workflows**
  **Before:** the steps were copied into both files.
  **After:** `workflowHash` is the same on main and HEAD (29/8, 42/10 routes/counters). 0 of 139 golden cases and no e2e transcript change ([workflow-hashes.md](evidence/_story/01M7JBVNCM1EBG8WWT3S4PXNT1/workflow-hashes.md), [05.AC2.md](evidence/_story/01M7JBVNCM1EBG8WWT3S4PXNT1/05.AC2.md)).
- **This repo's `quick`/`story`/`release` load to today's workflows**
  **Before:** `gh run watch` appeared in 3 files.
  **After:** the same `workflowHash` for all three, and `gh run watch` appears only in `shared/ci.yaml` ([workflow-hashes.md](evidence/_story/01M7JBVNCM1EBG8WWT3S4PXNT1/workflow-hashes.md)).
- **`norn init` copies `shared/` and keeps existing files**
  **Before:** `shared/` did not exist.
  **After:** shared files are reported under created/kept, a hand-written `shared/sync.yaml` is left as it was, and the detected test command lands in `shared/base-update.yaml` ([05.AC3-AC4-init.md](evidence/_story/01M7JBVNCM1EBG8WWT3S4PXNT1/05.AC3-AC4-init.md)).
- **A JSON Schema for shared files is emitted**
  **Before:** only `workflow.schema.json` existed.
  **After:** `workflow-shared` and `workflow-source` are emitted. The strict `workflow` schema is unchanged ([schemas](evidence/_story/01M7JBVNCM1EBG8WWT3S4PXNT1/03.AC10-04.AC4-schemas.md)).
- **The recipes show shared files, `use:`, exits, `like:` and the refusals**
  **Before:** "Write your own workflow" said to copy `story`.
  **After:** following the section produces a workflow that loads. A named exit is kept apart from a check's `exits` ([08.AC1.md](evidence/_story/01M7JBVNCM1EBG8WWT3S4PXNT1/08.AC1.md)).

Not seen against a real GitHub repo: `story create`/`story edit`, round-start pins and the lost-record `story checkout` (which now reads the shared files from the branch) were observed only through the cli integration harness with a fake remote (23 pass).

## Merge danger

**Door:** two-way: a revert restores the copied workflow files. Pins already written by this code are flat workflows that the old code reads unchanged.

**Blast radius:** workflow authors: a repo whose own workflows add `use:`/`like:` cannot go back to an older norn without flattening them by hand. Running units are untouched, because every workflow keeps its `workflowHash` and a workflow without `use`/`like` keeps its fingerprint byte for byte. A later `yaml` package upgrade that changes its output could make a round staged with `story edit` refuse to start (`round.workflow_changed`) until the edit is run again.
