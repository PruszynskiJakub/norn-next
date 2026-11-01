import { test } from "bun:test";
import { join } from "node:path";
import { setup, issue, storyUnitDir, cmd, log } from "./common.ts";
test("scenario E: --force at the confirm gate", async () => {
  const t = await setup();
  t.remote.issues = [issue(71, "Gate force")];
  const spec = ".agents/specs/gh-71-gate-force"; const wt = `${t.root}-worktrees/gh-71-gate-force`;
  const runs = () => storyUnitDir(join(wt, spec)); const st = () => t.state(runs()) as any;
  const next = async () => { t.clock.advance(10_000); return t.tick(); };
  for (let i = 0; i < 8 && st()?.status !== "running"; i++) await next();
  t.report(runs(), "done", { outcome: "story", handoff: "go" }); await next();
  log("B11.md", "gh-71 (scenario E) waits at", { step: st()?.step, status: st()?.status, park: st()?.park?.kind });
  await cmd(t, "B11.md", "story", "edit", "gh-71", "--workflow", "story", "--force");
  await next();
  log("B11.md", "gh-71 after tick", { round: st()?.round, workflow: st()?.workflow, step: st()?.step });
  log("B32.md", "gh-71 round 1 (forced at confirm) ended", (t.state(join(wt, spec, "runs/_story/rounds/01-triage")) as any)?.ended);
  await cmd(t, "B29.md", "run", "list", "gh-71");
  t.cleanup();
}, 120_000);
