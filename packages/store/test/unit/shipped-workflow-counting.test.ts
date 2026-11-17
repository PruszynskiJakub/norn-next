import { describe, expect, test } from "bun:test";
import { cpSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Workflow } from "@norn/schema";
import { loadWorkflows, workflowsDir } from "../../src/index.ts";
import { tmp } from "../helpers.ts";

const REPO = join(import.meta.dir, "../../../..");
const BUNDLED_DIR = join(REPO, "packages/cli/assets/workflows");
const REPO_DIR = join(REPO, ".agents/workflows");
// Copies of the shipped files as they stood before counters could be derived: a workflow
// installed then must keep loading to the same pin, whatever the shipped files become
const TODAY = join(import.meta.dir, "../fixtures/workflows-today");

/** Every workflow in a folder laid out like `.agents/workflows/`, loaded the way doctor and the tick load it. */
function loadFolder(dir: string) {
  const root = tmp();
  mkdirSync(workflowsDir(root), { recursive: true });
  cpSync(dir, workflowsDir(root), { recursive: true });
  const l = loadWorkflows(root);
  expect(l.errors).toEqual([]);
  return l.workflows;
}

describe("workflows installed before derived counters keep their pin", () => {
  const HASHES = {
    bundled: {
      quick: "d906278ad878d3baa4cdf705a5301d0c671a93dbb2e4a8c6ca63a90dee488e8a",
      refinement: "7173c147f34127f9c2e6206b676ff15d313201f4d4d97a48b5d36f8899e6d4eb",
      reproduce: "e4df0aba17eb6cd3e7bc29bcbf365f89ebf93623351b938b3e4ce3ba25d7fabc",
      slice: "f76d79e892f8b2ac98030c4994eab66a83854eda00a97a62e4ba62f0c4571aa2",
      story: "f57b64b10b974cfbc1199a0ad5f6baf7ec42928ad7a0add8e20bfce670c6c6be",
      triage: "4605c191643ebaf790ec4a83f699b2351008aa1f6fd22a6f66e56393fb061549",
    },
    repo: {
      quick: "c272fdb8d8db94835c97cc3198f55bb094193deba0224c62c6198772e4c4a37a",
      refinement: "796c9f1f7806267e24abc8c32cd08f94003155b4c0912148d7e8d92b951c5cfb",
      release: "409ef56e2d3b5c04bba7b4628664c3cde8325d7ffaedd823007c713745be59bf",
      reproduce: "1fae4a67f8f3d098d0e6fa0190d0b6ffeef08f81af25c614b4d3d24c77057c31",
      slice: "af30fe1129df5c3dbe4553997f0ca063561a88c2bb2ec677a36821539cf6dea8",
      story: "710dda2095e19daacefd51ce39f633d81d4061759222ec5ad791130b8aa27cb4",
      triage: "5420fd66358319a4373d939ce9d85ac8930305bb4399917f899470f8dc4b7ea3",
    },
  };

  for (const kind of ["bundled", "repo"] as const)
    test(`each ${kind} workflow as it was loads to the same source and hash`, () => {
      const loaded = loadFolder(join(TODAY, kind));
      expect(Object.fromEntries(Object.entries(loaded).map(([n, w]) => [n, w.hash]))).toEqual(HASHES[kind]);
    });
});

/**
 * How a workflow bounds its loops, without counter names: per counted edge its max and the edges that
 * reset it, and the groups of edges that share one counter.
 */
interface Counting {
  edges: Record<string, { max: number; reset?: string[] }>;
  shared: string[][];
}

function counting(wf: Workflow): Counting {
  const byCounter = new Map<string, string[]>();
  for (const [s, step] of Object.entries(wf.steps))
    for (const [o, route] of Object.entries(step.outcomes ?? {}))
      if (typeof route === "object" && route.counter) byCounter.set(route.counter, [...(byCounter.get(route.counter) ?? []), `${s}.${o}`]);
  const edges: Counting["edges"] = {};
  const shared: string[][] = [];
  for (const [c, es] of byCounter) {
    const spec = wf.counters?.[c];
    if (!spec) throw new Error(`counter ${c} is not declared`);
    const reset = spec.reset_on === undefined ? [] : [spec.reset_on].flat().sort();
    for (const e of es) edges[e] = reset.length ? { max: spec.max, reset } : { max: spec.max };
    if (es.length > 1) shared.push(es.sort());
  }
  return {
    edges: Object.fromEntries(Object.entries(edges).sort(([a], [b]) => a.localeCompare(b))),
    shared: shared.sort((a, b) => (a[0] as string).localeCompare(b[0] as string)),
  };
}

