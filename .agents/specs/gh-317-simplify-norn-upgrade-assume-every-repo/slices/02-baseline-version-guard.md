---
id: gh-317/02
title: Acting commands refuse a repo with no or a pre-0.30 norn_version
depends_on: [ gh-317/01 ]
status: integrated
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
  - { id: AC5, verifier: test }
  - { id: AC6, verifier: test }
  - { id: AC7, verifier: agent }
---

## Goal
Every command that acts refuses a repo whose `norn_version` is missing or below 0.30 with one message naming the exact path forward (the 0.30.x binary, or `norn init`), instead of running on default config; `watch` pauses on it and `norn status` shows it as an item to unblock.

## Scope
User stories: acting command on a pre-0.30 repo refused with the 0.30 path; acting command on a repo with no version refused with nothing written; init, help, doctor and upgrade still run on such a repo; release notes name the new refusal. Seams: S2 (the pure baseline rule beside the mismatch rule, and the inbox's version item), S1 (the guard through the harness). Out: upgrade's, doctor's and init's own use of the rule (03, 04).

## Acceptance
- AC1 Given a repo recording `norn_version` 0.29.4, when the baseline rule is asked about it, then it returns code `version_too_old`, error `this repo records norn_version 0.29.4; this norn moves a repo from norn 0.30 on`, needs `0.30.x`, and a `do_instead` saying install norn 0.30.x, run `norn upgrade`, commit, then run `norn upgrade` again with this norn (named by version); a repo recording 0.30.0 or later gets nothing from it and goes on to the usual mismatch rule. — verifier: test
- AC2 Given a repo recording no `norn_version`, when the baseline rule is asked about it, then it returns code `version_missing`, error `this repo records no norn_version`, needs `0.30.x`, and a `do_instead` that names `norn init` for a repo never set up and the same 0.30 path for a repo from an older norn. — verifier: test
- AC3 Given a repo recording 0.29.4, when an acting command (`norn tick`, `norn story start`) runs, then it exits 3 with code `version_too_old` and the rule's text, and nothing is written, no agent is launched and nothing is pushed. — verifier: test
- AC4 Given a repo recording no `norn_version`, when an acting command runs, then it exits 3 with code `version_missing` and the rule's text, and nothing is written, launched or pushed; a config that fails to load still gets its own config error (exit 6). — verifier: test
- AC5 Given a repo recording no or a pre-0.30 version, when `norn help`, `norn doctor`, `norn init` and `norn upgrade` run, then the guard does not stop them (each may refuse by its own check), and `norn watch` pauses its ticks with the same refusal. — verifier: test
- AC6 Given a repo recording no or a pre-0.30 version, when `norn status` runs, then it shows an Unblock item with the rule's text and the command `norn doctor`, not a Check item pointing to `norn upgrade`. — verifier: test
- AC7 Given this slice's commits, when a person reads them for the release notes, then they call out that a repo with no or a pre-0.30 `norn_version` is now refused, with the two codes. — verifier: agent

## Checks
- `bun run test`
- `bun run typecheck`

## Notes
D1–D4, D7. The rule's texts are pinned once at S2; the cli tests assert the code and that the text is the rule's. Risk from the plan: every test repo or e2e fixture that never ran `norn init` or wrote its team file by hand now refuses. Run `bun run test` early and fix each such repo by recording a version (the harness's `recordVersion` or init), never by weakening the guard; report how many in the handoff. The integration and e2e tiers run in CI; expect fixture fixes there too. `NO_VERSION_HINT` goes once nothing words the missing-version case but the rule.
