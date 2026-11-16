import { load, R } from "./lib.ts";
const F = await import(`${R}/packages/core/test/fixtures.ts`);
const { decide } = await import(`${R}/packages/core/src/decide/index.ts`);
const wfText = (by: string) => `name: wf\nstart: implement\nmode: auto\nsteps:\n  implement:\n    agent: Do it.\n    skills: [implement]\n${by}    outcomes: { done: $done }\n    means: { done: ok }\n`;
for (const by of ["    by: codex\n", ""]) {
  const l = load(wfText(by)); if (!l.ok) throw new Error(JSON.stringify(l));
  const wf = { ...l.workflow, name: "solo" };
  const unit = F.storyUnit("gh-1"); const st = F.stateFor(unit, wf);
  const s = F.storyFacts("gh-1", [F.unitFacts(unit, wf, st, { run: null, worktree: { path: "/r-worktrees/gh-1-login", exists: true, status: null, last_commit_at: null, last_file_change_at: null, slot: 1 } })], { frontmatter: { ...F.storyFacts("gh-1", []).frontmatter, workflow: "solo", intake_at: F.at(F.T0 - 3600000) } });
  const d = decide(F.facts([s]), { solo: F.loaded(wf) }, F.CONFIG).find((x: any) => x.unit === "gh-1");
  const a = d.action;
  console.log(`${by.trim() || "(no by:)"} -> model.agent=${JSON.stringify(wf.steps.implement.agent)} config.agent=${F.CONFIG.agent} | action=${a.kind} launch.agent=${a.launch?.agent} started.agent=${a.receipts?.[0]?.receipt?.agent}`);
}
