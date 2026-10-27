/**
 * Config layers (K2) and workflow files (W1). Reads only; the merge rule lives in
 * `resolveConfig` (@norn/schema) and workflow graph checks in @norn/core.
 */
import { readdirSync } from "node:fs";
import { extname, join } from "node:path";
import type { FileError } from "@norn/core";
import { type ConfigLayer, type ResolvedConfig, resolveConfig } from "@norn/schema";
import { parse as parseYaml } from "yaml";
import { fileError, isErrno, readText, type ReadResult, validated } from "./fsx.ts";
import { nornHome, repoConfigPath, userConfigPath, workflowsDir } from "./paths.ts";
import { type PinnedWorkflow, parseWorkflowText, sha256 } from "./unit.ts";

/** Read one config layer; a missing file is an empty layer. */
function readConfigLayer(path: string, root?: string): ReadResult<ConfigLayer> {
  const raw = readText(path);
  if (raw === null) return { ok: true, value: {}, raw: "" };
  let value: unknown;
  try {
    value = parseYaml(raw) ?? {};
  } catch (e) {
    return { ok: false, reason: "corrupt", error: fileError(path, [{ path: "", message: `YAML: ${(e as Error).message}` }], root) };
  }
  return validated("config", value, path, raw, root);
}

export type LoadedConfig =
  | { ok: true; config: ResolvedConfig; user: ConfigLayer; repo: ConfigLayer; home: string }
  | { ok: false; errors: FileError[]; home: string };

/**
 * `~/.norn/config.yaml` (user; home from `home` arg, else NORN_HOME_DIR, else ~/.norn)
 * merged with `<repoRoot>/.agents/norn/config.yaml` via resolveConfig (K2).
 */
export function loadConfig(opts: { repoRoot: string; home?: string; env?: Record<string, string | undefined> }): LoadedConfig {
  const home = nornHome(opts.home, opts.env);
  const user = readConfigLayer(userConfigPath(home));
  const repo = readConfigLayer(repoConfigPath(opts.repoRoot), opts.repoRoot);
  const errors: FileError[] = [];
  if (!user.ok && user.reason === "corrupt") errors.push(user.error);
  if (!repo.ok && repo.reason === "corrupt") errors.push(repo.error);
  if (errors.length || !user.ok || !repo.ok) return { ok: false, errors, home };
  return { ok: true, config: resolveConfig(user.value, repo.value), user: user.value, repo: repo.value, home };
}

// ---------------------------------------------------------------- workflows (W1)

const WORKFLOW_EXT = [".yaml", ".yml", ".json"];

export interface WorkflowFile extends PinnedWorkflow {
  name: string;
  /** absolute path */
  file: string;
}

export interface WorkflowListing {
  workflows: Record<string, WorkflowFile>;
  errors: FileError[];
}

/** Workflow files in `.agents/norn/workflows/`, name → absolute path (first by extension order). */
function listWorkflowFiles(root: string): Array<{ name: string; file: string }> {
  let names: string[];
  try {
    names = readdirSync(workflowsDir(root));
  } catch (e) {
    if (isErrno(e, "ENOENT")) return [];
    throw e;
  }
  return names
    .filter((n) => !n.startsWith(".") && WORKFLOW_EXT.includes(extname(n)))
    .sort()
    .map((n) => ({ name: n.slice(0, -extname(n).length), file: join(workflowsDir(root), n) }));
}

function loadFile(name: string, file: string, root: string): ReadResult<WorkflowFile> {
  const raw = readText(file);
  if (raw === null) return { ok: false, reason: "missing" };
  const r = parseWorkflowText(raw, file, root);
  if (!r.ok) return r;
  if (r.value.name !== name)
    return {
      ok: false,
      reason: "corrupt",
      error: fileError(file, [{ path: "/name", message: `must equal the file name '${name}'` }], root),
    };
  return { ok: true, raw, value: { name, file, workflow: r.value, hash: sha256(raw), source: raw } };
}

/** Load and schema-validate every repo workflow; invalid files are reported, not thrown. */
export function loadWorkflows(root: string): WorkflowListing {
  const out: WorkflowListing = { workflows: {}, errors: [] };
  for (const { name, file } of listWorkflowFiles(root)) {
    if (out.workflows[name]) {
      out.errors.push(fileError(file, [{ path: "", message: `duplicate workflow name '${name}'` }], root));
      continue;
    }
    const r = loadFile(name, file, root);
    if (r.ok) out.workflows[name] = r.value;
    else if (r.reason === "corrupt") out.errors.push(r.error);
  }
  return out;
}

export function loadWorkflow(root: string, name: string): ReadResult<WorkflowFile> {
  const f = listWorkflowFiles(root).find((w) => w.name === name);
  return f ? loadFile(name, f.file, root) : { ok: false, reason: "missing" };
}
