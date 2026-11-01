import { afterAll, test, setDefaultTimeout } from "bun:test";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { repoConfigPath, workflowsDir, storyUnitDir } from "/Users/jakubpruszynski/Projects/norn-worktrees/gh-71-approving-triage-s-confirm-gate-ends-the--10-round-in-views/packages/store/src/index.ts";
import { createHarness, issue } from "/Users/jakubpruszynski/Projects/norn-worktrees/gh-71-approving-triage-s-confirm-gate-ends-the--10-round-in-views/test/support/harness.ts";
setDefaultTimeout(120_000);
const OUT = process.env.QA_OUT!;
const R = "/Users/jakubpruszynski/Projects/norn-worktrees/gh-71-approving-triage-s-confirm-gate-ends-the--10-round-in-views";
const CONFIG = `agents:
  claude: { adapter: claude }
remote: { provider: gh, label: norn, sync_interval: 5m }
default_workflow: triage
default_mode: auto
`;
const log: string[] = [];
const say = (s: string) => { log.push(s); };
test("AC5 scenario", async () => {
  const h = await createHarness();
  afterAll(() => h.cleanup());
  await h.norn("init");
  h.write(repoConfigPath(h.root), CONFIG);
  for (const wf of ["triage", "story", "quick"]) h.write(join(workflowsDir(h.root), wf + ".yaml"), readFileSync(join(R, ".agents/workflows", wf + ".yaml"), "utf8").replace("skill: triage", "skill: norn-qa"));
  h.git(["add", "-A"]); h.git(["commit", "-q", "-m", "norn"]); h.git(["push", "-q", "origin", "main"]);
  h.remote.issues = [issue(71, "Approving triage ends the story"), issue(72, "Forced triage")];
  const next = async () => { h.clock.advance(10_000); return h.tick(); };
  const wt = (slug: string) => `${h.root}-worktrees/${slug}`;
  const dirs = () => readdirSync(h.root + "-worktrees");
  const runsOf = (n: number) => { const d = dirs().find((x) => x.startsWith(`gh-${n}-`))!; return storyUnitDir(join(wt(d), ".agents/specs", d)); };
  const specOf = (n: number) => { const d = dirs().find((x) => x.startsWith(`gh-${n}-`))!; return join(wt(d), ".agents/specs", d); };
  const header = (n: number) => readFileSync(join(specOf(n), "runs/_story/handoff.md"), "utf8").split("\n").slice(0, 14).join("\n");
  const run = async (label: string, ...argv: string[]) => { const r = await h.norn(...argv); say(`\n### $ norn ${argv.join(" ")}   [${label}] (exit ${r.exit})\n\`\`\`\n${r.stdout || JSON.stringify(r.value, null, 2)}\n\`\`\``); return r; };
  for (let i = 0; i < 8; i++) await next();
  say(`## gh-71 round 1 triage, explore running\n\`\`\`\n${header(71)}\n\`\`\``);
  h.report(runsOf(71), "done", { outcome: "story", handoff: "deliver it as a story" });
  h.report(runsOf(72), "done", { outcome: "story", handoff: "deliver it as a story" });
  await next(); await next();
  await run("gh-72 waiting at confirm", "story", "view", "gh-72");
  // gh-71: triage finished by approve, then story round
  await run("approve", "story", "approve", "gh-71");
  await next();
  await run("edit", "story", "edit", "gh-71", "--workflow", "story");
  await next(); await next();
  say(`## gh-71 handoff header in round 2\n\`\`\`\n${header(71)}\n\`\`\``);
  // gh-72: forced at confirm
  await run("refused without force", "story", "edit", "gh-72", "--workflow", "story");
  await run("force", "story", "edit", "gh-72", "--workflow", "story", "--force");
  await next(); await next();
  say(`## gh-72 handoff header in round 2\n\`\`\`\n${header(72)}\n\`\`\``);
  await run("status md", "status");
  await run("status json", "status", "--json");
  await run("view md", "story", "view", "gh-71");
  await run("view json", "story", "view", "gh-71", "--json");
  await run("view md", "story", "view", "gh-72");
  await run("run list", "run", "list", "gh-71");
  await run("run list", "run", "list", "gh-72");
  // force gh-71's story round into quick round 3
  await run("force", "story", "edit", "gh-71", "--workflow", "quick", "--force");
  await next(); await next();
  say(`## gh-71 handoff header in round 3\n\`\`\`\n${header(71)}\n\`\`\``);
  await run("run list after round 3", "run", "list", "gh-71");
  await run("run list json", "run", "list", "gh-71", "--json");
  say("\n## round folders gh-71: " + readdirSync(join(specOf(71), "runs/_story/rounds")).join(", "));
  say("## round folders gh-72: " + readdirSync(join(specOf(72), "runs/_story/rounds")).join(", "));
  say("## gh-72 round 1 state: " + readFileSync(join(specOf(72), "runs/_story/rounds", readdirSync(join(specOf(72), "runs/_story/rounds"))[0], "state.json"), "utf8"));
  writeFileSync(join(OUT, "AC5-transcript.md"), log.join("\n"));
});
