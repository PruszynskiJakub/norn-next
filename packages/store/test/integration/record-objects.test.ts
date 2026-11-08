/**
 * A record read from git objects into memory for a view (`readRecordObjects`). A
 * record commit whose tree names a blob the repository does not have reports that file and reads the
 * rest of the record as it is: the `cat-file --batch` stream stays aligned past a `missing` reply.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readRecordObjects } from "../../src/index.ts";
import { gitOk } from "../../src/git.ts";
import { tmp } from "../helpers.ts";

const ISOLATED = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "norn test", GIT_AUTHOR_EMAIL: "test@norn.invalid", GIT_COMMITTER_NAME: "norn test", GIT_COMMITTER_EMAIL: "test@norn.invalid" } as const;
const saved: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const [k, v] of Object.entries(ISOLATED)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
});
afterAll(() => {
  for (const k of Object.keys(ISOLATED)) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const state = (unit: string, slice: string | null, step: string, over: Record<string, unknown> = {}) =>
  JSON.stringify({
    version: 1,
    story: "gh-9",
    slice,
    unit_dir: unit,
    workflow: "trio",
    workflow_hash: "a".repeat(64),
    step,
    attempt: 1,
    visits: { [step]: 1 },
    step_entered_at: "2099-01-15T10:00:00.000Z",
    status: "ready",
    park: null,
    counters: {},
    nudges_used: 0,
    retries_used: 0,
    applied_through: 0,
    run: null,
    last_outcome: null,
    created_at: "2099-01-15T10:00:00.000Z",
    updated_at: "2099-01-15T10:00:00.000Z",
    last_tick_id: null,
    mode: "manual",
    ...over,
  });

describe("readRecordObjects", () => {
  test("F17: a blob missing from the repository is reported for its file; the units after it are still read", async () => {
    const root = tmp();
    await gitOk(root, ["init", "-q"]);
    const blob = async (text: string) => (await gitOk(root, ["hash-object", "-w", "--stdin"], text)).trim();
    const tree = async (lines: string[], missing = false) => (await gitOk(root, ["mktree", ...(missing ? ["--missing"] : [])], `${lines.join("\n")}\n`)).trim();
    // a receipt whose blob was never written, sorted before the states read after it
    const absent = "b".repeat(40);
    const receipts = await tree([`100644 blob ${absent}\t0001-done.json`], true);
    const story = await tree([`100644 blob ${await blob(state("_story", null, "review"))}\tstate.json`, `040000 tree ${receipts}\treceipts`]);
    const slice = await tree([`100644 blob ${await blob(state("01-ui", "gh-9/01", "implement"))}\tstate.json`]);
    const top = await tree([`040000 tree ${slice}\t01-ui`, `040000 tree ${story}\t_story`]);
    const sha = (await gitOk(root, ["commit-tree", top, "-m", "record"])).trim();

    const r = await readRecordObjects(root, "gh-9", sha);
    expect(r.errors).toEqual([{ file: "refs/norn/runs/gh-9:_story/receipts/0001-done.json", errors: [{ path: "", message: `object ${absent} missing from the repository` }] }]);
    expect(r.units.map((u) => [u.key, u.state.step])).toEqual([
      ["gh-9", "review"],
      ["gh-9/01", "implement"],
    ]);
  });

  test("a state an older norn wrote reads normalised, never as an error", async () => {
    const root = tmp();
    await gitOk(root, ["init", "-q"]);
    const blob = async (text: string) => (await gitOk(root, ["hash-object", "-w", "--stdin"], text)).trim();
    const tree = async (lines: string[]) => (await gitOk(root, ["mktree"], `${lines.join("\n")}\n`)).trim();
    // merged mid-round: done at the step it stood on
    const story = await tree([`100644 blob ${await blob(state("_story", null, "review", { status: "done" }))}\tstate.json`]);
    const top = await tree([`040000 tree ${story}\t_story`]);
    const sha = (await gitOk(root, ["commit-tree", top, "-m", "record"])).trim();

    const r = await readRecordObjects(root, "gh-9", sha);
    expect(r.errors).toEqual([]);
    expect(r.units.map((u) => [u.key, u.state.step, u.state.status])).toEqual([["gh-9", "$done", "done"]]);
  });
});
