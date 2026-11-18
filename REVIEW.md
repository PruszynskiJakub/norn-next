# Reviewing a norn change

Short on purpose. The code rules in full are in [`docs/development.md`](docs/development.md#code-rules); `AGENTS.md` is the map.

## Skip

Generated or recorded, rewritten by a command, never by hand:

- `packages/schema/json/` (`bun run schema:emit`)
- `packages/kernel/test/golden/` (`bun run golden`; `--update` for an intended behaviour change)
- `packages/conformance/test/unit/fixtures/` (recorded harness sessions)

Judge the change that made them move, not the files.

## Sensitive paths

A diff that touches any of these gets the security checklist:

- `.github/workflows/`
- `scripts/`
- `packages/schema/src/`
- `packages/plugin-api/src/`
- `packages/host-node/`
- `packages/store-local/` and `packages/store-refs/`
- `packages/runtime/src/events/` (the hook answers: what an agent may write) and `packages/runtime/src/agent-bin.ts`

## What counts as a failure

- **A persisted format that breaks old records.** A schema or a kernel model changed so that a run state, receipt, claim or config an older norn wrote no longer validates or reads the same, with no upgrade in `packages/kernel/src/journal/format.ts`.
- **A plugin API break.** A slot's interface in `packages/plugin-api/src/` changed so that a plugin written against an earlier plugin API of the same major no longer loads or behaves the same. A new slot or method joins as optional.
- **A claim or store race.** Two ticks or two checkouts can both believe they own a story, or two writers racing on one unit, claim or mailbox can both succeed against the same expected version.
- **A write that breaks the journal's order.** A receipt written after its effect; a unit's state not committed last; a commit that lost a race forced instead of read again.
- **IO outside the boundary.** A file write or a process started anywhere but `@norn/host-node`, or a plugin reaching the machine other than through its `HostContext`.
- **A name from a file used before it is validated.** A name or shape from a workflow, config, tracker item or harness payload that reaches the file system, becomes an object key (`__proto__`), or is mutated before its schema check.
- **The kernel reaching for IO.** `node:fs`, `Bun.spawn`, `Date.now()` or a random id in `@norn/kernel`, instead of facts and `deriveUlid`.
- **A plugin deciding.** A plugin or step kind that picks the next step, or reads its own records as the state of a story.

## How to write a finding

- No style nits: the type check and the repo lints in the unit tier own style.
- Every finding cites a file and a line (`path/to/file.ts:42`) and says what goes wrong.
