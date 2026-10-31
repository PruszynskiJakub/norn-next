/**
 * `norn story reset` (GR7a): a story with no work of its own goes back to before intake — worktree,
 * local and remote branch, record, mailbox and claim gone, issue untouched — and the next sync takes it in
 * again from the current base. A story holding work is refused unless `--force`.
 * Real git: one clone of a bare remote.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { repoConfigPath, workflowsDir } from "@norn/store";
import type { TickReport } from "../src/index.ts";
import { createHarness, FakeInteraction, type Harness, issue, runChecked, sh } from "./harness.ts";

// whole flows over real git, several ticks each
setDefaultTimeout(30_000);

const MINI = `name: mini
start: plan
steps:
  plan:
    type: agent
    skill: norn-plan
    outcomes: { done: $done }
`;

const CONFIG = `agents:
  claude: { adapter: claude }
runner: { adapter: headless }
remote: { provider: gh, label: norn }
default_workflow: mini
default_mode: auto
notifiers: []
`;

const kinds = (r: TickReport) => r.decisions.filter((d) => d.kind !== "noop" && d.rule !== "claim.renew").map((d) => `${d.unit} ${d.kind}${d.ok ? "" : ` FAILED ${d.error}`}`);

let h: Harness;
const wt = (slug: string) => `${h.root}-worktrees/${slug}`;
const remoteHeads = () => h.git(["ls-remote", "--heads", "origin"]);

async function intake(n: number, title: string, slug: string) {
  h.remote.issues = [...h.remote.issues, issue(n, title, ["norn"])];
  h.clock.advance(10 * 60_000); // past the sync throttle (GR1)
  for (const want of [`gh-${n} intake_story`, `gh-${n} claim`, `gh-${n} start_unit`]) {
    h.clock.advance(10_000);
    expect(kinds((await h.norn("tick")).value as TickReport)).toContain(want);
  }
  expect(existsSync(wt(slug))).toBe(true);
  expect(remoteHeads()).toContain(`refs/heads/${slug}`);
}

beforeAll(async () => {
  h = await createHarness();
  expect((await h.norn("init")).exit).toBe(0);
  h.write(repoConfigPath(h.root), CONFIG);
  h.write(join(workflowsDir(h.root), "mini.yaml"), MINI);
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn init"]);
  h.git(["push", "-q", "origin", "main"]);
});
afterAll(() => h.cleanup());

describe("norn story reset (GR7a)", () => {
  test("without --yes and with no terminal it is refused; nothing changes (B36, B37)", async () => {
    await intake(8, "Add logout", "gh-8-add-logout");
    const before = remoteHeads();
    for (const r of [await runChecked(["story", "reset", "gh-8", "--json"], { ...h.deps, interaction: new FakeInteraction(true) }), await runChecked(["story", "reset", "gh-8"], { ...h.deps, interaction: new FakeInteraction(false) })]) {
      expect(r.exit).toBe(3);
      expect(r.value).toMatchObject({ code: "confirm_required", do_instead: "pass --yes" });
    }
    const asked = new FakeInteraction(true);
    asked.confirms = [false];
    const no = await runChecked(["story", "reset", "gh-8"], { ...h.deps, interaction: asked });
    expect(no.exit).toBe(0);
    expect(no.value).toMatchObject({ story: "gh-8", reset: false });
    expect(asked.questions).toEqual(["Reset gh-8? Worktrees for 1 units, its branches here and on the remote and its record will be deleted [y/N]"]);
    expect(existsSync(wt("gh-8-add-logout"))).toBe(true);
    expect(remoteHeads()).toBe(before);
  });

  test("a story with no work of its own: worktree, branches, record, mailbox and claim gone; the issue stays; the next sync takes it in again from the current base", async () => {
    // the base moves on after intake, as it did for the stories cut too early (#126)
    h.write(join(h.root, "later.txt"), "on main after intake\n");
    h.git(["add", "later.txt"]);
    h.git(["commit", "-q", "-m", "later"]);
    h.git(["push", "-q", "origin", "main"]);
    // a receipt another clone left for the old run (T9)
    const left = "refs/norn/inbox/gh-8/01JB0000000000000000000000";
    h.git(["update-ref", left, sh(h.root, ["hash-object", "-w", "--stdin"], "{}")]);
    h.git(["push", "-q", "origin", `${left}:${left}`]);
    h.git(["update-ref", "-d", left]);
    const calls = h.remote.calls.length;
    const r = await h.norn("story", "reset", "gh-8", "--yes");
    expect(r.exit).toBe(0);
    expect(r.value).toMatchObject({ story: "gh-8", reset: true, branches_deleted: ["gh-8-add-logout"], remote_branches_deleted: ["gh-8-add-logout"], mailbox_deleted: [left], claim_deleted: true });
    expect(existsSync(wt("gh-8-add-logout"))).toBe(false);
    expect(remoteHeads()).not.toContain("gh-8-add-logout");
    expect(h.git(["branch", "--list", "gh-8*"])).toBe("");
    expect(h.git(["ls-remote", "origin", "refs/norn/claims/gh-8"])).toBe("");
    expect(h.git(["ls-remote", "origin", "refs/norn/inbox/gh-8/*"])).toBe("");
    expect(h.remote.issues.find((i) => i.number === 8)?.state).toBe("open");
    expect(h.remote.calls.slice(calls).filter((c) => c.startsWith("pr+") || c.startsWith("pr~"))).toEqual([]);

    h.clock.advance(10 * 60_000);
    expect(kinds((await h.norn("tick")).value as TickReport)).toContain("gh-8 intake_story");
    expect(sh(wt("gh-8-add-logout"), ["show", "HEAD:later.txt"])).toBe("on main after intake");
  });

  test("a story holding work is refused has_work and nothing changes; --force resets it", async () => {
    await intake(9, "Add avatar", "gh-9-add-avatar");
    h.write(join(wt("gh-9-add-avatar"), "src.ts"), "export const x = 1;\n");
    sh(wt("gh-9-add-avatar"), ["add", "src.ts"]);
    sh(wt("gh-9-add-avatar"), ["commit", "-q", "-m", "code"]);
    const before = remoteHeads();
    const r = await h.norn("story", "reset", "gh-9", "--yes");
    expect(r.exit).toBe(3);
    expect(r.value).toMatchObject({ code: "has_work", error: expect.stringContaining("src.ts"), do_instead: "norn story close gh-9 keeps it; norn story reset gh-9 --force deletes it" });
    expect(existsSync(wt("gh-9-add-avatar"))).toBe(true);
    expect(remoteHeads()).toBe(before);

    // uncommitted changes outside the spec folder count too
    sh(wt("gh-9-add-avatar"), ["reset", "-q", "--soft", "HEAD~1"]);
    const dirty = await h.norn("story", "reset", "gh-9", "--yes");
    expect(dirty.value).toMatchObject({ code: "has_work", error: expect.stringContaining("uncommitted changes") });

    const forced = await h.norn("story", "reset", "gh-9", "--yes", "--force");
    expect(forced.exit).toBe(0);
    expect(forced.value).toMatchObject({ story: "gh-9", reset: true, remote_branches_deleted: ["gh-9-add-avatar"] });
    expect(existsSync(wt("gh-9-add-avatar"))).toBe(false);
    expect(remoteHeads()).not.toContain("gh-9-add-avatar");
  });
});
