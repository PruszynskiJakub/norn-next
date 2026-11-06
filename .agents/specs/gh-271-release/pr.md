## Release 0.25.0

**Version 0.25.0** (proposed): minor, because there are Changed entries (watch re-ticks and wakes, the reshaped shipped skills) and `norn tick`'s JSON gains `follow_up`.

## [0.25.0] - 2026-11-06

### Changed

- `norn watch` hands work on faster (H12, H13). After a tick that left the next one something to do at once (a receipt applied, a git step classified, a unit, round or slice started, a claim acquired, a story taken in), it runs the next tick at once instead of waiting its interval, at most 3 ticks in a row. A receipt another process writes (`norn done`, `norn ask`, `norn stuck`, `norn story answer`, a finished check) wakes it about a quarter second later; a missed wake costs at most the interval. `norn tick` stays one pass and its JSON gains `follow_up: true` when the next tick has work waiting.
- The shipped skills are shorter, with sharper descriptions that say when to use each one and which neighbour to use instead. A rule that two skills repeated now lives only in the one the other invokes (the terse-answer rule in `norn-interview`, reading the test helpers in `norn-tdd`), and `norn-qa` points to `norn-qa-person` for QA alongside a person.
- The shipped `norn-slice` skill keeps `depends_on` chains shallow: it adds an edge only when a slice cannot be built or tested without the other's code, aims for a critical path of a few levels, and reports the critical path and the slices that can start at once. It no longer claims that a check step runs a slice's `checks`.

### Fixed

- A unit's recovery commit no longer fails on every tick. Since run state moved to the machine dir (0.21.0), `recover.commit` tried to `git add` a path outside the repo; it now commits only the handoff.

