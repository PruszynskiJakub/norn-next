# AC2 (B17) — a part in both places refuses with both_layouts
- config in both: status / status --json / tick --json / story list --json → exit 3, code `both_layouts`, error names `.agents/norn/config.yaml and .agents/norn.config.yaml`, "norn reads neither"; do_instead "keep one of each pair and remove the other, then run norn migrate in <root>".
- workflows in both → names `.agents/norn/workflows and .agents/workflows`.
- machine files in both → names `.agents/norn/trace and <home>/repos/repo-<id>` (absolute, outside the repo).
- snapshot of repo + norn home before/after: unchanged ("both(config): NOTHING CHANGED").
Evidence: AC2-AC4-both.txt; test layout-guard-test.log.
