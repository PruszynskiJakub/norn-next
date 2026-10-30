/**
 * Repo workflows for decide (W1, W5): every `.agents/norn/workflows/*` file parsed, schema- and
 * graph-validated (incl. that each referenced skill is installed for its agent), with its exact text for pinning (S7).
 */
import { readdirSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { AgentAdapter, LoadedWorkflow, RepoWorkflows } from "@norn/core";
import { validateWorkflowDefinition } from "@norn/core";
import { type WorkflowListing, visibleSkills } from "@norn/store";
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

/** W5 (SK1): the skills each configured agent can see in its own skill folder, links followed. */
export function agentSkills(agents: Record<string, AgentAdapter>, root: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [name, a] of Object.entries(agents)) {
    try {
      out[name] = visibleSkills(a.skillDir(root));
    } catch {
      /* adapter without a skill folder: not checked */
    }
  }
  return out;
}

export function repoWorkflows(listing: WorkflowListing, skills: { default_agent: string; visible: Record<string, string[]> }): RepoWorkflows {
  const out: Record<string, LoadedWorkflow> = {};
  for (const [name, wf] of Object.entries(listing.workflows)) {
    const check = validateWorkflowDefinition(wf.workflow, { agentSkills: skills });
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
