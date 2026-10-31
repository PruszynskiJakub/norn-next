# AC1 — tiers, fixtures, helpers, adapter rule
- `git ls-files packages/{store,adapters,view}/test | grep -v /(unit|integration)/` → only packages/store/test/helpers.ts and packages/adapters/test/contract/*.ts (shared helpers at the roots, as AC1 asks).
- No *.test.ts outside unit/ or integration/ in store, adapters, view (find, empty output).
- Adapters: unit/<adapter>/ for agent-hooks, claude, codex, gemini, gh, git, glab, headless, herdr, notify, opencode, process; integration/<adapter>/ for contract, git, headless, opencode, process. Fixtures moved with their tests; all suites green, so fixture paths resolve.
- test/repo.test.ts 49/0 (AC1-repo-rules.txt). Rule "every adapter has its tests in unit/<adapter>/ or integration/<adapter>/" present with a fixture case for either tier.
- Probe: added packages/store/test/qa-probe.test.ts → B17 rule failed naming that file (AC1-rule-bites.txt); probe removed, tree clean.
