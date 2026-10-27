---
id: gh-61
slug: pin-the-norn-version-a-repo-needs-and
provider: gh
number: 61
url: https://github.com/PruszynskiJakub/norn-next/issues/61
title: Pin the norn version a repo needs, and refuse a mismatched binary or drifted skills
assignee: PruszynskiJakub
labels:
  - norn
workflow: triage
status: new
intake_at: 2026-10-27T22:26:49.689Z
body_hash: 3eaa09aea6f4416e7f61f26ce4e67f08fa771ecccc1f9a64797b88f6ff0e714d
---

## Observed

Nothing records which norn a repo was set up with, so nothing notices when the binary and the repo drift apart:

- During the self-hosting bootstrap, `main` was at 0.9.1 while the installed binary was 0.8.0. No command warned.
- Bundled skill copies in `.agents/skills/norn*` that differ from the running binary's bundled skills are only a **warning** in `norn doctor` (`packages/cli/src/commands/doctor.ts:361`). `brief`, `tick` and `watch` run anyway, so agents can follow a protocol from a different version.
- Under the self-hosting rule "only the released binary runs the process" (AGENTS.md, Process), every collaborator's machine has to match what the repo expects, and today that rests on discipline alone.

## Wanted

- **A pin in the repo config.** `.agents/norn/config.yaml` records the norn version the repo was set up with, or a compatible range. `norn init` writes it, and re-running `init` with a newer binary moves the pin and refreshes the skills in the same diff.
- **Refuse on a mismatch.** A command that acts (`tick`, `watch`, `sync`, `brief`, `done`, `open`, …) refuses when the binary doesn't satisfy the pin. It prints a `CliError` and exits `refused` (3), with a `do_instead` naming the release to install or saying to run `norn init` to move the repo forward (P8). Read-only commands (`status`, `inbox`, `doctor`, `help`, `config`) keep working and show the mismatch.
- **Refuse on drifted skills.** Bundled skills that differ from the running binary's copies block starting an agent step, not just `doctor`. Repo-local skills (no `norn-` prefix) are not affected.
- **Doctor and CI.** `norn doctor` reports the pin and whether the binary satisfies it, in a form CI can run with the released binary. Related: a way for the released binary to validate a repo's workflows in CI.

## Open questions

- Pin format: an exact version, or a range such as `0.9.x`? Before 1.0 a minor version may break the machine contract (CHANGELOG preamble), so the compatible range is probably the same minor.
- Should a newer binary on an older pin be refused, or only an older binary on a newer pin?
- How is an upgrade rolled out across collaborators' machines, given claims and units in flight pinned under the old version (S7)?

## Where

- `packages/schema/src/config.ts`: `ConfigLayer` and `ResolvedConfig`, a new key.
- `packages/cli/src/commands/init.ts`: writes the pin.
- `packages/store/src/skills.ts:164-180`: drift detection already exists.
- `packages/cli/src/commands/doctor.ts:361`: the drift warning today.
- `packages/cli/src/cli.ts`: a common pre-check before acting commands.

## PRD

SK1 (skills copied by init; doctor reports drift), W5 (load-time validation), P8 (`CliError` and exit codes), X3 (distribution).
