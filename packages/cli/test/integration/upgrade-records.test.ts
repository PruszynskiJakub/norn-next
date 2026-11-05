/**
 * gh-195/17 (B35–B37; D14, D16; S10 retired): `norn upgrade` in the main checkout packs each finished
 * story's run state an older norn left in the base's tree into `refs/norn/runs/<story>`, pushes the
 * refs, then stages the removal of that run state and of the `runs/**` line in `.gitattributes`,
 * committing nothing (LY3). A rerun pushes only what is missing; a story whose push is rejected keeps
 * its run state, unstaged. `norn init` writes no `.gitattributes` line.
 */
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { recordRef } from "@norn/schema";
import { archiveTreeRunState, createHarness, type Harness, sh, toBaseRunState } from "../../../../test/support/harness.ts";

setDefaultTimeout(90_000);

const CONFIG = "provider: gh\nworkflow: quick\nmode: manual\n";
const OLD_ATTRIBUTES = "*.png binary\n# norn (machine state, collapsed in diffs)\n.agents/specs/*/runs/** linguist-generated=true gitlab-generated=true\n";
const SPEC = (n: number) => `.agents/specs/gh-${n}-finished-${n}`;
const STORIES = [1, 4, 7];

interface Upgraded {
  staged: string[];
  commit: string | null;
  run_state: Array<{ story: string; path: string; done: string; ref: string; reason?: string }>;
}

let h: Harness;
afterEach(() => h?.cleanup());

/** A repo set up by norn, with three finished stories' run state in main's tree and the S10 line, pushed. */
async function olderBase(): Promise<Harness> {
  h = await createHarness();
  expect((await h.norn("init")).exit).toBe(0);
  h.config(CONFIG);
  h.write(join(h.root, ".gitattributes"), OLD_ATTRIBUTES);
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn init"]);
  h.git(["push", "-q", "origin", "main"]);
  toBaseRunState(h.root, STORIES.map(SPEC));
  return h;
}

const remoteSha = (ref: string): string | null => sh(h.remoteDir, ["for-each-ref", "--format=%(objectname)", ref]).trim() || null;
const remoteTree = (ref: string) => sh(h.remoteDir, ["rev-parse", `${ref}^{tree}`]).trim();
const baseTree = (path: string) => sh(h.root, ["rev-parse", `HEAD:${path}`]).trim();
const stagedPaths = () => sh(h.root, ["diff", "--cached", "--name-only"]).trim().split("\n").filter(Boolean);
const unstaged = () => sh(h.root, ["diff", "--name-only"]).trim();
const head = () => sh(h.root, ["rev-parse", "HEAD"]).trim();
const statusItems = async () =>
  Object.values(((await h.norn("status", "--json")).value as { groups: Record<string, Array<{ id: string }>> }).groups)
    .flat()
    .filter((x) => x.id.startsWith("base_run_state:"));

describe("norn upgrade moves the base's run state into archive refs (B35)", () => {
  test("AC1: every story's ref is on the remote with its runs/ subtree as tree, the removals and the .gitattributes line staged, nothing committed; run list reads the ref; once committed, doctor and status no longer point to upgrade", async () => {
    await olderBase();
    const before = head();
    const trees = Object.fromEntries(STORIES.map((n) => [n, baseTree(`${SPEC(n)}/runs`)]));
    const r = await h.norn("upgrade", "--json");
    expect(r.exit).toBe(0);
    const v = r.value as Upgraded;
    expect(v.run_state.map((s) => `${s.story} ${s.done}`)).toEqual(["gh-1 pushed", "gh-4 pushed", "gh-7 pushed"]);
    for (const n of STORIES) expect(remoteTree(recordRef(`gh-${n}`))).toBe(trees[n] as string);
    // LY3: staged, never committed
    expect(head()).toBe(before);
    const staged = stagedPaths();
    for (const n of STORIES) expect(staged.filter((p) => p.startsWith(`${SPEC(n)}/runs/`)).length).toBeGreaterThan(0);
    for (const n of STORIES) expect(existsSync(join(h.root, SPEC(n), "runs"))).toBe(false);
    expect(staged).toContain(".gitattributes");
    expect(v.staged).toEqual(expect.arrayContaining([...STORIES.map((n) => `${SPEC(n)}/runs`), ".gitattributes"]));
    expect(readFileSync(join(h.root, ".gitattributes"), "utf8")).toBe("*.png binary\n");
    expect(unstaged()).toBe("");
    // the specs and slices stay
    expect(existsSync(join(h.root, SPEC(4), "story.md"))).toBe(true);
    const text = (await h.norn("upgrade")).stdout;
    expect(text).toContain("nothing to upgrade");

    // D16: run list reads the ref
    const list = (await h.norn("run", "list", "gh-1")).stdout;
    expect(list.split("\n").filter((l) => l.startsWith("round "))).toEqual(["round 1 · story · finished"]);

    // gh-195/16 AC6: once the removal is committed (and pushed), neither doctor nor status points to upgrade
    expect((await h.norn("doctor", "--repo", "--json")).value).toMatchObject({ repo: { run_state: { ok: false } } });
    h.git(["commit", "-q", "-m", "Move norn run state to archive refs (norn upgrade)"]);
    h.git(["push", "-q", "origin", "main"]);
    await h.norn("sync");
    expect((await h.norn("doctor", "--repo", "--json")).value).toMatchObject({ repo: { run_state: { ok: true, stories: [] } } });
    expect(await statusItems()).toEqual([]);
  });

  test("the markdown names each story, its ref and the commit to make", async () => {
    await olderBase();
    const text = (await h.norn("upgrade")).stdout;
    expect(text).toContain(`- gh-4: pushed ${recordRef("gh-4")}; removal of ${SPEC(4)}/runs staged`);
    expect(text).toContain(".gitattributes: dropped the `runs/**` line (staged)");
    expect(text).toContain("git commit -m");
  });

  test("AC2: a rerun after an interruption pushes only the missing refs; with nothing left it says so", async () => {
    await olderBase();
    // interrupted: gh-1's ref pushed, nothing removed yet
    const early = archiveTreeRunState(h.root, "HEAD", SPEC(1));
    const r = (await h.norn("upgrade", "--json")).value as Upgraded;
    expect(r.run_state.map((s) => `${s.story} ${s.done}`)).toEqual(["gh-1 already archived", "gh-4 pushed", "gh-7 pushed"]);
    expect(remoteSha(recordRef("gh-1"))).toBe(early);
    for (const n of STORIES) expect(stagedPaths().some((p) => p.startsWith(`${SPEC(n)}/runs/`))).toBe(true);
    const pushedRefs = STORIES.map((n) => remoteSha(recordRef(`gh-${n}`)));
    const again = await h.norn("upgrade", "--json");
    expect(again.exit).toBe(0);
    expect((again.value as Upgraded).run_state).toEqual([]);
    expect((again.value as Upgraded).staged).toEqual([]);
    expect(STORIES.map((n) => remoteSha(recordRef(`gh-${n}`)))).toEqual(pushedRefs);
    expect((await h.norn("upgrade")).stdout).toContain("no run state is left in its tree");
  });
});

