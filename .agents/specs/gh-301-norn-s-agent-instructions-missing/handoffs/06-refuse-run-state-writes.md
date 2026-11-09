### Goal

In any unit step, a file-tool write whose path resolves under the checkout's `runs/` folder is denied with the reason that a hand-edited file fails validation and makes the unit `corrupt`; reads and shell commands are not inspected.

### Proof

- AC1 (a write under any unit's run state is denied with the corrupt reason, attended or not): `packages/core/test/unit/hook-answer.test.ts` › "hookAnswer: file-tool writes under run state" (this unit's, another unit's, a new file; attended; repeated). Through the harness: `packages/cli/test/integration/hook-run-state-writes.test.ts` › "a write to this unit's state, another unit's, or a file not there yet is denied with the corrupt reason".
- AC2 (relative, symlinked and not-yet-existing paths resolved by `norn hook`): `hook-run-state-writes.test.ts` › "a relative path, resolved against the payload's cwd, …", "a path through a symlink into run state is denied; one through a symlink elsewhere is allowed".
- AC3 (reads and shell commands not inspected; writes elsewhere allowed): core › "a read or a shell command under run state is not inspected", "a write elsewhere, or beside the folder under a name that only starts like it, is allowed"; harness › "a write elsewhere in the worktree is allowed, existing or not", "a read under run state and a shell command writing there are not inspected".
- Tests that went red first: the core describe above (2 of its 5 cases red before the code), and the harness file (3 of its 5 red).
- `bun run test` (1597 pass) and `bun run typecheck` green.

### Easy to miss

- Both sides are realpathed: on macOS the machine dir sits under `/var` → `/private/var`, so comparing an unresolved runs dir would miss.
- `runs-old/…` beside the folder must not match: `under` checks `dir` or `dir/` as prefix.
- Resolution runs only for a `file_write` tool call (hook latency); a deny needs a loadable unit session (D12).

### Not proven yet

- Codex `apply_patch` and Gemini `write_file`/`replace` paths go through the same resolution but only Claude payloads are exercised in the harness.

### Notes

- Core: `HookAnswerInput.fileWrite` (optional: resolved paths + resolved `runs/` dir) and `runStateWriteDeny` in `packages/core/src/hook.ts`; the reason reuses `ruleWithReason("no-run-state")`. Cli: `resolveWrite`/`fileWriteFacts` in `packages/cli/src/commands/hook.ts`.
- A deny is not yet traced as `blocked`: D9 (tracing tool refusals, `blockedHookCount` filtering on `turn_end`) belongs to gh-301/05; once both merge, this deny is traced through the same path.
- I ran the one new integration file locally once (red, then green) to see the harness cases fail; the integration tier itself was not run.
- Friction: a fresh worktree needs `bun install` before `bun run test`.

### Resume

Implementation done; next step is review.
