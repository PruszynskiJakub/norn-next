# AC4: user config and leases stay in place
- Test: machine-dir.test.ts AC4 (user config.yaml read via `config list`, slot lease of gh-4 worktree read back from home/leases, top level = config.yaml, leases, repos; no jsonl/heartbeat at top) passes.
- By hand: home/config.yaml with max_agents: 3 and runner headless → `norn config get max_agents --json` source "user", path home/config.yaml; home top level = config.yaml, repos. store paths.ts:171-172 userConfigPath = home/config.yaml, leasesDir = home/leases (unchanged).
