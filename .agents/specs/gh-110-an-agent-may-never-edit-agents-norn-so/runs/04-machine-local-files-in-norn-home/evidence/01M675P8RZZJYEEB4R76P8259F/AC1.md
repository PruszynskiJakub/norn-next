# AC1: after init + tick (throwaway repo scratchpad/w/app, NORN_HOME_DIR=scratchpad/w/home, dev build)
- Test: packages/cli/test/machine-dir.test.ts AC1 + tick-lock tests pass (see suite.txt).
- By hand: `git init app; norn init; commit; norn tick` →
  home/repos/app-f8c1edd7/{2026-10-30.jsonl, heartbeat.json, checkout.json, inbox.json, remote.json, workflows/*}
  - hash: python sha256(realpath(.git))[:8] = f8c1edd7, matches the dir name.
  - checkout.json = {"checkout": ".../scratchpad/w/app"}
  - tick.lock: appeared at home/repos/app-f8c1edd7/tick.lock while a tick ran (polled; gone after release).
  - working tree: .agents/norn holds only config.yaml + workflows/ (no trace/); nothing norn-ish in .git.
  - `git status --short` empty. .gitignore = "# norn (machine-local)\n.env.norn\n.norn-unit" (no trace line).
