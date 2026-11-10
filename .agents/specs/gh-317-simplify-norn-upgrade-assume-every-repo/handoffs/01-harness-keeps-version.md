### Goal
The test harness's `h.config(...)` keeps the team file's recorded `norn_version` after `norn init`, so slice 02's refusal of a missing version does not refuse every harness test that rewrites config. Nothing a person sees changes.

### Proof
| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| AC1 | after `norn init`, config with only local/user keys (or none for the team file) leaves the team file in place with the same `norn_version` | test | `packages/cli/test/integration/harness-config.test.ts` › "config with no team keys keeps the team file and its norn_version", › "empty config keeps the team file and its norn_version" |
| AC2 | after `norn init`, config with team keys writes those keys plus the recorded `norn_version`, the version first | test | same file › "team keys are written with the norn_version, the version first" |
| Slice note | a `norn_version` the test sets through `h.config` wins over the recorded one | test | same file › "a norn_version the test sets wins over the recorded one" |

- `bun run test` and `bun run typecheck` green (test#1 check). Review re-ran harness-config, housekeeping and skills-drift-hold in the integration tier: 47 pass. No golden case, transcript or observe snapshot changed.
- review#1: approve, no findings.

### Easy to miss
- The version is kept only when the team file already records one: a harness repo that never ran `norn init` behaves as before (team file removed when no team key is left).
- Two tests leaned on the old drop: `housekeeping.test.ts` (doctor's "no version recorded" case) now writes a team file without the version explicitly; `skills-drift-hold.test.ts` (newer `norn_version` in gh-7's team file → not drift) now replaces the recorded version instead of appending a duplicate key.

### Not proven yet
- The full integration and e2e tiers run in CI. Locally I ran only the integration files that touch the team file or the version (version-*, upgrade*, init-version, config*, housekeeping, skills-drift-hold, watch-version, why-version, rename-continuity, runtime, record-ref, layout, mailbox-across-machines, takeover-record, the new harness-config): all green.

### Notes
- The harness test lives in the integration tier because `createHarness` runs real git; the unit tier forbids child processes.
- A test that needs a repo with no recorded version must now write the team file itself (as housekeeping's `atVersion(null)` does); slice 02's guard tests will want the same.

### Resume
Reviewed and approved; the next step (QA or the next slice) takes it from here. Nothing pending.
