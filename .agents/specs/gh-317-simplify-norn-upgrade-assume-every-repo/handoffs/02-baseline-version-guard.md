### Goal

Every acting command refuses (exit 3) a repo recording no `norn_version` (`version_missing`) or one below 0.30 (`version_too_old`) with the rule's one message, before any write; `watch` pauses on it; `norn status` shows it as an Unblock item pointing to `norn doctor`.

### Proof

- AC1, AC2 the rule's texts (pre-0.30 refusal; missing-version refusal naming `norn init`; 0.30.0+ gets nothing): `packages/core/test/unit/printed-commands.test.ts` › "the 0.30 baseline" (red before `versionBaseline` existed).
- AC6 inbox item: `packages/core/test/unit/version-inbox.test.ts` › "no version recorded → an Unblock item…" and "a version below 0.30 → an Unblock item…" (red before the `items.ts` change); at S1, `version-baseline.test.ts` › "norn status shows an Unblock item…" and `version-status.test.ts` › "no norn_version recorded → …".
- AC3, AC4 acting commands refused, nothing written, launched or pushed; every `acts` command listed: `packages/cli/test/integration/version-baseline.test.ts` › "tick and story start exit 3…" and "every acting command gets the same refusal…", for both codes. Also covers "a config that fails to load is its own config error (exit 6)". These went red when the cli guard change was reverted (5 of 10 failed; the status and exempt cases were already green because of the core change).
- AC5 help, doctor, init and upgrade not stopped by the guard; watch pauses: `version-baseline.test.ts` › "help, doctor, init and upgrade are not stopped by the guard" and "watch pauses its ticks…" (one `ticks paused` notification, refusal lines on the skipped ticks).
- AC7 release note: commit a131b03eb's message names the new refusal and both codes.
- `bun run test` (1736 pass) and `bun run typecheck` green. I ran the integration files touched one at a time, never the whole tier.

### Easy to miss

- The baseline runs before `versionMismatch`, in `versionRefusal` (cli) and in `versionItem` (core). `watch` keys its notification memory on `repo ?? "none"`, because `null` was already its "not notified" value.
- A config that fails to load still returns early (exit 6) before the baseline.
- `NO_VERSION_HINT` is gone from core. doctor's own inline "no norn version recorded" warning (`packages/cli/src/commands/doctor.ts:240`) stays for slice 04 to replace.

### Not proven yet

- The integration and e2e tiers as a whole were not run (the brief forbids it). Grepping for test repos that never record a version found 3 (fixed with `h.recordVersion()`): `agent-strays`, `check-run`, `run-rerun-check`. Test files that write the team file by hand may still lack a version; ~30 integration files and 4 e2e files touch the team file without naming `norn_version`. CI will show which ones refuse now. Fix each by recording a version, never by weakening the guard.
- In `version-baseline.test.ts`, the exempt-commands test only asserts that init and upgrade don't return the guard's refusal. Slices 03 and 04 give them their own baseline refusal with the same text, so they must rewrite that assertion. Asserting their own refusal is the right shape there.

### Notes

- These tests pinned pre-0.30 versions for mismatch cases and were moved onto the 0.30/0.31/0.32 lines without changing what they check: `version-guard`, `watch-version`, `version-status`, `why-version`, `skills-drift-hold`, `skills-drift-refusal`, the patch case in `upgrade-version`, and core `skills-drift`/`version-inbox`. In `version-guard`, the "no key works as today" cases now use a recorded version.
- `config.test.ts`'s config set/unset block deletes every config file before each test. It now records a version after deleting them, and its repo-file assertions compare against that file.
- docs: one sentence each in `docs/concepts.md` (the repo's norn version) and `docs/reference.md` (config). Slice 03 does the full docs rewrite.

### Resume

Nothing left in this slice. Next: review against AC1–AC7. If CI's integration or e2e tier fails with `version_missing`, record a version in that test's repo.
