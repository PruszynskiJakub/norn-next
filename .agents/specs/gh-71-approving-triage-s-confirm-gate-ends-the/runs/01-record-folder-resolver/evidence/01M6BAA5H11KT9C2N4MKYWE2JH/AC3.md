# AC3 — dev build vs released norn 0.15.0 on one throwaway repo

Repo: harness-built (real git, bare remote) story gh-7 (workflow mini) at slices, slice gh-7/01 running at implement (auto, launched). Setup script: setup.ts (scratchpad). Repo snapshotted and restored between the two binaries so each saw identical state; env -i with NORN_HOME_DIR=<repo home>, USER=tester, NORN_MACHINE=box.
Dev: `bun packages/cli/src/main.ts …` at HEAD 652a68680. Released: `norn` {"version":"0.15.0"}.

```
DIFF  root.status_--json.out
DIFF  root.story_list_--json.out
DIFF  slice.brief_--json.out
same  root.run_list_gh-7-01_--json.out
same  root.run_list_gh-7-01.out
same  root.run_list_gh-7.out
same  root.run_view_gh-7-01.out
same  root.status.out
same  root.story_view_gh-7_--json.out
same  root.story_view_gh-7-01_--json.out
same  root.story_view_gh-7-01.out
same  root.story_view_gh-7.out
same  slice.brief.out
same  slice.status.out
```

Every DIFF, in full (split on commas):
### root.status_--json.out
```
1c1
< {"at":"2026-11-01T10:28:21.360Z"
---
> {"at":"2026-11-01T10:28:25.561Z"
```
### root.story_list_--json.out
```
1c1
< {"at":"2026-11-01T10:28:23.159Z"
---
> {"at":"2026-11-01T10:28:27.085Z"
80c80
< "inbox":{"at":"2026-11-01T10:28:23.159Z"
---
> "inbox":{"at":"2026-11-01T10:28:27.085Z"
```
### slice.brief_--json.out
```
6c6
< "briefing":"briefings/03PGFN3VV0KTHDP1W5EWHCB19Z/01M6BAEE9AG9V6YHSTPBV778DK.md"
---
> "briefing":"briefings/03PGFN3VV0KTHDP1W5EWHCB19Z/01M6BAEJ195CAHMJ8TQVW3ABQ0.md"
```
Only wall-clock `at` stamps (the commands ran seconds apart) and the briefing file's fresh ulid differ. Raw outputs: dev.*.out / rel.*.out in this folder.
