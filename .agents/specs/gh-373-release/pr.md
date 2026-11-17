## Release 0.35.0

**Version 0.35.0** (minor, proposed): the `norn-pr` skill Door change is listed under Changed, and hook traces gain a new event kind, `background_wait`. Before 1.0, either one makes this a minor release.

## [0.35.0] - 2026-11-17

### Changed

- The `norn-pr` skill's Door counts the readers older than the change: a file the change rewrites in a new format (a config, a pipeline definition, stored data) is one-way for every reader not yet upgraded, and the PR says which one to upgrade first.

### Fixed

- A long-running `norn watch` no longer leaks a file descriptor per tick: its pause polls the wake file every 250 ms instead of opening a new file watch each tick, so a wake is seen within about 250 ms. After installing, restart every running `norn watch`: one started on an older norn keeps leaking until it is restarted.
- A `ps` probe that prints nothing with exit 0, fails to start or times out reads as unknown, never dead, so a process at its file limit can no longer reclaim every repo's live leases (which restarted running checks such as `ci` again and again).
- A Claude Code agent that ends its turn while its background subagents are still working is no longer refused, classified silent and nudged: the session counts as working until that work wakes it or `limits.stalled` passes. A turn end the Stop hook refused never reaches decide either. Hook traces gain the event kind `background_wait`.
- A Claude Code usage limit waits for its reset instead of parking the story: the turn shows as waiting for input ("usage limit reached") with no nudge, and the wait ends when Claude Code continues the session. The brief tells the agent that a usage limit, its own or a subagent's, is no reason for `norn stuck`.
- The workflow loader refuses a `use:` name or a step name that fails its pattern before reading any file or keying any step by it: `use: ../../outside` no longer loads a file outside `.agents/workflows/shared/`, and a step named `__proto__` next to a `like:` is refused instead of vanishing.

