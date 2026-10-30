---
id: gh-110/07
title: Docs, the shipped skill and help describe the new layout
depends_on: [gh-110/05, gh-110/06]
status: planned
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: person }
---

## Goal
Nothing shipped sends anyone to `.agents/norn/`: README, the PRD, AGENTS.md's product sections, `norn help`, init output and the shipped skills and config name `.agents/workflows/`, `.agents/norn.config.yaml`, the machine dir and `norn migrate`; the shipped norn skill's hard rule names only `runs/` and the generated top of handoff.md.

## Scope
Behaviour: B3, B22, B23. Seams: S2. Out: this repo's own process text and `.agents/skills/norn*` copies (D12: they keep the old paths until the follow-up story migrates this repo).

## Acceptance
- AC1 (B3) The shipped norn skill (`packages/cli/assets/skills/norn`) says never to edit `runs/` or the generated top of handoff.md, and names no other norn path as off limits; a repo lint test enforces it. — verifier: test
- AC2 (B22) No product doc or shipped text (README, `.agents/PRD.md`, `norn help`, `packages/cli/assets`, package sources' user-facing text, AGENTS.md's Layout and "Where the contracts live") names `.agents/norn/`; README's "Workflows are data" and "Config" paragraphs name `.agents/workflows/` and `.agents/norn.config.yaml`; the PRD's §7 layout and ID2 describe the machine dir. A repo lint test enforces the scan (D12's exceptions listed). — verifier: test
- AC3 (B22) `norn help` lists `migrate` with one line on what it does, in the help tree test. — verifier: test
- AC4 (B23) The story's PR description carries a "Release note" paragraph: after `norn migrate` an older norn cannot read the repository and must be upgraded on every machine. — verifier: person, because the changelog is written at release from the PR description and only the person judges it at the `ready` gate (D13).

## Checks
- `bun test test/repo.test.ts`
- `bun test packages/cli/test/help-tree.test.ts`
- `bun run typecheck`

## Notes
D12, D13. Do not edit `CHANGELOG.md`. The `.agents/skills/norn*` copies keep the narrowed rule already on this branch with the old paths. The story frontmatter title still says `.git/norn/`; it mirrors the GitHub issue and is the person's to update there.
