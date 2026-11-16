---
id: gh-342/07
title: Shared-file errors, pins and lost-record restarts through the cli
depends_on: [gh-342/02, gh-342/03]
status: planned
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
  - { id: AC5, verifier: test }
---

## Goal
A person meets a broken shared file wherever a broken workflow shows today, with messages naming the shared file and step; a shared file can never start a round; a unit pins the flattened workflow, and a lost record restarts with the shared files read from its branch.

## Scope
User stories: a validation issue on an included step names the shared file and step; a shared-file refusal shows in doctor, the listing, story create and story edit; a shared file is never startable; a unit pins the flattened workflow with its fingerprint over that file; a shared file edited mid-round takes effect next round. Seams: S2. Out: the loader's behaviour itself (03, 04).

## Acceptance
- AC1 Given an included step routing back without a counter, or naming a counter the workflow does not declare, when `norn doctor --json` runs, then the issue's message names `shared/<name>.yaml` and the step in it. — verifier: test
- AC2 Given a workflow refused for a shared-file reason (a missing shared file), when `norn doctor --json`, the workflow listing, `norn story create` with that workflow and `norn story edit --workflow <it>` run, then each shows it broken or refuses it as it does for a broken workflow today. — verifier: test
- AC3 Given a shared file `shared/ship.yaml`, when `norn story edit --workflow ship` runs, then it refuses as for an unknown workflow. — verifier: test
- AC4 Given a story edited onto a workflow that uses a shared file, when its round starts, then the pinned workflow has no `use`/`like` and its fingerprint is the flattened text's; when the shared file is edited after `norn story edit` and before the round starts, the start refuses with `round.workflow_changed`, a round already running keeps its pin, and the next `norn story edit` takes the new text. — verifier: test
- AC5 Given a story whose record is lost and whose branch's workflow uses a shared file present on that branch (and different in the work tree), when `norn story checkout` restarts it, then the pinned workflow is flattened from the branch's shared file; with the shared file missing on the branch it refuses with `workflow_invalid`. — verifier: test

## Checks
- `bun run test`
- `bun run typecheck`

## Notes
Plan D1 (the restart reads the shared files a text uses with `git show` on the branch, then passes them to the synchronous loader from slice 02), D2, D7 (the cli's shared workflow check prefixes a core validation issue on an included step using the loader's step→shared-file map), D9. These are integration tests (story-create, story-edit, human `workflow_changed`, takeover-record-lost style), which CI runs; `bun run test` covers the unit tier. Does not need `like:` (04): every criterion is shown with `use:`.
