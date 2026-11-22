import { describe, expect, test } from "bun:test";
import { memoryHost } from "@norn/conformance";
import { forgeNonePlugin } from "@norn/forge-none";
import { DEFAULT_KERNEL_CONFIG } from "@norn/kernel";
import { defineNornPlugin, type NornPlugin, ok } from "@norn/plugin-api";
import { Type } from "@sinclair/typebox";
import { localStorePlugin } from "@norn/store-local";
import { localTrackerPlugin } from "@norn/tracker-local";
import { vcsGitPlugin } from "@norn/vcs-git";
import { collectSignals, collectStepKinds, createRuntime, HOST_INPUTS, loadPackWorkflows, type RuntimeConfig, resolveSlots, SPEC_FOLDER_FILES, signalDeclarations, stepsForgePlugin } from "../../src/index.ts";

const pack = defineNornPlugin({
  name: "norn-pack-tiny",
  api: "^1.4",
  provides: {
    packs: {
      tiny: {
        workflows: { "tiny.yaml": "name: tiny\ndescription: one step\nstart: build\nsteps:\n  build:\n    check: bun test\n    timeout: 5m\n    outcomes: { pass: $done, fail: $stuck }\n" },
        shared: {},
        skills: {},
      },
    },
  },
});

const PLUGINS: NornPlugin[] = [localTrackerPlugin, forgeNonePlugin, localStorePlugin, vcsGitPlugin, stepsForgePlugin, pack];

const config = (over: Partial<RuntimeConfig> = {}): RuntimeConfig => ({
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
  ...over,
});

const ctx = memoryHost();

describe("resolveSlots", () => {
  test("finds every configured provider by name across the plugins", () => {
    const r = resolveSlots(ctx, PLUGINS, config());
    if (!r.ok) throw new Error(r.failure.message);
    expect([r.value.tracker.keyPrefix, r.value.forge.name, r.value.vcs.name]).toEqual(["lt", "none", "git"]);
    expect(Object.keys(r.value.stepKinds).sort()).toEqual(["await-checks", "await-merge", "integrate", "open-pr", "push", "update-branch", "verify-base"]);
  });

  test("a name no plugin provides is a refusal naming it", () => {
    const r = resolveSlots(ctx, PLUGINS, config({ forge: { name: "github" } }));
    expect(r.ok ? null : r.failure).toEqual({ code: "not_found", message: 'no configured plugin provides forge "github"', retryable: false });
    const p = resolveSlots(ctx, PLUGINS, config({ pack: "sdlc" }));
    expect(p.ok ? null : p.failure.message).toBe('no configured plugin provides pack "sdlc"');
    const e = resolveSlots(ctx, PLUGINS, config({ executors: { claude: { name: "claude" } } }));
    expect(e.ok ? null : e.failure.message).toBe('no configured plugin provides harness "claude"');
  });

  test("two plugins giving one step kind is a refusal naming both", () => {
    const again = defineNornPlugin({ name: "other", api: "^1.4", provides: { stepKinds: { push: vcsGitPlugin.provides.stepKinds?.push as never } } });
    const r = collectStepKinds([vcsGitPlugin, again]);
    expect(r.ok ? null : r.failure.message).toBe("step kind push is provided by norn-vcs-git and other");
  });

  test("each step kind and signal carries the namespace a workflow file names it by: the slot it works over, else its plugin's name", () => {
    const preview = { name: "preview", configSchema: Type.Object({}), outcomes: ["done"], mode: "effect" as const, run: async () => ok({ outcome: "done" }) };
    const read = async () => ok(null);
    const vercel = defineNornPlugin({ name: "vercel", api: "^1.21", provides: { stepKinds: { preview }, signals: { deployed: { read }, "ci-failed": { read, slot: "forge" } } } });
    const kinds = collectStepKinds([vcsGitPlugin, stepsForgePlugin, vercel]);
    if (!kinds.ok) throw new Error(kinds.failure.message);
    expect(Object.fromEntries(Object.entries(kinds.value).map(([k, d]) => [k, d.namespace]))).toEqual({
      "update-branch": "vcs",
      integrate: "vcs",
      push: "vcs",
      "verify-base": "vcs",
      "open-pr": "forge",
      "await-checks": "forge",
      "await-merge": "forge",
      preview: "vercel",
    });
    const signals = collectSignals([vercel]);
    if (!signals.ok) throw new Error(signals.failure.message);
    expect(Object.values(signalDeclarations(signals.value)).map((d) => `${d.namespace}.${d.name}`)).toEqual(["vercel.deployed", "forge.ci-failed"]);
  });
});

