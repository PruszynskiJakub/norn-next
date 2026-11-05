---
id: gh-139
slug: json-output-over-64-kib-is-cut-off-when
provider: gh
number: 139
url: https://github.com/PruszynskiJakub/norn-next/issues/139
title: JSON output over 64 KiB is cut off when stdout is a pipe
assignee: PruszynskiJakub
labels:
  - friction
  - norn
  - norn:kind:bug
  - norn:priority:medium
  - norn:risk:low
  - norn:wf:quick
workflow: quick
status: active
intake_at: 2026-11-05T16:45:30.411Z
body_hash: 4f95ac7a81472237b73dac4cb09404f17f965fc8faa761a6c31591c6d9c77bd8
---

## Observed

A command whose output is longer than 64 KiB loses the rest when its stdout is a pipe. Written to a file, the output is complete.

    norn story list --json | wc -c          # 65536
    norn story list --json > out.json; wc -c < out.json   # 85321
    norn story list --json | jq .           # jq: parse error: Unfinished string at EOF at line 1, column 65536

Seen with norn 0.14.0 on macOS in this repo (28 stories), while reading `norn story list --json` and `norn run list <story> --json` from a script during an assessment of norn's traces. Any program that reads norn through a pipe (scripts, `jq`, an agent's shell tool, the Herdr segment) gets truncated JSON on large repos, and the exit code still says success.

## Wanted

stdout carries the whole value on every exit path, whatever stdout is (pipe, file, TTY), so `--json` output always parses (P8).

## Repro

The same pattern, outside norn (Bun, macOS):

    // big.ts
    process.stdout.write("x".repeat(100000) + "\n");
    process.exit(0);

    bun big.ts | wc -c          # 65536
    bun big.ts > f; wc -c < f   # 100001

With norn: in a throwaway repo with enough stories that `story list --json` goes over 64 KiB, run `bun packages/cli/src/main.ts story list --json | wc -c`.

## Where

`packages/cli/src/main.ts:19-20`: `process.stdout.write(result.stdout)` then straight to `process.exit(result.exit)`. Exit does not wait for a pipe write that has not drained yet, so everything after the first 64 KiB pipe buffer is dropped. Fix it by waiting for the write to flush before exiting (write callback / `drain`, or set `process.exitCode` and let the process end), and add a test that pipes a >64 KiB value through the built binary. `watch` and the signal path (`main.ts:10`) exit the same way.

## PRD

P8 (machine contract: one JSON value on stdout + exit code).
