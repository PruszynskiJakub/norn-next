# AC4 (B31, B32)
Real CLI: `tidy --dry-run --json` -> trace {retain 14d, days [], hook_files [gh-3/01 10, gh-3 40], runs [OLD 50], bytes 100} (dry.json); listing after the dry run differs only by heartbeat.json/remote.json created by observe, no prunable file touched (before.txt vs after-dry.txt).
`tidy` then pruned them (bytes 100); a second `tidy` -> {"retain":"14d","days":[],"hook_files":[],"runs":[],"bytes":0} (tidy2.json).
Test "--dry-run lists … a second tidy prunes nothing (B31, B32)" passes.
