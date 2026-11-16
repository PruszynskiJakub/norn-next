/**
 * Repo workflows for decide: every `.agents/workflows/*` file parsed, schema- and
 * graph-validated (incl. that each referenced skill is installed for its agent), with its exact text for pinning.
 */
import { readdirSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { AgentAdapter, LoadedWorkflow, RepoWorkflows, WorkflowIssue } from "@norn/core";
import { validateWorkflowDefinition } from "@norn/core";
import { sharedFile, type WorkflowListing, visibleSkills } from "@norn/store";
import { assetsDir } from "./assets.ts";

/** Skills shipped with norn, installed by `norn init`. */
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

/** The skills each configured agent can see in its own skill folder, links followed. */
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

/**
 * The repo workflows validated exactly as a tick validates them, against the skills each
 * configured agent can see. The one validator observe and `norn doctor` share; never copy its rules.
 */
export function checkedRepoWorkflows(listing: WorkflowListing, root: string, config: { agent: string }, agents: Record<string, AgentAdapter>): RepoWorkflows {
  return repoWorkflows(listing, { agent: config.agent, visible: agentSkills(agents, root) });
}

/**
 * An issue on a step a shared file brought in, prefixed with that file and step: the person fixes
 * the shared file, which the flattened workflow's path alone does not name.
 */
function inSharedFile(issue: WorkflowIssue, included: Record<string, string> | undefined): WorkflowIssue {
  if (!included) return issue;
  const at = /^\/steps\/([^/]+)/.exec(issue.path)?.[1];
  const step = [at, ...(issue.cycle ?? [])].find((s): s is string => s !== undefined && Object.hasOwn(included, s));
  return step ? { ...issue, message: `${sharedFile(included[step] as string)}, step '${step}': ${issue.message}` } : issue;
}

export function repoWorkflows(listing: WorkflowListing, skills: { agent: string; visible: Record<string, string[]> }): RepoWorkflows {
  const out: Record<string, LoadedWorkflow> = {};
  for (const [name, wf] of Object.entries(listing.workflows)) {
    const check = validateWorkflowDefinition(wf.workflow, { agentSkills: skills });
    out[name] = { name, workflow: wf.workflow, source: wf.source, issues: check.ok ? [] : check.issues.map((i) => inSharedFile(i, wf.included)) };
  }
  for (const err of listing.errors) {
    const name = basename(err.file, extname(err.file));
    if (out[name]) continue;
    out[name] = {
      name,
      workflow: null,
      source: "",
      issues: err.errors.map((e) => ({ code: err.code === "old_wording" ? ("old_wording" as const) : ("schema" as const), path: e.path, message: `${err.file}: ${e.message}` })),
    };
  }
  return out;
}
