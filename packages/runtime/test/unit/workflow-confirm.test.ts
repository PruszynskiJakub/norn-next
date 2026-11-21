/**
 * A repo's workflow file that changes what the person confirms (its person's steps, `attended:`,
 * `allow:`) is held: new rounds keep the revision last confirmed, or the pack's, until the person
 * confirms the file. Any other change runs as it is.
 */
import { describe, expect, test } from "bun:test";
import { memoryFiles, memoryHost } from "@norn/conformance";
import { forgeNonePlugin } from "@norn/forge-none";
import { DEFAULT_KERNEL_CONFIG, type LoadedWorkflow } from "@norn/kernel";
import { defineNornPlugin, type NornPlugin } from "@norn/plugin-api";
import { localStorePlugin } from "@norn/store-local";
import { localTrackerPlugin } from "@norn/tracker-local";
import { vcsGitPlugin } from "@norn/vcs-git";
import { confirmedWorkflowPath, createRuntimeEnv, readConfirmedWorkflows, type RepoWorkflows, type RuntimeConfig, stepsForgePlugin } from "../../src/index.ts";

const ship = (over: { review?: string; ready?: string } = {}) =>
  [
    "name: ship",
    "start: build",
    "steps:",
    "  build: { by: builder, do: Build it., outcomes: { done: review } }",
    `  review: ${over.review ?? "{ by: reviewer, do: Review it., allow: [docs:write], outcomes: { approve: ready, changes_requested: { to: build, max: 2 } } }"}`,
    `  ready: ${over.ready ?? "{ by: person, do: Approve to merge., outcomes: { approve: merge, reject: { to: build, max: 2 } } }"}`,
    "  merge: { by: forge.await-merge, outcomes: { merged: $done, unpushed: build } }",
    "",
  ].join("\n");
const OWN = "name: own\nstart: look\nsteps:\n  look: { by: writer, do: Look., outcomes: { done: ok } }\n  ok: { by: person, do: Is it right?, outcomes: { approve: $done, reject: { to: look, max: 2 } } }\n";
const PLAIN = "name: plain\nstart: look\nsteps:\n  look: { by: writer, do: Look., outcomes: { done: $done } }\n";

const pack = defineNornPlugin({ name: "norn-pack-tiny", api: "^1.4", provides: { packs: { tiny: { workflows: { "ship.yaml": ship() }, shared: {}, skills: {} } } } });
const PLUGINS: NornPlugin[] = [localTrackerPlugin, forgeNonePlugin, localStorePlugin, vcsGitPlugin, stepsForgePlugin, pack];
const config: RuntimeConfig = {
  tracker: { name: "local", config: { user: "me" } },
  forge: { name: "none" },
  store: { name: "local" },
  vcs: { name: "git" },
  executors: {},
  pack: "tiny",
  kernel: DEFAULT_KERNEL_CONFIG,
  intake: { label: "norn", assignee: "me" },
  base: "main",
  holder: "machine-a",
};

/** `gates`: the person gates the person's policy grants to a stand-in */
function envWith(workflows: Record<string, string>, confirmed: Record<string, string> = {}, gates: string[] = []) {
  const repoWorkflows: RepoWorkflows = { workflows, shared: {} };
  const r = createRuntimeEnv({ ctx: memoryHost(), plugins: PLUGINS, config: { ...config, standIn: { gates, attended: [] } }, launcher: {} as never, sessions: { facts: () => null }, repoWorkflows, confirmedWorkflows: confirmed });
  if (!r.ok) throw new Error(r.failure.message);
  return r.value;
}
const loaded = (env: ReturnType<typeof envWith>, name: string): LoadedWorkflow => {
  const load = env.workflows[name];
  if (!load?.ok) throw new Error(`${name} does not load: ${JSON.stringify(load)}`);
  return load.workflow;
};
const packShip = loaded(envWith({}), "ship");
const record = (w: LoadedWorkflow): string => JSON.stringify(w.pinned);

