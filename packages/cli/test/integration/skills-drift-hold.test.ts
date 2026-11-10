/**
 * Observe records each unit worktree's drifted bundled skills; a
 * tick launches a drifted unit like any other (its runs use the worktree's copies) and `norn status`
 * shows the difference as a Check item, while a repo-local skill never counts. A unit worktree whose
 * team file records a newer `norn_version` is not drift. The view's inbox equals `buildInbox` over
 * observe's Facts.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildInbox } from "@norn/core";
import { repoConfigPath, workflowsDir } from "@norn/store";
import { Context } from "../../src/index.ts";
import { projectView } from "../../src/runtime/human.ts";
import { createHarness, type Harness, issue } from "../../../../test/support/harness.ts";
import { observeNow } from "../../../../test/support/observe-now.ts";

setDefaultTimeout(30_000);

const SOLO = `name: solo
start: implement
steps:
  implement:
    type: agent
    skill: norn-implement
    outcomes: { done: $done }
`;
const DIFFER = "skills differ from norn 0.19.0 (norn): runs use this worktree's copies until the base is merged in, or until this branch's edit to them is reverted";

let h: Harness;
const wt = (key: string, slug: string) => h.worktree(`${key}-${slug}`);
const gh7 = () => wt("gh-7", "add-login-form");
const gh8 = () => wt("gh-8", "add-logout");
/** two ticks: the first applies what changed (the mode edit), the second launches */
async function ticks(): Promise<void> {
  for (let i = 0; i < 2; i++) {
    await h.tick();
    h.clock.advance(10_000);
  }
}
const launchedIn = () => h.runner.launches.map((l) => l.cwd);
type Groups = Record<string, Array<{ story: string; title: string; command: string }>>;

beforeAll(async () => {
  h = await createHarness({ version: "0.19.0" });
  expect((await h.norn("init")).exit).toBe(0);
  // manual first: the story worktrees are made and their agent steps wait for a person
  h.config("provider: gh\nworkflow: solo\nmode: manual\n");
  h.write(join(workflowsDir(h.root), "solo.yaml"), SOLO);
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn init"]);
  h.git(["push", "-q", "origin", "main"]);
  h.remote.issues = [issue(7, "Add login form", ["norn"]), issue(8, "Add logout", ["norn"])];
  for (let i = 0; i < 3; i++) {
    await h.tick();
    h.clock.advance(10_000);
  }
  expect(launchedIn()).toEqual([]);
  // A bundled skill edited by hand; Only a repo-local skill differs
  const norn = join(gh7(), ".agents/skills/norn/SKILL.md");
  writeFileSync(norn, `${readFileSync(norn, "utf8")}\nedited by hand\n`);
  h.write(join(gh8(), ".agents/skills/release/SKILL.md"), "---\nname: release\n---\nours, edited\n");
  for (const key of ["gh-7", "gh-8"]) expect((await h.norn("story", "edit", key, "--auto")).exit).toBe(0);
});
afterAll(() => h.cleanup());

describe("drifted skills hold nothing", () => {
  test("AC4, D5: observe records the drifted bundled skill, never the repo-local one", async () => {
    const obs = await observeNow(h);
    const unit = (key: string) => obs.facts.stories.find((s) => s.key === key)?.units[0];
    expect(unit("gh-7")?.skills_drift).toEqual(["norn"]);
    expect(unit("gh-8")?.skills_drift).toEqual([]);
    expect(obs.facts.norn?.skills_drift).toEqual([]);
  });

  test("gh-252: norn status shows the drifted unit as a Check item, nothing under Unblock; inbox parity holds", async () => {
    const r = await h.norn("status", "--json");
    expect(r.exit).toBe(0);
    const groups = (r.value as { groups: Groups }).groups;
    expect(groups.unblock ?? []).toEqual([]);
    expect(groups.check?.filter((i) => i.title === DIFFER).map((i) => [i.story, i.command])).toEqual([["gh-7", "norn story view gh-7"]]);
    const obs = await observeNow(h);
    const ctx = new Context(h.deps);
    await ctx.locate();
    expect((await projectView(ctx)).inbox).toEqual(buildInbox(obs.facts, obs.config));
  });

  test("gh-252: the tick launches both, the drifted gh-7 included", async () => {
    await ticks();
    expect(launchedIn().sort()).toEqual([gh7(), gh8()].sort());
  });

  test("AC2 (D14): gh-7's own team file records a newer norn_version → not drift", async () => {
    const team = repoConfigPath(gh7());
    writeFileSync(team, `${readFileSync(team, "utf8")}norn_version: 0.20.0\n`);
    const obs = await observeNow(h);
    expect(obs.facts.stories.find((s) => s.key === "gh-7")?.units[0]?.skills_drift).toEqual([]);
  });
});
