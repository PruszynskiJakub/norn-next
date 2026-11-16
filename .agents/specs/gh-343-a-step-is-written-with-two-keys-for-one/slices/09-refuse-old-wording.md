---
id: gh-343/09
title: The main checkout accepts only the new wording; copies still load
depends_on: [gh-343/01, gh-343/05, gh-343/06, gh-343/07]
status: planned
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
  - { id: AC5, verifier: test }
  - { id: AC6, verifier: test }
  - { id: AC7, verifier: test }
  - { id: AC8, verifier: agent }
---

## Goal
Contract step: a workflow file in the main checkout's `.agents/workflows/` written in the old (or a mixed) wording is refused with `norn upgrade` as the way out and treated like any invalid workflow, while stories in flight, past rounds and lost-record restarts keep loading their old-wording copies, and new units pin the new wording.

## Scope
User stories: old wording refused with `do_instead` naming `norn upgrade`; mixed wording refused as old; one doctor issue per old file; old files treated as an invalid workflow; old pins keep loading untouched; past rounds readable; old branch file loading at a lost-record restart; new units pinning the new wording; `means`/`verdict` inside an edge refused in the main checkout. Seams: S1, S7. Out: the rewrite (slice 08).

## Acceptance
- AC1 Given a main-checkout file with any `type`, `skill`, `instructions`, `run`, `prompt` or `action` key, or `means`/`verdict` inside an edge or exit route, when it loads, then it is refused as old wording naming the steps and keys, and a command refusing it prints a `CliError` whose `do_instead` names `norn upgrade`. — verifier: test
- AC2 Given a step mixing old and new wording, when its main-checkout file loads, then it is refused as old wording with the same `do_instead`. — verifier: test
- AC3 Given a repo with two old-wording workflow files, when `norn doctor` runs, then it reports one issue per file, each naming `norn upgrade`. — verifier: test
- AC4 Given an old-wording main-checkout file, when a person starts a new round from it (`norn story edit --workflow`) or `norn sync` runs, then no round starts from it and sync and the inbox report it, as for an invalid workflow today. — verifier: test
- AC5 Given a story in flight whose pin is in the old wording, when ticks run it to the end of its round, then the pin loads, its text and hash on disk are untouched, and a past round's trace and record load as before. — verifier: test
- AC6 Given a story whose record is lost and whose branch holds an old-wording workflow file, when `norn story checkout` restarts it, then the file loads and is pinned verbatim, its hash matching the branch file. — verifier: test
- AC7 Given a new unit started from the main checkout, when it pins its workflow, then the pinned text is in the new wording (flattened when it uses `use`/`like`). — verifier: test
- AC8 Given a throwaway repo with an old-wording workflow, when a person runs `norn doctor`, follows its `do_instead` to `norn upgrade`, and runs `norn doctor` again, then the second run reports no workflow issue. — verifier: agent

## Checks
- `bun run test`
- `bun run typecheck`

## Notes
D4, D5. Only the main-checkout reads refuse; the copy reads from slice 01 translate. The doctor, sync, story edit and checkout tests are in the integration tier (CI). AC8 is the user's path end to end and needs slice 08 merged by the time it is checked; it is not a build dependency.
