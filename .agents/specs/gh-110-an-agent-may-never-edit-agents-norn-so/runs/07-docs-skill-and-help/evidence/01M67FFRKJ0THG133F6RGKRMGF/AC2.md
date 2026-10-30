# AC2 (B22) no product doc names .agents/norn/
`grep -rn ".agents/norn/" README.md .agents/PRD.md packages/cli/assets packages/*/src` → only packages/store/src/paths.ts:18-20 OLD_CONFIG_FILE/OLD_WORKFLOWS_DIR/OLD_TRACE_DIR (allowlisted, D4).
AGENTS.md Layout and "Where the contracts live": no match.
README:170 "Workflows are data" names `.agents/workflows/`; README:184 "Config" names `.agents/norn.config.yaml`; README:114 upgrade paragraph names `norn migrate`.
PRD: §7 tree line 142 `repos/<id>/` machine dir; ID2 (line 86) describes `~/.norn/repos/<id>/` and how <id> is derived.
`norn help` and `norn help <cmd>` for every listed command (dev build): 0 mentions (help-all.txt). `norn init` in a fresh repo: config at .agents/norn.config.yaml, workflows in .agents/workflows/, no .agents/norn/ (init.txt); no generated file names .agents/norn/.
Lint passes (tests.txt).
