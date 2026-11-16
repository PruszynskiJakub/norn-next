/**
 * Shared workflow files through the cli: a broken shared file shows wherever a broken workflow shows
 * (doctor, the listing, story create, story edit), a validation issue on an included step names its
 * shared file and step, a shared file is never startable, and a round pins the flattened workflow,
 * fingerprinted over that text, so a shared file edited after `story edit` refuses the round start.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { sha256 } from "@norn/core";
import { loadWorkflow, workflowsDir } from "@norn/store";
import { createHarness, type Harness, issue } from "../../../../test/support/harness.ts";
import { runStateOf } from "../../../../test/support/run-state.ts";

setDefaultTimeout(30_000);

const ALT = `name: alt
start: draft
steps:
  draft:
    type: agent
    skill: norn-implement
    outcomes: { done: { to: $done, means: "drafted" } }
`;
const SHIP = `start: build
steps:
  build:
    type: agent
    skill: norn-implement
    outcomes: { done: { to: $done, means: "built" } }
`;
const SHIPPER = `name: shipper
start: ship
steps:
  ship: { use: ship }
`;
const CONFIG = "provider: gh\nworkflow: alt\nmode: auto\n";

type DoctorWorkflow = { name: string; file: string; ok: boolean; issues: Array<{ message: string }> };

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

describe("a broken shared file shows wherever a broken workflow shows", () => {
  let t: Harness;
  const doctorWorkflow = async (name: string) => {
    const r = await t.norn("doctor", "--repo", "--json");
    return (r.value as { repo: { workflows: DoctorWorkflow[] } }).repo.workflows.find((w) => w.name === name);
  };
  beforeAll(async () => {
    t = await setUp({
      // an included step routing back with no counter
      "loopy.yaml": "name: loopy\nstart: core\nsteps:\n  core: { use: cycle }\n",
      "shared/cycle.yaml": `start: build
steps:
  build:
    type: agent
    skill: norn-implement
    outcomes: { done: { to: check, means: "built" } }
  check:
    type: agent
    skill: norn-review
    outcomes: { approve: { to: $done, means: "good" }, rework: { to: build, means: "again" } }
`,
      // an included step naming a counter the workflow does not declare
      "counted.yaml": "name: counted\nstart: core\nsteps:\n  core: { use: undeclared }\n",
      "shared/undeclared.yaml": `start: work
steps:
  work:
    type: agent
    skill: norn-implement
    outcomes: { done: { to: $done, means: "done" }, again: { to: work, counter: nope, means: "again" } }
`,
      // a shared file that is not there, beside a workflow broken as one could be before shared files
      "gone.yaml": "name: gone\nstart: core\nsteps:\n  core: { use: missing }\n",
      "bad.yaml": "name: bad\nstart: work\nsteps: 3\n",
    });
    t.remote.issues = [issue(31, "Edit me")];
  });
  afterAll(() => t.cleanup());

  test("AC1: doctor names the shared file and the step of an issue on an included step", async () => {
    const loopy = await doctorWorkflow("loopy");
    expect(loopy?.ok).toBe(false);
    expect(loopy?.issues.map((i) => i.message)).toContainEqual(expect.stringMatching(/^shared\/cycle\.yaml, step '(build|check)': cycle without a counter/));
    const counted = await doctorWorkflow("counted");
    expect(counted?.ok).toBe(false);
    expect(counted?.issues.map((i) => i.message)).toContainEqual("shared/undeclared.yaml, step 'work': counter 'nope' is not declared in counters");
  });

  test("AC2: a missing shared file is broken in doctor and the listing, and refused by story create and story edit as a broken workflow is", async () => {
    for (const name of ["gone", "bad"]) expect(await doctorWorkflow(name)).toMatchObject({ ok: false });
    expect((await doctorWorkflow("gone"))?.issues.map((i) => i.message).join("\n")).toContain("shared/missing.yaml");
    // story create lists only workflows that load, and refuses a broken one as unknown
    for (const name of ["gone", "bad"]) {
      const r = await t.norn("story", "create", "--title", "x", "--body", "y", "--workflow", name, "--json");
      expect(r.exit).toBe(3);
      const v = r.value as { code: string; do_instead: string };
      expect(v.code).toBe("unknown_workflow");
      // the listing it offers instead leaves the broken workflow out
      expect(v.do_instead).toContain("alt");
      expect(v.do_instead).not.toMatch(new RegExp(`[<|]${name}[|>]`));
    }
    t.clock.advance(10_000);
    await t.tick();
    for (const name of ["gone", "bad"]) {
      const r = await t.norn("story", "edit", "gh-31", "--workflow", name, "--json");
      expect(r.exit).toBe(3);
      expect(r.value).toMatchObject({ code: "invalid_workflow" });
    }
    const gone = await t.norn("story", "edit", "gh-31", "--workflow", "gone", "--json");
    expect((gone.value as { error: string }).error).toContain("shared/missing.yaml");
  });
});

describe("a shared file is never startable; a round pins the flattened workflow", () => {
  let t: Harness;
  const spec = ".agents/specs/gh-41-ship-it";
  const wt = () => t.worktree("gh-41-ship-it");
  const runs = () => runStateOf(join(wt(), spec));
  const next = () => {
    t.clock.advance(10_000);
    return t.tick();
  };
  const shipFile = () => join(workflowsDir(t.root), "shared/ship.yaml");
  const pinned = () => t.read(join(runs(), "workflow.yaml"));
  beforeAll(async () => {
    t = await setUp({ "shipper.yaml": SHIPPER, "shared/ship.yaml": SHIP });
    t.remote.issues = [issue(41, "Ship it")];
  });
  afterAll(() => t.cleanup());

  test("AC3: story edit --workflow naming a shared file is refused as an unknown workflow", async () => {
    await next();
    const r = await t.norn("story", "edit", "gh-41", "--workflow", "ship", "--json");
    expect(r.exit).toBe(3);
    const v = r.value as { code: string; do_instead: string };
    expect(v.code).toBe("unknown_workflow");
    expect(v.do_instead).toContain("shipper");
    expect(v.do_instead).not.toMatch(/[<|]ship[|>]/);
  });

  test("AC4: the round pins the flattened text; a shared edit after story edit refuses the start, the next edit takes it, a running round keeps its pin", async () => {
    for (let i = 0; i < 8 && t.state(runs())?.status !== "running"; i++) await next();
    t.report(runs(), "done", { outcome: "done", handoff: "drafted" });
    await next();
    expect(t.state(runs())).toMatchObject({ workflow: "alt", step: "$done", status: "done" });

    expect((await t.norn("story", "edit", "gh-41", "--workflow", "shipper")).exit).toBe(0);
    // the shared file changes between the edit and the tick
    const edited = SHIP.replace('means: "built"', 'means: "built and shipped"');
    t.write(shipFile(), edited);
    const rejected = await next();
    expect(rejected.decisions.filter((d) => d.unit === "gh-41").map((d) => d.rule)).toEqual(["round.workflow_changed"]);
    expect(t.state(runs())).toMatchObject({ workflow: "alt", step: "$done" });

    // the next edit takes the new text
    expect((await t.norn("story", "edit", "gh-41", "--workflow", "shipper")).exit).toBe(0);
    const started = await next();
    expect(started.decisions.filter((d) => d.unit === "gh-41").map((d) => d.rule)).toEqual(["round.start"]);
    expect(t.state(runs())).toMatchObject({ workflow: "shipper", round: 2, step: "build" });
    const pin = pinned();
    expect(pin).not.toMatch(/\buse:|\blike:/);
    expect(pin).toContain("built and shipped");
    const listed = loadWorkflow(t.root, "shipper");
    if (!listed.ok) throw new Error("shipper does not load");
    expect(pin).toBe(listed.value.source);
    expect(t.state(runs())?.workflow_hash).toBe(sha256(pin));

    // edited mid-round: the running round keeps its pin
    t.write(shipFile(), SHIP.replace('means: "built"', 'means: "built mid-round"'));
    await next();
    expect(t.state(runs())).toMatchObject({ workflow: "shipper", round: 2 });
    expect(pinned()).toBe(pin);
  });
});
