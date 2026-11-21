import { describe, expect, test } from "bun:test";
import { memoryFiles, memoryHost } from "@norn/conformance";
import { forgeNonePlugin } from "@norn/forge-none";
import { DEFAULT_KERNEL_CONFIG } from "@norn/kernel";
import { defineNornPlugin, type NornPlugin } from "@norn/plugin-api";
import { localStorePlugin } from "@norn/store-local";
import { localTrackerPlugin } from "@norn/tracker-local";
import { vcsGitPlugin } from "@norn/vcs-git";
import { createRuntimeEnv, readRepoWorkflows, type RepoWorkflows, type RuntimeConfig, repoFileOf, stepsForgePlugin } from "../../src/index.ts";

const ROOT = "/work/repo";
const DIR = `${ROOT}/.agents/workflows`;

const flow = (name: string, step: string) => `name: ${name}\nstart: ${step}\nsteps:\n  ${step}:\n    agent: Do it.\n    outcomes: { done: $done }\n`;
/** A workflow that takes its one step from the shared file `work`. */
const usesShared = "name: shared-user\nstart: go\nsteps:\n  go:\n    use: work\n    outcomes: { finished: $done }\n";
const sharedWork = (step: string) => `start: ${step}\nsteps:\n  ${step}:\n    agent: Work.\n    outcomes: { done: { exit: finished } }\n`;

const pack = defineNornPlugin({
  name: "norn-pack-tiny",
  api: "^1.4",
  provides: {
    packs: {
      tiny: {
        workflows: { "story.yaml": flow("story", "build"), "triage.yaml": flow("triage", "look"), "shared-user.yaml": usesShared },
        shared: { "work.yaml": sharedWork("pack-work") },
        skills: {},
        roles: { designer: { purpose: "Designs it.", allow: ["docs:write"] } },
      },
    },
  },
});

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

function envWith(repoWorkflows?: RepoWorkflows) {
  const r = createRuntimeEnv({ ctx: memoryHost(), plugins: PLUGINS, config, launcher: {} as never, sessions: { facts: () => null }, ...(repoWorkflows ? { repoWorkflows } : {}) });
  if (!r.ok) throw new Error(r.failure.message);
  return r.value;
}

const steps = (env: ReturnType<typeof envWith>, name: string): string[] => {
  const load = env.workflows[name];
  if (!load?.ok) throw new Error(`${name} does not load: ${JSON.stringify(load)}`);
  return Object.keys(load.workflow.graph.steps);
};

describe("readRepoWorkflows", () => {
  test("reads the YAML files of .agents/workflows and its shared/ folder, nothing else", async () => {
    const files = memoryFiles({
      [`${DIR}/story.yaml`]: "a",
      [`${DIR}/extra.yml`]: "b",
      [`${DIR}/README.md`]: "not a workflow",
      [`${DIR}/shared/work.yaml`]: "c",
      [`${ROOT}/other/x.yaml`]: "elsewhere",
    });
    expect(await readRepoWorkflows(files, ROOT)).toEqual({ workflows: { "extra.yml": "b", "story.yaml": "a" }, shared: { "work.yaml": "c" } });
  });

  test("a repo without the folder has none", async () => {
    expect(await readRepoWorkflows(memoryFiles({}), ROOT)).toEqual({ workflows: {}, shared: {} });
  });
});

describe("the repo's workflows laid over the pack", () => {
  test("without repo files the pack's workflows load as they are", () => {
    const env = envWith();
    expect(Object.keys(env.workflows).sort()).toEqual(["shared-user", "story", "triage"]);
    expect(steps(env, "story")).toEqual(["build"]);
  });

  test("a repo file of a pack workflow's name replaces it, a new name is added, the rest stay the pack's", () => {
    const env = envWith({ workflows: { "story.yaml": flow("story", "repo-build"), "release.yaml": flow("release", "prepare") }, shared: {} });
    expect(Object.keys(env.workflows).sort()).toEqual(["release", "shared-user", "story", "triage"]);
    expect(steps(env, "story")).toEqual(["repo-build"]);
    expect(steps(env, "release")).toEqual(["prepare"]);
    expect(steps(env, "triage")).toEqual(["look"]);
  });

  test("the name decides, not the extension: a repo story.yml replaces the pack's story.yaml", () => {
    const env = envWith({ workflows: { "story.yml": flow("story", "repo-build") }, shared: {} });
    expect(Object.keys(env.workflows).sort()).toEqual(["shared-user", "story", "triage"]);
    expect(steps(env, "story")).toEqual(["repo-build"]);
  });

  test("a repo shared file replaces the pack's shared file of its name, for the pack's workflows too", () => {
    const env = envWith({ workflows: {}, shared: { "work.yaml": sharedWork("repo-work") } });
    expect(steps(env, "shared-user")).toEqual(["repo-work"]);
  });

  test("a broken repo file is kept as its failure; the env still builds and every other workflow loads", () => {
    const env = envWith({ workflows: { "story.yaml": "name: story\nsteps: [unclosed\n", "half.yaml": "name: half\nstart: nowhere\nsteps: {}\n" }, shared: {} });
    const story = env.workflows.story;
    expect(story?.ok).toBe(false);
    expect(story && !story.ok && story.errors[0]?.message).toContain("story.yaml does not parse");
    expect(env.workflows.half?.ok).toBe(false);
    expect(env.workflows.triage?.ok).toBe(true);
  });

  test("a repo file names a role the pack registers, as the pack's own files do", () => {
    const role = (by: string) => `name: design\nstart: draw\nsteps:\n  draw:\n    by: ${by}\n    do: Draw it.\n    outcomes: { done: $done }\n`;
    const env = envWith({ workflows: { "design.yaml": role("designer"), "build.yaml": role("builder").replace("name: design", "name: build") }, shared: {} });
    expect(steps(env, "design")).toEqual(["draw"]);
    expect(env.workflows.build?.ok).toBe(false);
  });

  test("the env keeps the repo files, so a failure can name the repo's path", () => {
    const repo = { workflows: { "story.yaml": flow("story", "x") }, shared: { "work.yaml": sharedWork("y") } };
    const env = envWith(repo);
    expect(env.repoWorkflows).toEqual(repo);
    expect(repoFileOf(env.repoWorkflows, "story", "workflow")).toBe(".agents/workflows/story.yaml");
    expect(repoFileOf(env.repoWorkflows, "work", "shared")).toBe(".agents/workflows/shared/work.yaml");
    expect(repoFileOf(env.repoWorkflows, "triage", "workflow")).toBeNull();
  });
});
