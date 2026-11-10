### Goal
The test harness's `h.config(...)` keeps the team file's recorded `norn_version` after `norn init`, so slice 02's refusal of a missing version does not refuse every harness test that rewrites config. Nothing a person sees changes.

### Proof
- AC1 (config with only local/user keys, or none for the team file, keeps the team file and its recorded `norn_version`): `packages/cli/test/integration/harness-config.test.ts` › "config with no team keys keeps the team file and its norn_version" and › "empty config keeps the team file and its norn_version" — both red before the harness change.
- AC2 (team keys written with the recorded `norn_version`, the version first): same file › "team keys are written with the norn_version, the version first" — red before.
- Slice note (a `norn_version` the test sets wins): same file › "a norn_version the test sets wins over the recorded one".
- `bun run test` (1732 pass) and `bun run typecheck` green. No golden case, transcript or observe snapshot changed.

### Easy to miss
- The version is kept only when the team file already records one: a harness repo that never ran `norn init` behaves as before (team file removed when no team key is left).
- Two tests leaned on the old drop: `housekeeping.test.ts` (doctor's "no version recorded" case) now writes a team file without the version explicitly; `skills-drift-hold.test.ts` (newer `norn_version` in gh-7's team file → not drift) now replaces the recorded version instead of appending a duplicate key.

### Not proven yet
- The full integration and e2e tiers run in CI. Locally I ran only the integration files that touch the team file or the version (version-*, upgrade*, init-version, config*, housekeeping, skills-drift-hold, watch-version, why-version, rename-continuity, runtime, record-ref, layout, mailbox-across-machines, takeover-record, the new harness-config): all green.

### Notes
- The harness test lives in the integration tier because `createHarness` runs real git; the unit tier forbids child processes.
- A test that needs a repo with no recorded version must now write the team file itself (as housekeeping's `atVersion(null)` does); slice 02's guard tests will want the same.

### Resume
Slice done; the next step reviews it. Nothing pending.