describe("a changed repo workflow is held for the person's confirmation", () => {
  test("a change to an instruction runs as written, with nothing held", () => {
    const env = envWith({ "ship.yaml": ship().replace("Build it.", "Build it test-first.") });
    expect(loaded(env, "ship").graph.steps.build?.agent?.instructions).toBe("Build it test-first.");
    expect(env.held).toEqual({});
  });

  test("a change to allow: or a person's step keeps new rounds on the pack's revision, and says what changed from it", () => {
    const wider = ship({ review: "{ by: reviewer, do: Review it., outcomes: { approve: ready, changes_requested: { to: build, max: 2 } } }" });
    const env = envWith({ "ship.yaml": wider });
    expect(loaded(env, "ship").pinned.hash).toBe(packShip.pinned.hash);
    expect(env.held.ship?.changes).toEqual(["step review: allow [docs:write] → [code:write]"]);
    expect(env.held.ship?.running).toEqual({ hash: packShip.pinned.hash, from: "pack" });
    expect(env.held.ship?.current.pinned.hash).not.toBe(packShip.pinned.hash);
    const gate = envWith({ "ship.yaml": ship({ ready: "{ by: person, do: Merge whenever., outcomes: { approve: merge, reject: { to: build, max: 2 } } }" }) });
    expect(gate.held.ship?.changes).toEqual(["person step ready changed"]);
  });

  test("once confirmed, the file runs, and a later change is weighed against the confirmed revision", () => {
    const wider = ship({ review: "{ by: reviewer, do: Review it., outcomes: { approve: ready, changes_requested: { to: build, max: 2 } } }" });
    const current = envWith({ "ship.yaml": wider }).held.ship?.current as LoadedWorkflow;
    const confirmed = { ship: record(current) };
    const env = envWith({ "ship.yaml": wider }, confirmed);
    expect(loaded(env, "ship").pinned.hash).toBe(current.pinned.hash);
    expect(env.held).toEqual({});
    // an edit to an instruction since needs nothing more
    expect(envWith({ "ship.yaml": wider.replace("Build it.", "Build it well.") }, confirmed).held).toEqual({});
    // back to the pack's own allow: still changes what the person confirmed, so it is held on their revision
    const back = envWith({ "ship.yaml": ship().replace("Build it.", "Build it well.") }, confirmed);
    expect(back.held.ship?.changes).toEqual(["step review: allow [code:write] → [docs:write]"]);
    expect(loaded(back, "ship").pinned.hash).toBe(current.pinned.hash);
    // and so is the repo's file removed, which leaves the pack's
    expect(envWith({}, confirmed).held.ship?.running).toEqual({ hash: current.pinned.hash, from: "confirmed" });
    // a change from both is held on the revision the person confirmed
    const attended = envWith({ "ship.yaml": wider.replace("do: Build it.,", "do: Build it., attended: person,") }, confirmed);
    expect(attended.held.ship?.changes).toEqual(["step build: attended none → person"]);
    expect(loaded(attended, "ship").pinned.hash).toBe(current.pinned.hash);
    expect(attended.held.ship?.running).toEqual({ hash: current.pinned.hash, from: "confirmed" });
  });

  test("a workflow only the repo has is weighed against no steps: one with a person's step is held until confirmed, with nothing to fall back to", () => {
    expect(envWith({ "plain.yaml": PLAIN }).held).toEqual({});
    const env = envWith({ "own.yaml": OWN });
    expect(env.held.own?.changes).toEqual(["person step ok added"]);
    const load = env.workflows.own;
    expect(load?.ok).toBe(false);
    expect(load?.ok ? "" : load?.errors[0]?.message).toContain("norn workflow confirm own");
    expect(env.held.own?.running).toBeNull();
    const current = env.held.own?.current as LoadedWorkflow;
    expect(loaded(envWith({ "own.yaml": OWN }, { own: record(current) }), "own").pinned.hash).toBe(current.pinned.hash);
  });

  test("a record that is not a pinned revision, or does not load to its hash, confirms nothing", () => {
    const wider = ship({ review: "{ by: reviewer, do: Review it., outcomes: { approve: ready, changes_requested: { to: build, max: 2 } } }" });
    const current = envWith({ "ship.yaml": wider }).held.ship?.current as LoadedWorkflow;
    for (const bad of ["not json", JSON.stringify({ name: "ship" }), JSON.stringify({ ...current.pinned, hash: "0".repeat(64) })]) {
      const env = envWith({ "ship.yaml": wider }, { ship: bad });
      expect(env.held.ship?.running).toEqual({ hash: packShip.pinned.hash, from: "pack" });
    }
  });
});

describe("a confirmed revision stands on the floor the policy sets now", () => {
  /** one more person's step before the merge: a guarded change, held, and still on the floor once ready is granted */
  const twoGates = (name: string) =>
    ship({ ready: "{ by: person, do: Approve to merge., outcomes: { approve: sign, reject: { to: build, max: 2 } } }" })
      .replace("name: ship", `name: ${name}`)
      .replace("  merge:", "  sign: { by: person, do: Sign it off., outcomes: { approve: merge, reject: { to: build, max: 2 } } }\n  merge:");

  test("a grant made after the person confirmed drops the revision the floor now refuses, and the held workflow says why", () => {
    const wider = ship({ review: "{ by: reviewer, do: Review it., outcomes: { approve: ready, changes_requested: { to: build, max: 2 } } }" });
    const confirmed = { ship: record(envWith({ "ship.yaml": wider }).held.ship?.current as LoadedWorkflow) };
    const env = envWith({ "ship.yaml": twoGates("ship") }, confirmed, ["ship.ready"]);
    expect(env.held.ship?.running).toBeNull();
    expect(env.workflows.ship?.ok).toBe(false);
    expect(env.held.ship?.refused).toContain("step merge (forge.await-merge) writes to the forge");
    expect(env.held.ship?.refused).toContain("the policy grants ready to a stand-in (policy.stand_in.gates)");
  });

  test("the grant is matched by the revision's own name:, not its file's", () => {
    const current = envWith({ "tidy.yaml": ship().replace("name: ship", "name: ship2") }).held.tidy?.current as LoadedWorkflow;
    const confirmed = { tidy: record(current) };
    expect(envWith({ "tidy.yaml": twoGates("ship2") }, confirmed).held.tidy?.running).toEqual({ hash: current.pinned.hash, from: "confirmed" });
    expect(envWith({ "tidy.yaml": twoGates("ship2") }, confirmed, ["ship2.ready"]).held.tidy?.running).toBeNull();
  });
});

describe("readConfirmedWorkflows", () => {
  test("reads each confirmed revision by workflow name from the machine dir", async () => {
    const dir = "/home/.norn/repos/repo-1";
    const files = memoryFiles({ [confirmedWorkflowPath(dir, "ship")]: "{}", [`${dir}/workflows/notes.txt`]: "x", [`${dir}/other.json`]: "y" });
    expect(confirmedWorkflowPath(dir, "ship")).toBe(`${dir}/workflows/ship.json`);
    expect(await readConfirmedWorkflows(files, dir)).toEqual({ ship: "{}" });
    expect(await readConfirmedWorkflows(memoryFiles({}), dir)).toEqual({});
  });
});
