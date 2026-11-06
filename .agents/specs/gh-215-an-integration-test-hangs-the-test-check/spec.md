---
id: gh-215
slug: an-integration-test-hangs-the-test-check
provider: gh
number: 215
url: https://github.com/PruszynskiJakub/norn-next/issues/215
title: An integration test hangs the test check under parallel load until its 900s timeout
assignee: PruszynskiJakub
labels:
  - friction
  - norn
  - norn:kind:bug
  - norn:priority:high
  - norn:risk:low
  - norn:wf:reproduce
workflow: quick
status: active
intake_at: 2026-11-06T14:56:57.375Z
body_hash: 4e275a1346c117f013d53443686c23c7d14f33c02796dab8b6760b5b3f6d93ac
---

## Observed

gh-195/06 test#2 (2026-11-05 02:44–03:00Z) ran
`bun install --frozen-lockfile && bun run test && bun run test:integration && bun run typecheck`
and ended `timeout (900s)`. The unit tier passed (1208 tests). The integration tier stopped printing
and never finished, although `test:integration` sets `--timeout=20000` per test, so something hung
outside a single test's timeout (a hook, a child process, or a worker that never ended).
Three other slices were testing at the same time.

The implement session that followed (53 min) concluded that
`packages/cli/test/integration/upgrade-version.test.ts` hung under load: 5 of its 7 tests reported,
and it passes 3/3 alone. That is the agent's diagnosis and has not been reproduced. The next run
passed (132s).

Log: `<gh-195 spec>/runs/06-move-open-stories/logs/01M6MSG91Z216TN0FWD4BA43KK.log` (on the gh-195 story branch / its worktree).

## Wanted

The integration tier never hangs past the per-test timeout. A stuck test fails within its 20s with
its name in the log, instead of the whole check timing out after 15 min with no failing test named.

## Repro

`bun run test:stress 20 --tier integration` while other checks load the machine; watch for a run
that does not finish. Then minimise to the hanging file.

## Where

- `packages/cli/test/integration/upgrade-version.test.ts` (suspected)
- `package.json:8` (`test:integration`: `--parallel --timeout=20000`)

## Rules

None.
