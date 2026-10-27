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
status: active
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

## Triage

**Still occurs:** yes — on base `64300ad`: no pin exists anywhere, and drifted bundled skills are only a doctor warning.
**Repro:** in a throwaway repo under `$TMPDIR`, with this checkout's code:
```sh
git init -q && git commit -q --allow-empty -m init
bun …/packages/cli/src/main.ts init --json        # exit 0
grep -ni version .agents/norn/config.yaml          # no match: nothing records the norn version
echo drift >> .agents/skills/norn/SKILL.md
bun …/packages/cli/src/main.ts doctor --json | jq -c '{skills_ok: .skills.ok, drifted: .skills.drifted, warnings}'
# {"skills_ok":true,"drifted":["norn"],"warnings":["skills differ from this norn's bundled version: norn — run norn init to update them …"]}
```
`skills.ok` stays `true` with a drifted skill; the only signal is a warning string.
**Affected code:**
- `packages/store/src/skills.ts:169` — `skillsReport` computes `drifted`; its only caller is `doctor` (`packages/cli/src/commands/doctor.ts:350`). `brief`, `tick`, `watch` never check skills.
- `packages/cli/src/commands/doctor.ts:351,361` — `skillsOk` ignores `drifted`; drift becomes a warning.
- `packages/schema/src/config.ts` — `ConfigLayer` has no version key; `packages/cli/src/commands/init.ts` writes none.
- `packages/cli/src/cli.ts` — no common pre-check before acting commands where a refusal would go.
**PRD:** SK1 (doctor *reports* drift — the issue would make it block a step), W5 (load-time validation), P8 (`CliError`, `refused` = 3), X3 (distribution). A version pin and a refusal on mismatch are new rules not in the PRD today.
**Context:** CHANGELOG preamble: before 1.0 a minor version may change the machine contract, so a same-minor range is the natural pin. AGENTS.md Process ("the process always runs the latest released `norn`") is the self-hosting rule this would enforce. The issue's three open questions (pin format, refuse newer-on-older or only older-on-newer, rolling an upgrade out across collaborators with claims and units in flight, S7) are design decisions, not implementation detail.

**Recommend:** spec — this adds PRD rules (a config pin key, which commands refuse on a version mismatch or drifted skills, how upgrades roll out with units in flight) and changes SK1 from "report" to "block"; the open questions must be settled in the PRD before a story can be planned and sliced.
**Run:** `norn workflow gh-61 spec --to refine`
