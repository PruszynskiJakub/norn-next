/**
 * A repo's own workflows, laid over the configured pack: `<root>/.agents/workflows/*.yaml` and its
 * `shared/*.yaml`. A repo file replaces the pack's file of the same name and a new name is added, so a
 * team edits one workflow without forking the pack. The files are read as text and loaded through the
 * same loader as the pack's, so a repo file can never bypass the workflow checks, and a broken one is
 * kept as its failure like a broken pack file. The layering is the runtime's one overlay rule, by name.
 */
import { join } from "node:path";
import type { HostFiles, Pack } from "@norn/plugin-api";
import { byName, overlay } from "./overlay.ts";

/** Relative to the checkout's root. */
export const REPO_WORKFLOWS_DIR = ".agents/workflows";

export interface RepoWorkflows {
  /** workflow file name (`story.yaml`) to its text */
  workflows: Record<string, string>;
  /** shared file name (`sync.yaml`) to its text */
  shared: Record<string, string>;
}

export const NO_REPO_WORKFLOWS: RepoWorkflows = Object.freeze({ workflows: Object.freeze({}), shared: Object.freeze({}) }) as RepoWorkflows;

const YAML_FILE = /\.ya?ml$/;
export const workflowNameOf = (file: string): string => file.replace(YAML_FILE, "");

async function readYamlFiles(files: HostFiles, dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const name of await files.list(dir)) {
    if (!YAML_FILE.test(name)) continue;
    // a listed name that reads as null is a folder (or vanished since the listing): not a file to load
    const text = await files.read(join(dir, name));
    if (text !== null) out[name] = text;
  }
  return out;
}

/** The repo's workflow and shared files; both empty when the repo has none. */
export async function readRepoWorkflows(files: HostFiles, root: string): Promise<RepoWorkflows> {
  const dir = join(root, REPO_WORKFLOWS_DIR);
  const [workflows, shared] = await Promise.all([readYamlFiles(files, dir), readYamlFiles(files, join(dir, "shared"))]);
  return { workflows, shared };
}

const byWorkflowName = byName(workflowNameOf);

/** The pack's files with the repo's laid over them, by name, never by file name: a repo's `story.yml` replaces the pack's `story.yaml` rather than loading beside it. */
const overlayFiles = (pack: Readonly<Record<string, string>>, repo: Readonly<Record<string, string>>) =>
  overlay(
    [
      { label: "pack", value: pack },
      { label: "repo", value: repo },
    ],
    byWorkflowName,
  );

/** The pack with the repo's files laid over it; its skills are the pack's. */
export function overlayRepoWorkflows(pack: Pack, repo: RepoWorkflows): Pack {
  return { workflows: overlayFiles(pack.workflows, repo.workflows).value, shared: overlayFiles(pack.shared, repo.shared).value, skills: pack.skills };
}

/** Where a person finds the file a workflow, or a shared file, was loaded from: the repo's path, or null for the pack's. */
export function repoFileOf(repo: RepoWorkflows, name: string, kind: "workflow" | "shared"): string | null {
  const resolved = overlayFiles({}, kind === "workflow" ? repo.workflows : repo.shared);
  if (resolved.originOf(name) !== "repo") return null;
  const file = Object.keys(resolved.value).find((f) => workflowNameOf(f) === name);
  if (file === undefined) return null;
  return kind === "workflow" ? `${REPO_WORKFLOWS_DIR}/${file}` : `${REPO_WORKFLOWS_DIR}/shared/${file}`;
}
