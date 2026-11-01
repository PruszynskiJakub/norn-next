import { test } from "bun:test";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { setup, issue, storyUnitDir, cmd, log, tree } from "./common.ts";

test("scenario A: triage round → story round → forced triage round", async () => {
  const t = await setup();
  t.remote.issues = [issue(61, "Stranded story", ["norn", "norn:wf:triage"])];
  const spec = ".agents/specs/gh-61-stranded-story";
  const wt = () => `${t.root}-worktrees/gh-61-stranded-story`;
  const record = () => join(wt(), spec, "runs/_story");
  const runs = () => storyUnitDir(join(wt(), spec));
  const next = async () => { t.clock.advance(10_000); const r = await t.tick(); log("A-ticks.md", "tick", r.decisions.filter((d: any) => d.unit?.startsWith("gh-61")).map((d: any) => `${d.rule} ok=${d.ok}  ${d.warnings ? JSON.stringify(d.warnings) : ""}`).join("\n")); return r; };
  for (let i = 0; i < 8 && t.state(runs())?.status !== "running"; i++) await next();
  log("A-ticks.md", "state after intake", t.state(runs())); log("A-ticks.md","status",(await t.norn("status")).stdout);
  t.report(runs(), "done", { outcome: "story", handoff: "deliver it as a story" });
  await next();
  log("B10.md", "state: waiting at confirm", { step: t.state(runs())?.step, status: t.state(runs())?.status });
  await cmd(t, "B10.md", "story", "edit", "gh-61", "--workflow", "story");
  await cmd(t, "B10.md", "story", "edit", "gh-61", "--workflow", "story", "--json");
  log("B10.md", "state after refusal", { step: t.state(runs())?.step, status: t.state(runs())?.status, runs: runs().replace(t.dir, "<TMP>") });
  // B3: counter up in round 1
  await cmd(t, "B3.md", "story", "reject", "gh-61", "--reason", "look again");
  for (let i = 0; i < 4 && t.state(runs())?.status !== "running"; i++) await next();
  t.report(runs(), "done", { outcome: "story", handoff: "deliver it as a story" });
  await next();
  log("B3.md", "round 1 counters", t.state(runs())?.counters);
  // B5: manual in round 1
  await cmd(t, "B5.md", "story", "edit", "gh-61", "--manual");
  await next();
  log("B5.md", "round 1 mode", t.state(runs())?.mode);
  // B2
  await cmd(t, "B2.md", "story", "approve", "gh-61");
  await next();
  log("B2.md", "round 1 state", { round: t.state(runs())?.round, step: t.state(runs())?.step, status: t.state(runs())?.status, ended: (t.state(runs()) as any)?.ended });
  log("B2.md", "spec.md frontmatter status", readFileSync(join(wt(), spec, "spec.md"), "utf8").match(/status: \w+/)?.[0] ?? "?");
  log("B2.md", "worktree exists", String(existsSync(wt())));
  log("B2.md", "claim ref", t.git(["ls-remote", "origin", "refs/norn/claims/gh-61"]));
  t.clock.advance(10 * 60_000);
  const s = await t.norn("sync");
  log("B25.md", "sync decisions for gh-61", (s.value as any).decisions.filter((d: any) => d.unit === "gh-61").map((d: any) => d.rule));
  await cmd(t, "B25.md", "status");
  await cmd(t, "B25.md", "status", "--json");
  await cmd(t, "B28.md", "status");
  await cmd(t, "B28.md", "story", "view", "gh-61");
  log("B28.md", "handoff.md header (round 1)", readFileSync(join(record(), "handoff.md"), "utf8").split("\n").slice(0, 12).join("\n"));
  await cmd(t, "B29.md", "run", "list", "gh-61");
  // B31 person writes sections
  const h = join(record(), "handoff.md");
  t.write(h, readFileSync(h, "utf8") + "\n## Goal\nDeliver it.\n\n## Progress\n- triaged\n\n## Resume\nRefine the spec.\n");
  // refusals on finished round
  await cmd(t, "B16.md", "story", "edit", "gh-61", "--at", "explore");
  await cmd(t, "B16.md", "story", "edit", "gh-61", "--at", "explore", "--json");
  await cmd(t, "B17.md", "story", "edit", "gh-61", "--workflow", "sotry", "--force", "--json");
  await cmd(t, "B9.md", "story", "edit", "gh-61", "--workflow", "quick", "--at", "nope", "--json");
  tree(t, "B17.md", record(), "record after refusals (unchanged: no round receipt)");
  // B14 / B6: --force on finished round
  await cmd(t, "B14.md", "story", "edit", "gh-61", "--workflow", "story", "--force");
  await cmd(t, "B6.md", "story", "list");
  const r = await next();
  log("B6.md", "round 2 state", t.state(runs()));
  log("B6.md", "last commit", t.git(["log", "-1", "--format=%s"], wt()));
  log("B6.md", "branch", t.git(["rev-parse", "--abbrev-ref", "HEAD"], wt()));
  await cmd(t, "B6.md", "status");
  tree(t, "B30.md", record(), "record after round 2 starts");
  log("B30.md", "round 1 state", t.state(join(record(), "rounds/01-triage")));
  log("B19.md", "remote label calls", t.remote.calls.filter((c) => c.startsWith("label ")));
  log("B19.md", "issue labels", t.remote.issues[0].labels);
  log("B31.md", "handoff.md after round 2 starts", readFileSync(h, "utf8"));
  await cmd(t, "B28.md", "story", "view", "gh-61");
  await cmd(t, "B28.md", "status", "--json");
  // B15
  const c0 = t.state(runs())?.counters;
  await cmd(t, "B15.md", "story", "edit", "gh-61", "--at", "nope", "--json");
  await cmd(t, "B15.md", "story", "edit", "gh-61", "--at", "plan");
  await next();
  log("B15.md", "after tick", { round: t.state(runs())?.round, step: t.state(runs())?.step, counters: t.state(runs())?.counters, before: c0, runs: runs().replace(t.dir, "<TMP>") });
  // B11 / B32: forced end at plan (manual: ready, no agent)
  await cmd(t, "B11.md", "story", "edit", "gh-61", "--workflow", "triage");
  await cmd(t, "B11.md", "story", "edit", "gh-61", "--workflow", "triage", "--force");
  await next();
  log("B11.md", "round 3 state", { round: t.state(runs())?.round, workflow: t.state(runs())?.workflow, step: t.state(runs())?.step, runs: runs().replace(t.dir, "<TMP>") });
  log("B32.md", "round 2 state (forced)", t.state(join(record(), "rounds/02-story")));
  await cmd(t, "B29.md", "run", "list", "gh-61");
  await cmd(t, "B29.md", "run", "list", "gh-61", "--json");
  log("B28.md", "handoff.md header (round 3)", readFileSync(h, "utf8").split("\n").slice(0, 12).join("\n"));
  t.cleanup();
}, 120_000);
