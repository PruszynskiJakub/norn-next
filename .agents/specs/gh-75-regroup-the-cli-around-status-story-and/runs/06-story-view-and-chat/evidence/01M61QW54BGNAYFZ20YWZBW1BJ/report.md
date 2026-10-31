# QA gh-75/06 — story view and story chat

Full suite: 1264 pass, 0 fail; typecheck clean. Populated story driven through `runCli` (main.ts's entry) over the harness's real git repo with fake GitHub/Herdr/shell; main.ts itself run in a throwaway git repo.

| Criterion | Verdict | Evidence | Note |
|---|---|---|---|
| AC1 (B16) | pass | AC1-AC7-view.txt | |
| AC2 (B6, B70) | pass | AC2-json.txt | |
| AC3 (B17) | pass | AC3-web.txt | |
| AC4 (B29) | pass | AC4-chat.txt | |
| AC5 (B55) | pass | AC5-targets.txt | refusal says "name the unit" for a story verb |
| AC6 (B5) | pass | AC6-orient.txt, AC7-mainjs.txt | |
| AC7 (B16) | pass | AC1-AC7-view.txt, AC7-mainjs.txt | `story view gh-2/01` has no visible slice focus beyond Where-to-look keys |
