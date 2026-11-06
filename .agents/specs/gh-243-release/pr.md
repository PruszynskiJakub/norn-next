## Release 0.22.0

**Proposed version: 0.22.0** (minor). Reason: before 1.0 a minor carries anything Changed and any machine-contract change; this release changes the way out of a run-out counter, adds `park.counter` to `state.json`, a `warning` to `run rerun --json` and `review` to `init --json`, and changes the shipped `norn-review` skill.

Also in this diff: `norn_version: 0.22.0` in `.agents/norn.config.yaml`, the README badge, and `.agents/skills/norn-review` refreshed from the bundled source.

### Changelog: [0.22.0] - 2026-11-06

#### Changed

- When a counter runs out (W4), the way out norn offers goes to the exhausted edge's target with the counter reset (`norn run rerun <unit> --step <to> --reset <counter>`, or only `--reset` when the target is `$done` or `$stuck`), not a plain rerun of the same step on unchanged code. The inbox's Unblock item, the next command and cockpit `u` all offer it.
  - The park in `state.json` records the counter, its max, the outcome and its target (`park.counter`). A unit that went stuck before this release has no such field and keeps the plain rerun, as do every other stuck reason, nudges and retries. An older norn marks a unit whose state has `park.counter` as `corrupt` (S2): do not downgrade while a unit is stuck on a counter.
  - A plain `norn run rerun` that leaves the counter at its max still runs; its JSON gains a `warning` that the same outcome ends stuck again, with the command that acts on it.
- The shipped `norn-review` skill checks each blocking candidate again before it decides (in a fresh subagent, or by reading the code again) and drops one that does not hold. It reads a `REVIEW.md` at the repo root for the paths to ignore, what counts as a failure and what not to report, and every finding names its file and line, with a summary that counts them.
- `norn init` writes a starter `REVIEW.md` when the repo has none and names it in the `git add` hint; one already there is left alone. `init --json` gains `review` (`created` or `exists`).

#### Fixed

- A step agent in a unit worktree (`NORN_RUN` set) that runs `norn story approve` or `norn story reject` is refused with `gate_by_agent`, exit 3, instead of having its decision recorded as the person's. The person, and delegated supervision from the main checkout, decide gates as before.

