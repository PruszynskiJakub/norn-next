/**
 * Repo workflows for decide (W1, W5): every `.agents/norn/workflows/*` file parsed, schema- and
 * graph-validated (incl. that each referenced skill exists), with its exact text for pinning (S7).
 */
import { readdirSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { AgentAdapter, LoadedWorkflow, RepoWorkflows } from "@norn/core";
import { validateWorkflowDefinition } from "@norn/core";
import type { WorkflowListing } from "@norn/store";
import { assetsDir } from "./assets.ts";

/** Skills shipped with norn (§16), installed by `norn init` (SK1). */
export function bundledSkills(env?: Record<string, string | undefined>): string[] {
  return listDirs(join(assetsDir(env), "skills"));
}

function listDirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("."))
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}

/** Known skill names: bundled ones plus any skill folder in each configured agent's skill dirs. */
export function knownSkills(
  agents: Record<string, AgentAdapter>,
  root: string,
  home: string,
  env?: Record<string, string | undefined>,
): Set<string> {
  const out = new Set(bundledSkills(env));
  for (const a of Object.values(agents)) {
    for (const scope of ["repo", "user"] as const) {
      let dir: string;
      try {
        dir = a.skillDir(scope, root, home);
      } catch {
        continue;
      }
      for (const s of listDirs(dir)) out.add(s);
    }
  }
  return out;
}

export function repoWorkflows(listing: WorkflowListing, skills: Iterable<string>): RepoWorkflows {
  const out: Record<string, LoadedWorkflow> = {};
  const skillSet = [...skills];
  for (const [name, wf] of Object.entries(listing.workflows)) {
    const check = validateWorkflowDefinition(wf.workflow, { skills: skillSet });
    out[name] = { name, workflow: wf.workflow, source: wf.source, issues: check.ok ? [] : check.issues };
  }
  for (const err of listing.errors) {
    const name = basename(err.file, extname(err.file));
    if (out[name]) continue;
    out[name] = {
      name,
      workflow: null,
      source: "",
      issues: err.errors.map((e) => ({ code: "schema" as const, path: e.path, message: `${err.file}: ${e.message}` })),
    };
  }
  return out;
}
