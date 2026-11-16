# Workflow meaning: origin/main (e419d33) vs HEAD, both loaded through the store's loadWorkflows; workflowHash from @norn/core
script: hash.ts (copied in this folder)

## repo set (.agents/workflows)
head errors: [] base errors: []
head listed: quick,refinement,release,reproduce,slice,story,triage
quick SAME aff5dfec53f0ecfb aff5dfec53f0ecfb routes 29 29 counters 8 use/like left: false
refinement SAME 857602d09580acba 857602d09580acba routes 7 7 counters 1 use/like left: false
release SAME 36ef29618e748de8 36ef29618e748de8 routes 12 12 counters 3 use/like left: false
reproduce SAME f047bb269ee19cc7 f047bb269ee19cc7 routes 2 2 counters 0 use/like left: false
slice SAME f99ea8fb7c44a3d6 f99ea8fb7c44a3d6 routes 8 8 counters 3 use/like left: false
story SAME df2f31a1aff91457 df2f31a1aff91457 routes 42 42 counters 10 use/like left: false
triage SAME d6e45e7276ac8ec4 d6e45e7276ac8ec4 routes 1 1 counters 0 use/like left: false

## bundled set (packages/cli/assets/workflows)
head errors: [] base errors: []
head listed: quick,refinement,reproduce,slice,story,triage
quick SAME 78142b725e014c43 78142b725e014c43 routes 29 29 counters 8 use/like left: false
refinement SAME 857602d09580acba 857602d09580acba routes 7 7 counters 1 use/like left: false
reproduce SAME 2821aef2588adc0d 2821aef2588adc0d routes 2 2 counters 0 use/like left: false
slice SAME f3948dd7d0ea6ed0 f3948dd7d0ea6ed0 routes 8 8 counters 3 use/like left: false
story SAME 887efb653b1edd5c 887efb653b1edd5c routes 42 42 counters 10 use/like left: false
triage SAME 08d8664d7c00b3c9 08d8664d7c00b3c9 routes 1 1 counters 0 use/like left: false

## grep checks at HEAD
$ grep -rl "gh pr checks" packages/cli/assets/workflows | xargs grep -l -- --watch
packages/cli/assets/workflows/shared/ship.yaml
$ grep -rl "gh run watch" .agents/workflows
.agents/workflows/shared/ci.yaml
$ grep -rnE ":\s+[&*][a-zA-Z]" (YAML anchors/aliases) both sets
none (base had e.g. story.yaml:74 run: &test-run bun test)
$ grep like:
packages/cli/assets/workflows/shared/base-update.yaml:38:    like: test
packages/cli/assets/workflows/shared/base-update.yaml:41:    like: test
.agents/workflows/shared/base-update.yaml:35:    like: test
.agents/workflows/shared/base-update.yaml:38:    like: test

Note: assets.test.ts / process.test.ts load through loadWorkflow (store) — see git diff origin/main...HEAD -- packages/cli/test/unit/assets.test.ts test/repo/process.test.ts
packages/cli/test/unit/assets.test.ts:8:import { loadWorkflow as loadRepoFile, loadWorkflows, workflowsDir } from "@norn/store";
packages/cli/test/unit/assets.test.ts:10:import { parse, parseDocument, visit } from "yaml";
packages/cli/test/unit/assets.test.ts:51:const templates = loadWorkflows(TEMPLATES_ROOT);
packages/cli/test/unit/assets.test.ts:52:const loadWorkflow = (f: string): Workflow => {
packages/cli/test/unit/assets.test.ts:142:    expect(workflowHash(loadWorkflow(`${name}.yaml`))).toBe(PINNED_HASHES[name] as string);
packages/cli/test/unit/assets.test.ts:147:      const wf = loadWorkflow(`${name}.yaml`);
packages/cli/test/unit/assets.test.ts:176:    const wf = loadWorkflow(file);
packages/cli/test/unit/assets.test.ts:234:  const wf = (name: string) => loadWorkflow(`${name}.yaml`);
packages/cli/test/unit/assets.test.ts:352:    const names = new Set(workflowFiles.flatMap((f) => Object.keys(loadWorkflow(f).steps)).filter((n) => !reserved.has(n)));
test/repo/process.test.ts:6:import { parse } from "yaml";
