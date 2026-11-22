/**
 * The members evidence needs (plugin API 1.28): a vcs that keeps files in a commit on a ref and pushes
 * it, a forge that links a commit's file, a step kind that reads the evidence a report kept. All are
 * optional, so a provider written against an earlier minor still fits.
 */
import { describe, expect, test } from "bun:test";
import { Type } from "@sinclair/typebox";
import {
  defineNornPlugin,
  type Forge,
  forgeProblems,
  type KeptFile,
  ok,
  type ReportEvidence,
  type StepKindDefinition,
  type StepKindInput,
  type Vcs,
  vcsProblems,
} from "../../src/index.ts";

const SHA = "a".repeat(40);
const ctx = {
  exec: async () => ({ code: 0, stdout: "", stderr: "", timedOut: false }),
  files: { read: async () => null, write: async () => {}, create: async () => true, list: async () => [], remove: async () => {} },
  now: () => "2026-11-17T10:00:00.000Z",
  repo: { root: "/repo", dataDir: "/data" },
};

function baseVcs(): Vcs {
  return {
    name: "keeper",
    capabilities: { worktrees: true, merge: true, push: true },
    worktree: { ensure: async (u) => ok({ path: `/data/worktrees/${u}` }), remove: async () => ok(undefined), path: (u) => `/data/worktrees/${u}` },
    head: async () => ok(null),
    isAncestor: async () => ok(false),
    mergeBase: async () => ok(null),
    merge: async () => ok({ head: SHA }),
    push: async () => ok(undefined),
    fetch: async () => ok(undefined),
  };
}

function baseForge(): Forge {
  return {
    name: "linker",
    capabilities: { draft: true, checks: true, raw_urls: true },
    findChanges: async (branches) => ok(Object.fromEntries(branches.map((b) => [b, null]))),
    checks: async () => ok("none"),
    perform: async () => ({ ok: false, failure: { code: "invalid", message: "inert", retryable: false } }),
  };
}

describe("plugin API 1.28: evidence", () => {
  test("a vcs that keeps files, moves and pushes its ref, and a forge that links a commit's file, fit the contract and load", async () => {
    const kept: Array<{ ref: string; files: readonly KeptFile[]; message: string }> = [];
    const vcs: Vcs = {
      ...baseVcs(),
      keepFiles: async (ref, files, message) => {
        kept.push({ ref, files, message });
        return ok({ commit: SHA });
      },
      moveRef: async () => ok({ moved: true }),
      pushRef: async () => ok({ pushed: true }),
    };
    const forge: Forge = { ...baseForge(), fileUrl: async (commit, path, form) => ok(`https://forge.test/${commit}/${path}${form === "image" ? "?raw=true" : ""}`) };
    expect(vcsProblems(vcs)).toEqual([]);
    expect(forgeProblems(forge)).toEqual([]);
    const plugin = defineNornPlugin({
      name: "evidence-keeper",
      api: "^1.28",
      provides: { vcs: { keeper: { configSchema: Type.Object({}), create: () => vcs } }, forge: { linker: { configSchema: Type.Object({}), create: () => forge } } },
    });
    const made = plugin.provides.vcs?.keeper?.create(ctx, {}) as Vcs;
    expect(await made.keepFiles?.("refs/norn/evidence/gh-1", [{ path: "AC1.webp", at: "/data/run/evidence/AC1.webp" }], "gh-1 evidence")).toEqual(ok({ commit: SHA }));
    expect(kept).toEqual([{ ref: "refs/norn/evidence/gh-1", files: [{ path: "AC1.webp", at: "/data/run/evidence/AC1.webp" }], message: "gh-1 evidence" }]);
    expect(await made.moveRef?.("refs/norn/evidence/gh-1", SHA)).toEqual(ok({ moved: true }));
    expect(await made.pushRef?.("refs/norn/evidence/gh-1")).toEqual(ok({ pushed: true }));
    const linker = plugin.provides.forge?.linker?.create(ctx, {}) as Forge;
    expect(await linker.fileUrl?.(SHA, "AC1.webp", "image")).toEqual(ok(`https://forge.test/${SHA}/AC1.webp?raw=true`));
    expect(await linker.fileUrl?.(SHA, "AC3.log", "link")).toEqual(ok(`https://forge.test/${SHA}/AC3.log`));
  });

  test("a vcs and a forge without them fit the contract as before, and a plugin written against ^1.27 still loads", () => {
    expect(vcsProblems(baseVcs())).toEqual([]);
    expect(forgeProblems(baseForge())).toEqual([]);
    expect(baseVcs().keepFiles).toBeUndefined();
    expect(baseForge().fileUrl).toBeUndefined();
    const plugin = defineNornPlugin({ name: "older", api: "^1.27", provides: { vcs: { inert: { configSchema: Type.Object({}), create: () => baseVcs() } } } });
    expect(Object.keys(plugin.provides.vcs ?? {})).toEqual(["inert"]);
  });

  test("a step kind reads the evidence the story's latest criteria report kept, and does without it when there is none", async () => {
    const seen: Array<ReportEvidence | undefined> = [];
    const openPr: StepKindDefinition = {
      name: "open-pr",
      configSchema: Type.Object({}),
      outcomes: ["done"],
      mode: "effect",
      run: async (input) => {
        seen.push(input.evidence);
        return ok({ outcome: "done", detail: input.evidence?.files.map((f) => f.kept) ?? [] });
      },
    };
    const plugin = defineNornPlugin({ name: "reader", api: "^1.28", provides: { stepKinds: { "open-pr": openPr } } });
    const base: StepKindInput = { unit: "gh-1", story: "gh-1", step: "open-pr", config: {} };
    const evidence: ReportEvidence = { commit: SHA, files: [{ name: "AC1.png", kept: "AC1.webp" }] };
    const run = plugin.provides.stepKinds?.["open-pr"]?.run;
    expect(await run?.({ ...base, evidence }, ctx)).toEqual(ok({ outcome: "done", detail: ["AC1.webp"] }));
    expect(await run?.(base, ctx)).toEqual(ok({ outcome: "done", detail: [] }));
    expect(seen).toEqual([evidence, undefined]);
  });
});
