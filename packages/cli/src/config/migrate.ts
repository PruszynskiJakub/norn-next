/**
 * Moving a repo off the old norn's team config. The old file is never read as a config layer: its
 * keys mean other things here, so a command that needs a config refuses and sends the person to
 * `norn init`, which maps the keys it can and says which it left behind.
 */
import { join } from "node:path";
import type { HostFiles } from "@norn/plugin-api";
import { parse } from "yaml";
import { type CliFailure, configFailure } from "../output.ts";
import { type ConfigPaths, OLD_REPO_CONFIG_FILE, REPO_COMMITTED_FILE } from "./paths.ts";

/** The refusal while the repo holds the old config and none of this norn's repo files; null otherwise. */
export async function oldConfigRefusal(files: HostFiles, root: string, paths: ConfigPaths): Promise<CliFailure | null> {
  if ((await files.read(paths.repo)) !== null || (await files.read(paths.local)) !== null) return null;
  if ((await files.read(join(root, OLD_REPO_CONFIG_FILE))) === null) return null;
  return configFailure(
    `${OLD_REPO_CONFIG_FILE} is the old norn's config, which this norn does not read; it reads ${REPO_COMMITTED_FILE}`,
    `norn init --commit, which writes ${REPO_COMMITTED_FILE} from the old file's keys; then delete ${OLD_REPO_CONFIG_FILE}`,
    "config_old",
    { file: join(root, OLD_REPO_CONFIG_FILE) },
  );
}

/** What init takes from the old config: each value as this norn spells it, and which old keys it took or left. */
export interface OldConfig {
  tracker?: string;
  forge?: string;
  base?: string;
  mode?: "auto" | "manual";
  workflow?: string;
  slice_workflow?: string;
  mapped: string[];
  ignored: string[];
  /** a line each for a key init understood but cannot carry over */
  notes: string[];
}

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/**
 * What the old norn did for a key its file left out. Where this norn's own default differs, init writes
 * the old one: a repo that kept the old defaults goes on starting stories in the same workflow and mode.
 */
const OLD_DEFAULTS = { workflow: "triage", mode: "manual" } as const;

/** The old defaults for every key the file left out, each named in the notes. */
function withOldDefaults(out: OldConfig): OldConfig {
  if (out.workflow === undefined) {
    out.workflow = OLD_DEFAULTS.workflow;
    out.notes.push(`workflow: ${OLD_REPO_CONFIG_FILE} names none, so init wrote the old default, ${OLD_DEFAULTS.workflow} (this norn's own default is story)`);
  }
  if (out.mode === undefined) {
    out.mode = OLD_DEFAULTS.mode;
    out.notes.push(`mode: ${OLD_REPO_CONFIG_FILE} names none, so init wrote the old default, ${OLD_DEFAULTS.mode} (agent steps wait for norn run start <unit>; --mode auto starts them on their own)`);
  }
  return out;
}

/** The old file's text mapped; text that is not a YAML mapping maps nothing and says so. */
export function mapOldConfig(text: string): OldConfig {
  const out: OldConfig = { mapped: [], ignored: [], notes: [] };
  let doc: unknown;
  try {
    doc = parse(text);
  } catch (e) {
    out.notes.push(`${OLD_REPO_CONFIG_FILE} is not YAML (${e instanceof Error ? e.message : String(e)}): nothing was taken from it`);
    return out;
  }
  if (doc === null || doc === undefined) return withOldDefaults(out);
  if (typeof doc !== "object" || Array.isArray(doc)) {
    out.notes.push(`${OLD_REPO_CONFIG_FILE} is not a mapping of keys: nothing was taken from it`);
    return out;
  }
  for (const [key, value] of Object.entries(doc as Record<string, unknown>)) {
    if (key === "provider" && value === "gh") {
      out.tracker = "github";
      out.forge = "github";
      out.mapped.push(key);
    } else if (key === "provider" && value === "glab") {
      out.ignored.push(key);
      out.notes.push("provider glab: this norn has no GitLab tracker or forge yet, so they were detected instead");
    } else if (key === "base_branch" && nonEmpty(value)) {
      out.base = value;
      out.mapped.push(key);
    } else if (key === "mode" && (value === "auto" || value === "manual")) {
      out.mode = value;
      out.mapped.push(key);
    } else if ((key === "workflow" || key === "slice_workflow") && nonEmpty(value)) {
      out[key] = value;
      out.mapped.push(key);
    } else out.ignored.push(key);
  }
  return withOldDefaults(out);
}