const NONE: Counting = { edges: {}, shared: [] };
const REFINEMENT: Counting = { edges: { "sync.conflict": { max: 2, reset: ["sync.done"] } }, shared: [] };
const SLICE: Counting = {
  edges: { "integrate.conflict": { max: 2 }, "review.changes_requested": { max: 3 }, "test.fail": { max: 5 } },
  shared: [],
};
const BASE_UPDATE = {
  "resolution-review.changes_requested": { max: 2 },
  "test-merge.fail": { max: 5 },
  "test-resolution.fail": { max: 5 },
  "test.fail": { max: 5 },
  "update.conflict": { max: 2, reset: ["update.clean", "update.done", "update.resolved"] },
};
const QUICK: Counting = {
  edges: {
    ...BASE_UPDATE,
    "ci.fail": { max: 3 },
    "ci.stale": { max: 10 },
    "merge.stale": { max: 10 },
    "ready.reject": { max: 2 },
    "ready.stale": { max: 10 },
    "review.changes_requested": { max: 3 },
    "sync.conflict": { max: 2, reset: ["sync.done"] },
  },
  shared: [
    ["ci.stale", "merge.stale", "ready.stale"],
    ["test-merge.fail", "test-resolution.fail", "test.fail"],
  ],
};
const STORY: Counting = {
  edges: {
    ...QUICK.edges,
    "approve-slices.reject": { max: 3 },
    "human-qa.reject": { max: 2 },
    "human-qa.stale": { max: 10 },
    "qa.fail": { max: 2 },
  },
  shared: [
    ["ci.stale", "human-qa.stale", "merge.stale", "ready.stale"],
    ["human-qa.reject", "qa.fail"],
    ["test-merge.fail", "test-resolution.fail", "test.fail"],
  ],
};
const RELEASE: Counting = {
  edges: {
    "ci.stale": { max: 10 },
    "merge.stale": { max: 10 },
    "ready.reject": { max: 2 },
    "ready.stale": { max: 10 },
    "update.conflict": { max: 2, reset: ["update.done"] },
  },
  shared: [["ci.stale", "merge.stale", "ready.stale"]],
};

/** The shipped workflows' counting as it stood before counters could be derived. */
const TABLE = {
  bundled: { quick: QUICK, refinement: REFINEMENT, reproduce: NONE, slice: SLICE, story: STORY, triage: NONE },
  repo: { quick: QUICK, refinement: REFINEMENT, release: RELEASE, reproduce: NONE, slice: SLICE, story: STORY, triage: NONE },
};

/**
 * Resets a workflow may add to the table, each harmless: `integrate.conflict` resetting on `integrate.done`,
 * an edge to `$done`, after which no lap is ever counted.
 */
const ACCEPTED_RESETS: Partial<Record<string, Record<string, string[]>>> = {
  slice: { "integrate.conflict": ["integrate.done"] },
};

function withoutAccepted(name: string, c: Counting): Counting {
  const accepted = ACCEPTED_RESETS[name] ?? {};
  const edges = Object.fromEntries(
    Object.entries(c.edges).map(([e, { max, reset }]) => {
      const kept = (reset ?? []).filter((r) => !accepted[e]?.includes(r));
      return [e, kept.length ? { max, reset: kept } : { max }];
    }),
  );
  return { edges, shared: c.shared };
}

describe("every shipped workflow keeps its counting", () => {
  for (const [kind, dir] of [["bundled", BUNDLED_DIR], ["repo", REPO_DIR]] as const)
    test(`each ${kind} workflow bounds the same edges by the same max, resets and sharing`, () => {
      const loaded = loadFolder(dir);
      const actual = Object.fromEntries(Object.entries(loaded).map(([n, w]) => [n, withoutAccepted(n, counting(w.workflow))]));
      expect(actual).toEqual(TABLE[kind]);
    });

  test("an accepted reset is the only difference the table forgives", () => {
    const slice = { edges: { "integrate.conflict": { max: 2, reset: ["integrate.done", "integrate.clean"] } }, shared: [] };
    expect(withoutAccepted("slice", slice)).toEqual({ edges: { "integrate.conflict": { max: 2, reset: ["integrate.clean"] } }, shared: [] });
    expect(withoutAccepted("quick", slice)).toEqual(slice);
  });
});