describe("a rejected ref push removes nothing for that story (B36)", () => {
  test("AC3: gh-4's run state stays in the tree, unstaged; the others are staged; the output names gh-4 with the reason", async () => {
    await olderBase();
    const hook = join(h.remoteDir, "hooks", "pre-receive");
    writeFileSync(hook, `#!/bin/sh\nwhile read old new ref; do\n  case "$ref" in ${recordRef("gh-4")}) echo "archive refused" >&2; exit 1;; esac\ndone\nexit 0\n`);
    chmodSync(hook, 0o755);
    try {
      const r = await h.norn("upgrade", "--json");
      expect(r.exit).toBe(0);
      const v = r.value as Upgraded;
      expect(v.run_state.map((s) => `${s.story} ${s.done}`)).toEqual(["gh-1 pushed", "gh-4 failed", "gh-7 pushed"]);
      expect(v.run_state[1]?.reason).toContain(recordRef("gh-4"));
      expect(remoteSha(recordRef("gh-4"))).toBeNull();
      expect(existsSync(join(h.root, SPEC(4), "runs/_story/state.json"))).toBe(true);
      const staged = stagedPaths();
      expect(staged.some((p) => p.startsWith(`${SPEC(4)}/`))).toBe(false);
      expect(staged.some((p) => p.startsWith(`${SPEC(1)}/runs/`))).toBe(true);
      expect(staged.some((p) => p.startsWith(`${SPEC(7)}/runs/`))).toBe(true);
      const text = (await h.norn("upgrade")).stdout;
      expect(text).toMatch(/- gh-4: not moved, its run state stays in the tree \(not staged\): the push of refs\/norn\/runs\/gh-4 failed/);
    } finally {
      rmSync(hook, { force: true });
    }
    // once the remote takes it, a rerun moves gh-4 alone
    const v = (await h.norn("upgrade", "--json")).value as Upgraded;
    expect(v.run_state.map((s) => `${s.story} ${s.done}`)).toEqual(["gh-4 pushed"]);
  });

  test("S2: a story whose run state fails validation is not packed and nothing of it is removed", async () => {
    h = await createHarness();
    expect((await h.norn("init")).exit).toBe(0);
    h.config(CONFIG);
    h.git(["add", "-A"]);
    h.git(["commit", "-q", "-m", "norn init"]);
    toBaseRunState(h.root, [SPEC(1), SPEC(4)]);
    h.write(join(h.root, SPEC(4), "runs/_story/receipts/0099-done.json"), "{}\n");
    h.git(["add", "-A"]);
    h.git(["commit", "-q", "-m", "a broken receipt"]);
    h.git(["push", "-q", "origin", "main"]);
    const v = (await h.norn("upgrade", "--json")).value as Upgraded;
    expect(v.run_state.map((s) => `${s.story} ${s.done}`)).toEqual(["gh-1 pushed", "gh-4 failed"]);
    expect(v.run_state[1]?.reason).toContain("0099-done.json");
    expect(remoteSha(recordRef("gh-4"))).toBeNull();
    expect(stagedPaths().some((p) => p.startsWith(`${SPEC(4)}/`))).toBe(false);
  });
});

describe("norn init adds no .gitattributes line (B37)", () => {
  test("AC4: a fresh repository gets no .gitattributes; one the person has keeps only their lines", async () => {
    h = await createHarness();
    expect((await h.norn("init")).exit).toBe(0);
    expect(existsSync(join(h.root, ".gitattributes"))).toBe(false);
    h.write(join(h.root, ".gitattributes"), "*.png binary\n");
    expect((await h.norn("init")).exit).toBe(0);
    expect(readFileSync(join(h.root, ".gitattributes"), "utf8")).toBe("*.png binary\n");
  });
});
