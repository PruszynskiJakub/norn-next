import { versionBaseline } from "/Users/jakubpruszynski/Projects/norn-worktrees/gh-317-simplify-norn-upgrade-assume-every-repo/packages/core/src/index.ts";
for (const [repo, run] of [["0.29.4","0.31.0"],[null,"0.31.0"],["0.30.0","0.31.0"],["0.31.2","0.31.0"],["0.30.0","0.30.0"]] as const)
  console.log(JSON.stringify({ repo, running: run, rule: versionBaseline(repo as any, run) ?? null }));
