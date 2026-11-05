## Release 0.21.1

**Proposed version:** 0.21.1 (patch): the two changes since v0.21.0 that users notice are fixes (#221, #220); nothing is Added, Changed or Removed and the machine contract is unchanged.

## [0.21.1] - 2026-11-05

### Fixed

- An issue body edited after a story is refined now raises the "issue body changed since refine" inbox item (GR8). norn recorded the refined body only for a refine step on a skill named `refine`, so every shipped workflow, whose refine step uses `norn-refine`, never got the item. A story already past its refine step records the issue body as it is on its next tick.
- A command whose `--json` output is over 64 KiB now prints all of it through a pipe (P8). Before, everything after the first 64 KiB was lost when stdout was a pipe (`norn … --json | jq`, a script, an agent's shell tool), while the exit code still said success.

Omitted: #219 (changes only this repo's own `slice` workflow check, not the shipped one) and d82e996 (this repo's `norn upgrade 0.21.0` commit).