describe("loadPackWorkflows and createRuntime", () => {
  test("a pack's workflows load by name through the kernel loader", () => {
    const r = loadPackWorkflows(pack.provides.packs?.tiny as never, {});
    expect(r.ok && r.value.tiny?.ok).toBe(true);
  });

  test("a workflow file naming an input the host does not provide is refused at its path, naming the inputs it does", () => {
    const file = (inputs: string) => `name: typo\nstart: build\nsteps:\n  build:\n    agent: Build it.\n    inputs: ${inputs}\n    outcomes: { done: $done }\n`;
    const r = loadPackWorkflows({ workflows: { "typo.yaml": file("[spec, last_finding]"), "fine.yaml": file(`[${HOST_INPUTS.join(", ")}, { file: docs/x.md }]`) }, shared: {}, skills: {} }, {});
    if (!r.ok) throw new Error(r.failure.message);
    expect(r.value.typo).toEqual({ ok: false, errors: [{ path: "/steps/build/inputs/1", message: `\`last_finding\` is not an input norn provides: name one of ${HOST_INPUTS.join(", ")}, or a file as {file: <path>}` }] });
    expect(r.value.fine?.ok).toBe(true);
    expect([...HOST_INPUTS].sort()).toEqual(["base_side", "diff", "handoff", "last_check", "last_findings", "record", "resolution", "signal", "slice", "slices", "spec"]);
  });

  test("a step's by: names a role the pack registers for a step, or the shipped roles when the pack registers none", () => {
    const file = (role: string) => `name: r\nstart: build\nsteps:\n  build:\n    by: ${role}\n    do: Build it.\n    outcomes: { done: $done }\n`;
    const roles = { designer: { purpose: "Designs it.", allow: ["docs:write" as const] }, supervisor: { purpose: "Answers.", allow: ["answer" as const], supervises: true as const } };
    const r = loadPackWorkflows({ workflows: { "designer.yaml": file("designer"), "qa.yaml": file("qa"), "supervisor.yaml": file("supervisor") }, shared: {}, skills: {}, roles }, {});
    if (!r.ok) throw new Error(r.failure.message);
    expect([r.value.designer?.ok, r.value.qa?.ok, r.value.supervisor?.ok]).toEqual([true, false, false]);
    const shipped = loadPackWorkflows({ workflows: { "qa.yaml": file("qa") }, shared: {}, skills: {} }, {});
    expect(shipped.ok && shipped.value.qa?.ok).toBe(true);
  });

  test("a workflow file producing a file norn writes in the spec folder itself is refused, naming the ones it keeps", () => {
    const file = (produced: string) => `name: own\nstart: build\nsteps:\n  build:\n    agent: Build it.\n    produces: { notes: { file: ${produced} } }\n    outcomes: { done: $done }\n`;
    const r = loadPackWorkflows({ workflows: { "own.yaml": file("handoffs/x.md"), "fine.yaml": file("notes.md") }, shared: {}, skills: {} }, {});
    if (!r.ok) throw new Error(r.failure.message);
    expect(r.value.own).toEqual({ ok: false, errors: [{ path: "/steps/build/produces/notes/file", message: `\`handoffs/x.md\` is a file norn writes in the spec folder itself: name another (norn keeps ${SPEC_FOLDER_FILES.join(", ")})` }] });
    expect(r.value.fine?.ok).toBe(true);
    expect([...SPEC_FOLDER_FILES].sort()).toEqual([".gitignore", "handoffs/", "slices/", "spec.md"]);
  });

  test("createRuntime builds a runtime from resolvable config and refuses an unresolvable one", () => {
    expect(createRuntime({ ctx, plugins: PLUGINS, config: config(), launcher: {} as never, sessions: { facts: () => null } }).ok).toBe(true);
    expect(createRuntime({ ctx, plugins: PLUGINS, config: config({ store: { name: "refs" } }), launcher: {} as never, sessions: { facts: () => null } }).ok).toBe(false);
  });
});
