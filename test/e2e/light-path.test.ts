/**
 * The light path after a base update, through the CLI runtime with real git: a workflow routing
 * `clean` and `resolved` from `git: update` takes them only when, since the round's latest
 * `approve`, the story has only base merges and spec-folder bookkeeping; new code or a changed
 * `spec.md` takes `done`. The update's receipt records the git summary the choice was made from.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Receipt } from "@norn/schema";
import { workflowsDir } from "@norn/store";
import type { TickReport } from "../../packages/cli/src/index.ts";
import { createHarness, type Harness, installBundledSkills, issue, runChecked, sh } from "../support/harness.ts";
import { runStateOf } from "../support/run-state.ts";

setDefaultTimeout(60_000);

const LIGHT = `name: light
start: update
steps:
  update:
    type: git
    action: update
    outcomes: { done: test, clean: test-merge, resolved: test-resolution, conflict: { to: resolve, counter: base_conflict_loop } }
  resolve:
    type: agent
    skill: norn-merge
    inputs: [spec, handoff]
    outcomes: { done: { to: update, means: "base merged, conflicts resolved and committed" } }
  test:
    type: check
    run: "true"
    timeout: 1m
    outcomes: { pass: open-pr, fail: $stuck }
  test-merge:
    type: check
    run: "true"
    timeout: 1m
    outcomes: { pass: open-pr, fail: $stuck }
  test-resolution:
    type: check
    run: "true"
    timeout: 1m
    outcomes: { pass: open-pr, fail: $stuck }
  open-pr:
    type: git
    action: open-pr
    outcomes: { done: ready }
  ready:
    type: gate
    outcomes: { approve: $done, reject: $stuck }
counters: { base_conflict_loop: { max: 2 } }
`;

const SPEC = ".agents/specs/gh-7-add-login-form";
const kinds = (r: TickReport) => r.decisions.filter((d) => d.kind !== "noop" && d.rule !== "claim.renew").map((d) => `${d.unit} ${d.rule}${d.ok ? "" : ` FAILED ${d.error}`}`);

function siblingMerge(h: Harness, file: string, text: string): string {
  const dir = join(h.dir, `sibling-${Math.random().toString(36).slice(2)}`);
  sh(h.dir, ["clone", "-q", "-b", "main", h.remoteDir, dir]);
  sh(dir, ["config", "user.email", "s@example.com"]);
  sh(dir, ["config", "user.name", "Sibling"]);
  writeFileSync(join(dir, file), text);
  sh(dir, ["add", "-A"]);
  sh(dir, ["commit", "-q", "-m", `sibling: ${file}`]);
  sh(dir, ["push", "-q", "origin", "main"]);
  return sh(dir, ["rev-parse", "HEAD"]);
}

describe("light path after a base update", () => {
  let h: Harness;
  const wt = () => h.worktree("gh-7-add-login-form");
  const runs = () => runStateOf(join(wt(), SPEC));
  const step = () => h.clock.advance(10_000);
  const until = async (pred: () => boolean, label: string, max = 20) => {
    const seen: string[] = [];
    for (let i = 0; i < max && !pred(); i++) {
      step();
      seen.push(...kinds(await h.tick()));
    }
    if (!pred()) throw new Error(`${label} not reached: ${JSON.stringify(h.state(runs()))}\n${seen.join("\n")}`);
    return seen;
  };
  const atReady = () => h.state(runs())?.step === "ready" && h.state(runs())?.status === "parked";
  const receipts = (kind: Receipt["kind"]) =>
    readdirSync(join(runs(), "receipts"))
      .sort()
      .filter((f) => f.endsWith(`-${kind}.json`))
      .map((f) => JSON.parse(readFileSync(join(runs(), "receipts", f), "utf8")) as Receipt & Record<string, unknown>);
  const lastUpdate = () => receipts("classify").filter((r) => r.step === "update").at(-1) as Record<string, unknown> & { outcome: string; route: string; history?: { anchor: string; commits: Array<Record<string, unknown>> } };
  /** approve at ready (the anchor), move the base, re-enter update, and return the update's receipt */
  const approveThenUpdate = async (beforeUpdate: () => void) => {
    await until(atReady, "ready");
    expect((await h.norn("story", "approve", "gh-7")).exit).toBe(0);
    await until(() => h.state(runs())?.status === "done", "done");
    beforeUpdate();
    expect((await h.norn("story", "update-branch", "gh-7")).exit).toBe(0);
    step();
    await h.tick("--sync");
    await until(() => !["update"].includes(h.state(runs())?.step ?? "update"), "past update");
    return lastUpdate();
  };

  beforeAll(async () => {
    h = await createHarness();
    h.config("provider: gh\nworkflow: light\nmode: auto\n");
    h.recordVersion();
    h.write(join(workflowsDir(h.root), "light.yaml"), LIGHT);
    installBundledSkills(h.root);
    writeFileSync(join(h.root, "a.txt"), "one\n");
    h.git(["add", "-A"]);
    h.git(["commit", "-q", "-m", "norn init"]);
    h.git(["push", "-q", "origin", "main"]);
    h.remote.issues = [issue(7, "Add login form")];
  });
  afterAll(() => h.cleanup());

  test("no approve in the round yet: the first update takes the full path", async () => {
    expect(kinds(await h.tick())).toEqual(["gh-7 remote.intake"]);
    step();
    await h.tick("--sync");
    await until(() => !["update", undefined].includes(h.state(runs())?.step), "past update");
    expect(lastUpdate()).toMatchObject({ outcome: "done", route: "test" });
    expect(lastUpdate().history).toBeUndefined();
  });

  test("a clean base merge since the approval ends clean, with the git summary in the receipt", async () => {
    let sibling = "";
    const r = await approveThenUpdate(() => {
      sibling = siblingMerge(h, "b.txt", "b\n");
    });
    const approved = receipts("approve").at(-1) as { head_sha?: string };
    expect(r).toMatchObject({ outcome: "clean", route: "test-merge" });
    expect(r.history?.anchor).toBe(approved.head_sha as string);
    // newest first: the update's own merge commit, its second parent the base
    const [merge] = r.history?.commits ?? [];
    expect(merge).toMatchObject({ from_base: true, remerge: [], paths: ["b.txt"] });
    expect((merge?.parents as string[])[1]).toBe(sibling);
    expect(h.git(["log", "-1", "--format=%P", merge?.sha as string], wt()).split(" ")).toEqual(merge?.parents as string[]);
  });

  test("a merge the resolver resolved since the approval ends resolved; the resolver's done records its head", async () => {
    // the story's own change to a.txt is approved first, then the base changes the same lines
    await until(atReady, "ready");
    writeFileSync(join(wt(), "a.txt"), "story side\n");
    h.git(["add", "-A"], wt());
    h.git(["commit", "-q", "-m", "story edits a"], wt());
    let sibling = "";
    const r1 = await approveThenUpdate(() => {
      sibling = siblingMerge(h, "a.txt", "base side\n");
    });
    expect(r1).toMatchObject({ outcome: "conflict", route: "resolve" });
    await until(() => h.state(runs())?.step === "resolve" && h.state(runs())?.status === "running", "resolve running");
    expect(Bun.spawnSync(["git", "merge", "--no-ff", sibling], { cwd: wt() }).exitCode).not.toBe(0);
    writeFileSync(join(wt(), "a.txt"), "story side\nbase side\n");
    h.git(["add", "a.txt"], wt());
    h.git(["commit", "-q", "--no-edit"], wt());
    const resolved = h.git(["rev-parse", "HEAD"], wt());
    const done = await runChecked(["done", "done", "--handoff", "merged main, kept both lines"], { ...h.deps, cwd: wt() });
    expect(done.exit).toBe(0);
    expect(receipts("done").at(-1)).toMatchObject({ outcome: "done", head_sha: resolved });
    await until(() => !["resolve", "update"].includes(h.state(runs())?.step ?? "update"), "past update");
    expect(lastUpdate()).toMatchObject({ outcome: "resolved", route: "test-resolution" });
    expect(lastUpdate().history?.commits.find((c) => c.sha === resolved)).toMatchObject({ from_base: true, remerge: ["a.txt"] });
  });

  test("code committed since the approval (new implement work) takes the full path", async () => {
    const r = await approveThenUpdate(() => {
      writeFileSync(join(wt(), "c.txt"), "new work\n");
      h.git(["add", "-A"], wt());
      h.git(["commit", "-q", "-m", "implement: c"], wt());
      siblingMerge(h, "d.txt", "d\n");
    });
    expect(r).toMatchObject({ outcome: "done", route: "test" });
  });

  test("a spec.md changed since the approval takes the full path", async () => {
    const r = await approveThenUpdate(() => {
      writeFileSync(join(wt(), SPEC, "spec.md"), `${readFileSync(join(wt(), SPEC, "spec.md"), "utf8")}\nchanged contract\n`);
      h.git(["add", "-A"], wt());
      h.git(["commit", "-q", "-m", "spec: change"], wt());
      siblingMerge(h, "e.txt", "e\n");
    });
    expect(r).toMatchObject({ outcome: "done", route: "test" });
  });
});
