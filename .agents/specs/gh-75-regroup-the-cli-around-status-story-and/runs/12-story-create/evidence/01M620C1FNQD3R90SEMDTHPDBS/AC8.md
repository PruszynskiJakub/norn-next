# AC8 — unverified (needs: remote)
This session has no GitHub test repository it may create issues in; creating issues on a real remote is an outward effect the agent was not authorised for.
How to check (≈3 min), from a checkout of a throwaway GitHub repo with `gh auth status` OK and `norn init` done:
1. `bun <norn-checkout>/packages/cli/src/main.ts story create --title "QA story create" --workflow story --body "qa"`
   expect: prints `gh-N`; on GitHub issue #N has labels `norn`, `norn:wf:story` and is assigned to you; `norn status` lists gh-N as a new story with no step started.
2. `bun <norn-checkout>/packages/cli/src/main.ts story create --web --workflow story`
   expect: browser opens `https://github.com/<owner>/<repo>/issues/new?labels=norn%2Cnorn%3Awf%3Astory` with both labels pre-filled; no issue is created.
   (Both labels must exist on the repo for GitHub to pre-fill them.)
Same dev-build flow already observed end to end against a scripted gh (AC2.md, AC7.md evidence).
