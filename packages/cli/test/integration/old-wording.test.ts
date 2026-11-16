/**
 * The old wording at the cli (seam S7). A main-checkout workflow file in the old or a mixed wording
 * is an invalid workflow whose way out is `norn upgrade`: doctor reports one issue per file, story
 * create and story edit refuse it with `norn upgrade` in `do_instead`, a tick starts nothing from it
 * and the inbox names it. A story already running on an old-wording pin finishes its round on it, and
 * a new unit pins the new wording.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { sha256 } from "@norn/core";
import { parseWorkflowText, readState, recordErrors, workflowsDir, writeState } from "@norn/store";
import { createHarness, type Harness, issue } from "../../../../test/support/harness.ts";
import { runStateOf } from "../../../../test/support/run-state.ts";

setDefaultTimeout(60_000);

const ALT = `name: alt
start: draft
steps:
  draft:
    agent: Use the \`norn-implement\` skill.
    skills: [norn-implement]
    outcomes: { done: $done }
    means:
      done: "drafted"
`;
// alt as a person wrote it before the new wording
const ALT_OLD = `name: alt
start: draft
steps:
  draft:
    type: agent
    skill: norn-implement
    outcomes: { done: { to: $done, means: "drafted" } }
`;
const OLDY = ALT_OLD.replace("name: alt", "name: oldy");
// one step in the new wording that still carries an old key
const MIXED = `name: mixed
start: draft
steps:
  draft:
    agent: Draft it.
    skill: norn-implement
    outcomes: { done: $done }
    means:
      done: "drafted"
`;
// a workflow using a shared file, both in the new wording: the pin is the flattened text
const USES = "name: uses\nstart: core\nsteps:\n  core: { use: core }\n";
const CORE = `start: build
steps:
  build:
    agent: Use the \`norn-implement\` skill.
    skills: [norn-implement]
    outcomes: { done: $done }
    means:
      done: "built"
`;
const CONFIG = "provider: gh\nworkflow: alt\nmode: auto\n";
const UPGRADE = "norn upgrade";

type DoctorWorkflow = { name: string; file: string; ok: boolean; issues: Array<{ code: string; message: string }> };

async function setUp(files: Record<string, string>): Promise<Harness> {
  const t = await createHarness();
  expect((await t.norn("init")).exit).toBe(0);
  t.config(CONFIG);
  t.recordVersion();
  for (const [file, text] of Object.entries({ "alt.yaml": ALT, ...files })) t.write(join(workflowsDir(t.root), file), text);
  t.git(["add", "-A"]);
  t.git(["commit", "-q", "-m", "norn init"]);
  t.git(["push", "-q", "origin", "main"]);
  return t;
}

describe("a main-checkout file in the old wording is an invalid workflow whose way out is norn upgrade", () => {
  let t: Harness;
  const next = () => {
    t.clock.advance(10_000);
    return t.tick();
  };
  const doctor = async () => {
    const r = await t.norn("doctor", "--repo", "--json");
    return (r.value as { repo: { workflows: DoctorWorkflow[] } }).repo.workflows;
  };
  beforeAll(async () => {
    t = await setUp({ "oldy.yaml": OLDY, "mixed.yaml": MIXED });
    t.remote.issues = [issue(31, "Edit me")];
  });
  afterAll(() => t.cleanup());

  test("doctor reports one issue per old file, each naming the steps, their keys and norn upgrade; a mixed step is old", async () => {
    const workflows = await doctor();
    const oldy = workflows.find((w) => w.name === "oldy");
    const mixed = workflows.find((w) => w.name === "mixed");
    expect(oldy).toMatchObject({ file: ".agents/workflows/oldy.yaml", ok: false });
    expect(oldy?.issues).toEqual([
      expect.objectContaining({ code: "old_wording", message: "written in the old wording: step 'draft' (type, skill, means inside an edge); run `norn upgrade` to rewrite it and commit" }),
    ]);
    expect(mixed?.issues).toEqual([expect.objectContaining({ code: "old_wording", message: expect.stringContaining("step 'draft' (skill)") })]);
    expect(workflows.find((w) => w.name === "alt")?.ok).toBe(true);
    const text = await t.norn("doctor", "--repo");
    expect(text.stdout).toMatch(/FAIL workflow oldy +\.agents\/workflows\/oldy\.yaml/);
    expect(text.stdout).toContain(UPGRADE);
  });

  test("story create --workflow refuses an old file with norn upgrade in do_instead", async () => {
    const r = await t.norn("story", "create", "--title", "x", "--body", "y", "--workflow", "oldy", "--json");
    expect(r.exit).toBe(3);
    expect(r.value).toMatchObject({ code: "unknown_workflow", do_instead: expect.stringContaining(UPGRADE) });
    expect((r.value as { error: string }).error).toContain("old wording");
  });

  test("story edit --workflow refuses an old or mixed file as an invalid workflow, with norn upgrade in do_instead; no round starts", async () => {
    await next();
    for (const name of ["oldy", "mixed"]) {
      const r = await t.norn("story", "edit", "gh-31", "--workflow", name, "--json");
      expect(r.exit).toBe(3);
      expect(r.value).toMatchObject({ code: "invalid_workflow", do_instead: expect.stringContaining(UPGRADE), error: expect.stringContaining("old wording") });
    }
  });

  test("a tick starts no story on an old file and the inbox names it with norn upgrade", async () => {
    t.remote.issues = [...t.remote.issues, issue(7, "Old", ["norn", "norn:wf:oldy"])];
    const rules: string[] = [];
    // the remote sync is throttled and an earlier test's tick already ran it: the first tick forces one
    t.clock.advance(10_000);
    rules.push(...(await t.tick("--sync")).decisions.filter((d) => d.unit === "gh-7").map((d) => d.rule));
    for (let i = 0; i < 2; i++) rules.push(...(await next()).decisions.filter((d) => d.unit === "gh-7").map((d) => d.rule));
    expect(rules).toContain("start.workflow_invalid");
    const title = t.notifier.items.find((i) => i.story === "gh-7")?.title ?? "";
    expect(title).toContain("workflow 'oldy' is invalid");
    expect(title).toContain(UPGRADE);
  });
});

describe("a story in flight on an old-wording pin finishes its round on it", () => {
  let t: Harness;
  const spec = ".agents/specs/gh-51-in-flight";
  const runs = () => runStateOf(join(t.worktree("gh-51-in-flight"), spec));
  const next = () => {
    t.clock.advance(10_000);
    return t.tick();
  };
  beforeAll(async () => {
    t = await setUp({});
    t.remote.issues = [issue(51, "In flight")];
  });
  afterAll(() => t.cleanup());

  test("the pin loads, its text and hash stay as they were, and the story still reads after the round", async () => {
    for (let i = 0; i < 8 && t.state(runs())?.status !== "running"; i++) await next();
    expect(t.state(runs())).toMatchObject({ workflow: "alt", step: "draft", status: "running" });
    // the pin an older norn wrote when this round started: the old wording, its hash in state
    t.write(join(runs(), "workflow.yaml"), ALT_OLD);
    const st = readState(runs());
    if (!st.ok) throw new Error("no state");
    writeState(runs(), { ...st.value, workflow_hash: sha256(ALT_OLD) });

    t.report(runs(), "done", { outcome: "done", handoff: "drafted" });
    await next();
    expect(t.state(runs())).toMatchObject({ workflow: "alt", step: "$done", status: "done", workflow_hash: sha256(ALT_OLD) });
    expect(t.read(join(runs(), "workflow.yaml"))).toBe(ALT_OLD);
    // the story's run state reads back whole, its pin with it
    expect(recordErrors(runs())).toEqual([]);
  });
});

describe("a new unit pins the new wording", () => {
  let t: Harness;
  const spec = ".agents/specs/gh-61-fresh";
  const runs = () => runStateOf(join(t.worktree("gh-61-fresh"), spec));
  const next = () => {
    t.clock.advance(10_000);
    return t.tick();
  };
  beforeAll(async () => {
    t = await setUp({ "uses.yaml": USES, "shared/core.yaml": CORE });
    t.remote.issues = [issue(61, "Fresh", ["norn", "norn:wf:uses"])];
  });
  afterAll(() => t.cleanup());

  test("a workflow using a shared file is pinned flattened, in the new wording", async () => {
    for (let i = 0; i < 8 && t.state(runs())?.status !== "running"; i++) await next();
    const pin = t.read(join(runs(), "workflow.yaml"));
    expect(pin).not.toMatch(/\buse:/);
    // a main-checkout read refuses any old wording, so a pin it loads is in the new wording
    expect(parseWorkflowText(pin, "workflow.yaml", "checkout").ok).toBe(true);
    expect(t.state(runs())?.workflow_hash).toBe(sha256(pin));
  });
});
