---
id: gh-250
slug: norn-fsd-round-s-5-minute-story-wait
provider: gh
number: 250
url: https://github.com/PruszynskiJakub/norn-next/issues/250
title: norn-fsd-round's 5-minute story wait doesn't fit a harness that moves long commands to the background
assignee: PruszynskiJakub
labels:
  - friction
  - norn
  - norn:kind:bug
  - norn:priority:medium
  - norn:risk:low
  - norn:wf:quick
workflow: quick
status: done
intake_at: 2026-11-06T15:42:12.222Z
body_hash: 6e8d570706f49264328ee31baec9a26d917c60cde50bfe48e836db2a61e08f08
merge:
  pr: 258
  url: https://github.com/PruszynskiJakub/norn-next/pull/258
  head_sha: f53f3c8cd20542668245c187c1295cd9da0dca58
  merge_commit_sha: c8e38e3388ae7e5da68f832f833fbe82533f0113
  merged_by: PruszynskiJakub
  merged_at: 2026-11-06T16:17:54.000Z
---

## Observed

Claude Code moves any foreground command that runs over ~180 s to the background. The skill tells each subagent to loop on `norn story wait <story> --until gate --timeout 5m` in the foreground, so every wait got moved. Subagents then improvised: two wrapped the norn commands in scratchpad scripts and watched them with Monitor; one such script was flagged as an auto-mode bypass, since a wrapper script hides the commands from the permission check. All of them settled on `--timeout 160s` (Bash timeout 178000) and `timeout 170 gh run watch`.

## Wanted

The skill sets each wait under the harness's foreground limit (for Claude Code: `--timeout 160s`, Bash timeout about 178 s, `timeout 170 gh run watch`), says to run every norn and gh command directly, never through a script or a background task, and words the brief's exit 7 as "the timeout passed", not "five minutes passed".

## Where

`packages/cli/assets/skills/norn-fsd-round/SKILL.md:20`, `:21`, `:28`

## Rules

SK3.
