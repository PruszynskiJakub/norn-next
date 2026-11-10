### Goal

Every acting command refuses (exit 3) a repo recording no `norn_version` (`version_missing`) or one below 0.30 (`version_too_old`) with the rule's one message, before any write; `watch` pauses on it; `norn status` shows it as an Unblock item pointing to `norn doctor`.

### Proof

Review #1 approved it with no blocking findings. The unit tier (1736 pass), `bun run typecheck` and `version-baseline.test.ts` run on its own (10 pass) are green.

| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| AC1 | a repo recording 0.29.4 gets `version_too_old` with the 0.30.x path; 0.30.0+ gets nothing and goes on to the mismatch rule | test | `packages/core/test/unit/printed-commands.test.ts` › "the 0.30 baseline" › "a repo recording a version below 0.30…" and "a repo recording 0.30.0 or later gets nothing…" |
| AC2 | a repo recording no version gets `version_missing`, naming `norn init` and the 0.30 path | test | `printed-commands.test.ts` › "a repo recording no version is refused, naming norn init and the 0.30 path" |
| AC3 | `tick` and `story start` on a 0.29.4 repo exit 3 with `version_too_old`; nothing written, launched or pushed | test | `packages/cli/test/integration/version-baseline.test.ts` › "a repo recording below 0.30…" › "tick and story start exit 3…" and "every acting command gets the same refusal…" |
| AC4 | same with no version (`version_missing`); a config that fails to load still exits 6 | test | `version-baseline.test.ts` › "a repo recording no norn_version…" (same two tests) and "a config that fails to load is its own config error (exit 6)…" |
| AC5 | help, doctor, init and upgrade are not stopped by the guard; watch pauses with the same refusal | test | `version-baseline.test.ts` › "help, doctor, init and upgrade are not stopped by the guard" (both codes) and "watch pauses…" › "a tick after the team file loses its version is skipped…" |
| AC6 | status shows an Unblock item with the rule's text and `norn doctor`, not a Check item to `norn upgrade` | test | `packages/core/test/unit/version-inbox.test.ts` › "no version recorded → an Unblock item…" and "a version below 0.30 → an Unblock item…"; `version-baseline.test.ts` › "norn status shows an Unblock item…" |
| AC7 | the commits call out the new refusal with both codes for the release notes | agent | QA (agent): commit a131b03eb's message has a "Release note:" paragraph naming both codes |

### Easy to miss

- The baseline runs before `versionMismatch`, in `versionRefusal` (cli) and in `versionItem` (core). `watch` keys its notification memory on `repo ?? "none"`, because `null` was already its "not notified" value.
- A config that fails to load still returns early (exit 6) before the baseline.
- `NO_VERSION_HINT` is gone from core. doctor's own inline "no norn version recorded" warning (`packages/cli/src/commands/doctor.ts:240`) stays for slice 04 to replace.

### Not proven yet

- The integration and e2e tiers as a whole were not run locally. 3 test repos that never recorded a version were fixed (`agent-strays`, `check-run`, `run-rerun-check`). Other files that write the team file by hand (~30 integration, 4 e2e) may still lack a version, and CI will show which ones. Fix each by recording a version, never by weakening the guard.
- Two minor review notes, neither blocking: the watch pause is tested only for a missing version, not for 0.29.4 (it goes through the same `versionRefusal` path). The init/upgrade exemption is asserted only negatively, and slices 03 and 04 must rewrite that to assert each command's own refusal.

### Notes

- These tests pinned pre-0.30 versions for mismatch cases and were moved onto the 0.30/0.31/0.32 lines without changing what they check: `version-guard`, `watch-version`, `version-status`, `why-version`, `skills-drift-hold`, `skills-drift-refusal`, the patch case in `upgrade-version`, and core `skills-drift`/`version-inbox`.
- `config.test.ts`'s config set/unset block records a version after it deletes every config file.
- docs: one sentence each in `docs/concepts.md` and `docs/reference.md`; slice 03 does the full docs rewrite.

### Resume

Review approved. Next: QA against AC1–AC7 (AC7 by reading commit a131b03eb). If CI's integration or e2e tier fails with `version_missing`, record a version in that test's repo.
