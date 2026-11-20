/**
 * The plugin wired to a fake gh through the host context, as the host will wire it: the factory
 * made through plugin-api's createTracker / createForge, so its config and shape are checked too.
 */
import { type ForgeWorld, memoryHost, type ScriptedExec, scriptedExec, type TrackerWorld, valueOf } from "@norn/conformance";
import { createForge, createTracker, type Forge, type Tracker } from "@norn/plugin-api";
import type { GithubConfig } from "../../src/config.ts";
import { githubForgeFactory, githubTrackerFactory } from "../../src/index.ts";
import { AT, type FakeGh, fakeGh } from "./fake-gh.ts";

export const ROOT = "/work/app";

export interface Rig {
  gh: FakeGh;
  exec: ScriptedExec;
  tracker: Tracker;
  forge: Forge;
}

export function rig(config: GithubConfig = { repo: "acme/app" }): Rig {
  const gh = fakeGh();
  const exec = scriptedExec(gh.script);
  const ctx = memoryHost({ exec, repo: { root: ROOT, dataDir: "/machine/app" } });
  return { gh, exec, tracker: valueOf(createTracker(githubTrackerFactory, ctx, config)), forge: valueOf(createForge(githubForgeFactory, ctx, config)) };
}

export function trackerWorld(config?: GithubConfig): TrackerWorld {
  const { gh, tracker } = rig(config);
  return {
    tracker,
    seed: async (items) => gh.seed(items),
    failing: (on) => gh.failing(on),
    comments: async (id) => gh.issues.find((i) => i.number === id)?.comments.map((c) => c.body) ?? [],
    definedLabels: async () => gh.labels.map((l) => ({ ...l })),
  };
}

export function forgeWorld(config?: GithubConfig): ForgeWorld {
  const { gh, forge } = rig(config);
  const at = (id: number) => gh.prs.find((p) => p.number === id);
  return {
    forge,
    failing: (on) => gh.failing(on),
    merge: async (id, sha) => {
      const p = at(id);
      if (p) Object.assign(p, { state: "MERGED", mergeSha: sha, mergedAt: AT });
    },
    close: async (id) => {
      const p = at(id);
      if (p) p.state = "CLOSED";
    },
    setChecks: async (id, summary, failed) => {
      const p = at(id);
      if (!p) return;
      p.checks = summary;
      if (failed)
        p.runs = [
          { id: 900, name: "build", conclusion: "success", details_url: "https://github.com/acme/app/runs/900", annotations: [] },
          ...failed.map((f, i) => ({
            id: 901 + i,
            name: f.name,
            conclusion: "failure" as const,
            details_url: f.url ?? `https://github.com/acme/app/runs/${901 + i}`,
            annotations: f.annotations.map((a) => ({ path: a.path, start_line: a.line ?? 1, annotation_level: "failure" as const, message: a.message })),
          })),
        ];
    },
  };
}
