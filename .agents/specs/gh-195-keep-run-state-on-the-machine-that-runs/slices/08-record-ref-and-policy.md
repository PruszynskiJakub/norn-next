---
id: gh-195/08
title: The record ref and the record policy
depends_on: [ gh-195/05, gh-195/06 ]
status: active
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
  - { id: AC5, verifier: test }
  - { id: AC6, verifier: test }
  - { id: AC7, verifier: test }
---

## Goal
A team sets `record.policy` to `local` (default) or `remote` in its team config. Under `remote`, every step boundary pushes the story's record, packed into one commit, to `refs/norn/runs/<story>` right after the branch; under `local`, a normal step pushes no ref. A failed ref push is retried at the next tick.

## Scope
Behaviour: B9, B10 (the push; the other clone's view is gh-195/12), B11 (the boundary half), B12, B14, B34 (the ref push of a moved story). Seams: S1. Out: release pushes (gh-195/09), reading the ref elsewhere (gh-195/10, gh-195/12), open-pr (gh-195/15), the archive (gh-195/16).

## Acceptance
- AC1 (B9) Given a team config without `record.policy`, when a story runs, then it behaves as `local`; `norn config set record.policy remote --repo` writes the team file, `norn config get record.policy` names the file the value came from, and `norn doctor` reports a value other than `local` or `remote` as a failed check; the emitted config schema and the reference docs are regenerated. — verifier: test
- AC2 (B10) Given gh-9 under `remote`, when implement ends, then the remote's story branch and then `refs/norn/runs/gh-9` are pushed, and the ref's commit tree is gh-9's run-state folder as in the machine dir (`_story/rounds/NN-<wf>/…`, each slice's `<nn>-<slug>/…`), with trailers `Norn-Story`, `Norn-Branch-Commit` (the pushed branch head) and `Norn-Holder`, and its parent the previous record commit. — verifier: test
- AC3 (B11) Given gh-9 under `local`, when it runs implement, review and qa, then `git ls-remote origin 'refs/norn/runs/*'` lists no ref for gh-9. — verifier: test
- AC4 (B12) Given a team that switches `local` → `remote` while gh-9 is in review, when gh-9's next boundary lands, then it pushes the ref, and every boundary after it does too. — verifier: test
- AC5 (B14) Given gh-9 under `remote` and a `pre-receive` hook on the bare remote that rejects the ref once, when the boundary runs, then the branch is pushed, the step goes on, and the next tick pushes the ref. — verifier: test
- AC6 (B10, B14) Given two checkouts that both try to push gh-9's ref, when the second pushes with a lease on a sha it did not see, then the push is refused and the ref is not overwritten; and a boundary whose record tree did not change pushes nothing. — verifier: test

- AC7 (B34) Given an open story under `remote` with `runs/` on its branch, when the holder's first tick moves it (gh-195/06), then the branch is pushed and then `refs/norn/runs/<story>` with the moved record. — verifier: test

## Checks
- `bun run test`
- `bun run typecheck`
- `bun run test:integration`
- `bun run schema:emit && git diff --exit-code packages/schema/json`

## Notes
D2 (record commit shape, lease), D3 (pack and unpack in store with git plumbing: temp index, `write-tree`, `commit-tree`; unpack to a temp folder, validate every JSON, rename), D4 (observe reports the record's local tree id and the last pushed one, machine-local; decide emits `push_record` after the branch push when the tree changed). Build unpack here too, with its own test through the harness, since gh-195/10 and gh-195/12 read it.
The key is `record.policy` (values `local` | `remote`, default `local`; person's decision at the first slice gate, spec B9). D13 step 4: the move's ref push lands here. New rule ids S11, S12 get golden cases (`bun run golden`).
