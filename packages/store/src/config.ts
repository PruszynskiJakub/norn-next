/**
 * Config files and workflow files. The merge rule lives in `resolveConfig` (@norn/schema)
 * and workflow graph checks in @norn/core.
 */
import { readdirSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { FileError } from "@norn/core";
import {
  type ConfigDerived,
  type ConfigEntry,
  type ConfigFileKind,
  type ConfigFiles,
  type ConfigProblem,
  type ConfigProblemCode,
  checkConfigFile,
  configKeyProblem,
  problemText,
  type ResolvedConfig,
  resolveConfig,
  toJsonSchema,
} from "@norn/schema";
import { type Document, isCollection, isMap, isScalar, parseDocument, parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { atomicWrite, fileError, isErrno, readText, type ReadResult } from "./fsx.ts";
import { recordedInterval } from "./heartbeat.ts";
import { checkoutOf, LOCAL_CONFIG_FILE, LOCAL_CONFIG_SCHEMA_FILE, nornHome, REPO_CONFIG_SCHEMA_FILE, REPO_CONFIG_FILE, repoConfigPath, USER_CONFIG_SCHEMA_FILE, userConfigPath, workflowsDir } from "./paths.ts";
import { type PinnedWorkflow, parseWorkflowText, sha256 } from "./unit.ts";

/** A missing or empty file sets nothing; a file that is not YAML is `config_invalid`. */
function readConfigFile(kind: ConfigFileKind, path: string): { value: unknown; problems: ConfigProblem[] } {
  const raw = readText(path);
  if (raw === null) return { value: undefined, problems: [] };
  try {
    return { value: parseYaml(raw) ?? undefined, problems: [] };
  } catch (e) {
    return { value: undefined, problems: [{ code: "config_invalid", file: kind, key: "", message: `not valid YAML: ${(e as Error).message.split("\n")[0]}` }] };
  }
}

export const localConfigPath = (root: string) => join(root, LOCAL_CONFIG_FILE);

export interface ConfigPaths {
  user: string;
  local: string;
  repo: string;
}

export type LoadedConfig =
  | { ok: true; config: ResolvedConfig; entries: ConfigEntry[]; files: ConfigFiles; home: string; paths: ConfigPaths }
  | {
      ok: false;
      problems: ConfigProblem[];
      errors: FileError[];
      home: string;
      paths: ConfigPaths;
      /** The config with each top-level key that has a problem left out whole (one bad `agents.codex.model` drops all of `agents`), so doctor still runs the checks it does not hide */
      fallback: { config: ResolvedConfig; entries: ConfigEntry[] };
    };

const executableOnPath = (name: string, path: string | undefined): boolean =>
  (path ?? "").split(":").some((dir) => {
    if (!dir) return false;
    try {
      const st = statSync(join(dir, name));
      return st.isFile() && (st.mode & 0o111) !== 0;
    } catch {
      return false;
    }
  });

/** The `[section "name"]` keys of a git config file (no git process: config loads in every command). */
function gitConfigValue(text: string, section: string, name: string, key: string): string | null {
  let inSection = false;
  for (const line of text.split("\n")) {
    const head = /^\s*\[\s*([A-Za-z0-9.-]+)(?:\s+"((?:[^"\\]|\\.)*)")?\s*\]/.exec(line);
    if (head) {
      inSection = head[1]?.toLowerCase() === section && head[2] === name;
      continue;
    }
    if (!inSection) continue;
    const kv = /^\s*([A-Za-z0-9-]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (kv && kv[1]?.toLowerCase() === key) return (kv[2] as string).replace(/^"(.*)"$/, "$1");
  }
  return null;
}

/**
 * What norn derives — the runner (inside Herdr: `HERDR_ENV=1`; installed:
 * `herdr` on the env's PATH; else headless), the git remote (the remote the base branch tracks, or
 * with no `base_branch` the branch checked out in the main checkout, else `origin`) and its URL, and
 * the interval the heartbeat records. Reads files only.
 */
function deriveConfig(opts: { repoRoot: string; env?: Record<string, string | undefined>; baseBranch?: string | null }): ConfigDerived {
  const env = opts.env ?? process.env;
  const runner: ConfigDerived["runner"] =
    env.HERDR_ENV === "1"
      ? { adapter: "herdr", reason: "inside Herdr" }
      : executableOnPath("herdr", env.PATH)
        ? { adapter: "herdr", reason: "herdr on PATH" }
        : { adapter: "headless", reason: "herdr not on PATH" };
  const common = checkoutOf(opts.repoRoot).common;
  const gitConfig = readText(join(common, "config")) ?? "";
  let branch = opts.baseBranch ?? null;
  if (!branch) {
    const head = /^ref: refs\/heads\/(.+)$/m.exec(readText(join(common, "HEAD")) ?? "");
    branch = head?.[1]?.trim() ?? null;
  }
  const tracked = branch ? gitConfigValue(gitConfig, "branch", branch, "remote") : null;
  const git_remote = tracked && tracked !== "." ? { name: tracked, reason: `tracked by ${branch}` } : { name: "origin", reason: branch ? `${branch} tracks no remote` : "no branch checked out" };
  const remote_url = gitConfigValue(gitConfig, "remote", git_remote.name, "url");
  return { runner, remote_url, git_remote, interval: recordedInterval(opts.repoRoot) };
}

/**
 * The three config files (`~/.norn/config.yaml`, home from `home`, else NORN_HOME_DIR, else
 * ~/.norn; `.agents/norn.config.local.yaml`; `.agents/norn.config.yaml`) resolved with what norn
 * derives. Any problem in any file fails the load (a config error, never corrupt state).
 */
export function loadConfig(opts: { repoRoot: string; home?: string; env?: Record<string, string | undefined>; derived?: ConfigDerived }): LoadedConfig {
  const home = nornHome(opts.home, opts.env);
  const paths: ConfigPaths = { user: userConfigPath(home), local: localConfigPath(opts.repoRoot), repo: repoConfigPath(opts.repoRoot) };
  const read = { user: readConfigFile("user", paths.user), local: readConfigFile("local", paths.local), repo: readConfigFile("repo", paths.repo) };
  const files = { user: read.user.value, local: read.local.value, repo: read.repo.value } as ConfigFiles;
  const repo = files.repo as { base_branch?: unknown } | undefined;
  const baseBranch = repo && typeof repo === "object" && typeof repo.base_branch === "string" ? repo.base_branch : null;
  const derived = opts.derived ?? deriveConfig({ repoRoot: opts.repoRoot, env: opts.env ?? process.env, baseBranch });
  const r = resolveConfig(files, derived);
  const problems = [...read.user.problems, ...read.local.problems, ...read.repo.problems, ...r.problems];
  if (problems.length) {
    const errors: FileError[] = problems.map((p) => ({ file: p.file === "user" ? paths.user : p.file === "local" ? LOCAL_CONFIG_FILE : REPO_CONFIG_FILE, errors: [{ path: p.key, message: p.message }] }));
    return { ok: false, problems, errors, home, paths, fallback: { config: r.config, entries: r.entries } };
  }
  return { ok: true, config: r.config, entries: r.entries, files, home, paths };
}

/** Each config file's schema copy, as the path under its root (repo or norn home). */
const SCHEMA_COPY: Record<ConfigLayerName, string> = { user: USER_CONFIG_SCHEMA_FILE, local: LOCAL_CONFIG_SCHEMA_FILE, repo: REPO_CONFIG_SCHEMA_FILE };

/**
 * Write the JSON schema of each config file next to it — the team and local
 * schemas in `.agents/` (committed), the user schema in the norn home — when missing or stale.
 * Returns the paths written.
 */
export function writeConfigSchemas(opts: { repoRoot: string; home: string }): string[] {
  const targets: Array<[string, "repo-config" | "local-config" | "user-config"]> = [
    [join(opts.repoRoot, REPO_CONFIG_SCHEMA_FILE), "repo-config"],
    [join(opts.repoRoot, LOCAL_CONFIG_SCHEMA_FILE), "local-config"],
    [join(opts.home, USER_CONFIG_SCHEMA_FILE), "user-config"],
  ];
  const written: string[] = [];
  for (const [path, name] of targets) {
    const text = `${JSON.stringify(toJsonSchema(name), null, 2)}\n`;
    if (readText(path) === text) continue;
    atomicWrite(path, text);
    written.push(path);
  }
  return written;
}

export type ConfigLayerName = ConfigFileKind;

export type ConfigEditResult =
  | { ok: true; path: string; changed: boolean; value?: unknown }
  | { ok: false; code: "unknown_key" | "invalid_value" | ConfigProblemCode; error: string };

/**
 * Set (`set`: a YAML value as typed, `auto`, `90m`) or remove (`unset`) one dotted key in the user,
 * local or team config file. A key the file does not take is refused (`config_wrong_file`,
 * `config_moved`). The file is edited as a YAML document; a list is replaced whole. The edited file
 * is checked before anything is written, and the write is atomic. A changed value, a new key or
 * a removed key touches only its own lines, so comments and key order stay. Removing a key
 * the file lacks writes nothing.
 */
export function editConfigLayer(opts: {
  repoRoot: string;
  home?: string;
  env?: Record<string, string | undefined>;
  file: ConfigLayerName;
  key: string;
  edit: { set: string } | { unset: true };
}): ConfigEditResult {
  const { key, edit } = opts;
  // a moved or misplaced key can still be unset, so it can be removed by hand
  const problem = configKeyProblem(opts.file, key);
  const misplaced = problem && ("set" in edit || problem.code === "config_invalid") ? problem : null;
  if (misplaced) return { ok: false, code: misplaced.code === "config_invalid" ? "unknown_key" : misplaced.code, error: problemText(misplaced) };
  const home = nornHome(opts.home, opts.env);
  const paths = { user: userConfigPath(home), local: localConfigPath(opts.repoRoot), repo: repoConfigPath(opts.repoRoot) };
  const path = paths[opts.file];
  const existing = readText(path);
  const raw = existing ?? "";
  const doc = parseDocument(raw);
  if (doc.errors.length) return { ok: false, code: "invalid_value", error: `${path}: YAML: ${doc.errors[0]?.message}` };
  const segs = key.split(".");
  let value: unknown;
  let spliced: string | null;
  try {
    if ("unset" in edit) {
      if (!doc.hasIn(segs)) return { ok: true, path, changed: false };
      spliced = withoutLines(raw, doc, segs);
      removeIn(doc, segs);
    } else {
      value = parseYaml(edit.set);
      spliced = withScalar(raw, doc, segs, value) ?? withValueLines(raw, doc, segs, value);
      doc.setIn(segs, doc.createNode(value));
      spliced ??= withNewKey(raw, doc, segs);
    }
  } catch (e) {
    return { ok: false, code: "invalid_value", error: `${key}: ${(e as Error).message}` };
  }
  const layer = (doc.toJS() ?? {}) as unknown;
  // a set is checked against the whole file; an unset only removes, so it never makes a file worse
  const checked = "set" in edit ? checkConfigFile(opts.file, layer) : [];
  if (checked.length) return { ok: false, code: "invalid_value", error: checked.map(problemText).join("; ") };
  // The original text with only the changed lines touched, as long as it means the same as the edited document
  const edited = spliced !== null && JSON.stringify(parseYaml(spliced) ?? {}) === JSON.stringify(layer) ? spliced : rendered(doc);
  // A file this creates starts with the modeline its editor reads the schema copy through
  const text = existing === null ? `# yaml-language-server: $schema=${basename(SCHEMA_COPY[opts.file])}\n${edited}` : edited;
  if (text === raw) return { ok: true, path, changed: false, value };
  atomicWrite(path, text);
  return { ok: true, path, changed: true, value };
}

/**
 * Write `norn_version` into the team file, edited in place so its comments and
 * key order stay. `norn init` (when the key is absent) and `norn upgrade` are its only writers.
 */
export function writeNornVersion(repoRoot: string, version: string): ConfigEditResult {
  return editConfigLayer({ repoRoot, file: "repo", key: "norn_version", edit: { set: version } });
}

/** The whole document re-rendered; a layer left empty is an empty file, not `{}`. */
const rendered = (doc: Document) => (isMap(doc.contents) && !doc.contents.items.length ? doc.toString().replace(/^\{\}\n$/m, "") : doc.toString());

/** Delete the key and drop the maps it leaves empty. */
function removeIn(doc: Document, segs: string[]): void {
  doc.deleteIn(segs);
  for (let n = segs.length - 1; n > 0; n--) {
    const up = doc.getIn(segs.slice(0, n), true);
    if (!isCollection(up) || up.items.length) break;
    doc.deleteIn(segs.slice(0, n));
  }
}

/** `raw` with an existing scalar's text replaced, comments and layout untouched; null when the key is not a scalar there. */
function withScalar(raw: string, doc: Document, segs: string[], value: unknown): string | null {
  const node = doc.getIn(segs, true);
  if (!isScalar(node) || !node.range || (value !== null && typeof value === "object")) return null;
  return raw.slice(0, node.range[0]) + stringifyYaml(value).trimEnd() + raw.slice(node.range[1]);
}

/**
 * `raw` with an existing key's lines (`notifiers:` through its last item) replaced by the key with
 * its new value, at the key's indentation; the lines around it stay as typed. Null when the key is
 * missing or sits in a flow map.
 */
function withValueLines(raw: string, doc: Document, segs: string[], value: unknown): string | null {
  const span = pairLines(raw, segs.length > 1 ? doc.getIn(segs.slice(0, -1), true) : doc.contents, segs.at(-1) as string);
  if (!span) return null;
  const lines = stringifyYaml({ [segs.at(-1) as string]: value }).replace(/^(?=.)/gm, " ".repeat(span.indent));
  return raw.slice(0, span.from) + lines + raw.slice(span.to);
}

/** The lines of `key`'s pair in a block map: from its key's line start to past its value's last line. */
function pairLines(raw: string, parent: unknown, key: string): { from: number; to: number; indent: number } | null {
  if (!isMap(parent) || parent.flow) return null;
  const pair = parent.items.find((p) => isScalar(p.key) && p.key.value === key);
  const keyRange = pair && isScalar(pair.key) ? pair.key.range : undefined;
  const valueRange = (pair?.value as { range?: [number, number, number] } | null)?.range ?? keyRange;
  if (!keyRange || !valueRange) return null;
  const from = raw.lastIndexOf("\n", keyRange[0] - 1) + 1;
  const eol = raw.indexOf("\n", Math.max(valueRange[1] - 1, keyRange[0]));
  return { from, to: eol === -1 ? raw.length : eol + 1, indent: keyRange[0] - from };
}

/**
 * `raw` with the lines of a key it lacks added: after the last entry of the nearest map the file has
 * (`limits:` gets `  retries: 4`), or at the end for a new top-level key. `edited` already holds the
 * value (and an agent seeded from the built-in one). Null when the key exists or the map is a flow map.
 */
function withNewKey(raw: string, edited: Document, segs: string[]): string | null {
  const orig = parseDocument(raw);
  if (orig.hasIn(segs)) return null;
  let n = 0;
  while (n < segs.length - 1 && orig.hasIn(segs.slice(0, n + 1))) n++;
  let value = edited.toJS() as unknown;
  for (const s of segs.slice(0, n + 1)) value = (value as Record<string, unknown>)[s];
  const lines = stringifyYaml({ [segs[n] as string]: value });
  if (n === 0) {
    if (orig.contents !== null && (!isMap(orig.contents) || orig.contents.flow)) return null;
    return raw + (raw && !raw.endsWith("\n") ? "\n" : "") + lines;
  }
  const parent = orig.getIn(segs.slice(0, n), true);
  if (!isMap(parent) || parent.flow || !parent.items.length) return null;
  const first = parent.items[0]?.key;
  const last = parent.items.at(-1);
  const keyRange = isScalar(first) ? first.range : undefined;
  const lastRange = (last?.value as { range?: [number, number, number] } | null)?.range ?? (isScalar(last?.key) ? last.key.range : undefined);
  if (!keyRange || !lastRange) return null;
  const indent = " ".repeat(keyRange[0] - raw.lastIndexOf("\n", keyRange[0] - 1) - 1);
  const added = lines.replace(/^(?=.)/gm, indent);
  const eol = raw.indexOf("\n", lastRange[1] - 1);
  return eol === -1 ? `${raw}\n${added}` : raw.slice(0, eol + 1) + added + raw.slice(eol + 1);
}

/**
 * `raw` without the lines of the key (or of the highest map it leaves empty); comments above it
 * stay where they are. Null in a flow map (`limits: { deadline: 30m }`), which has no lines of its own.
 */
function withoutLines(raw: string, doc: Document, segs: string[]): string | null {
  let n = segs.length;
  while (n > 1 && (doc.getIn(segs.slice(0, n - 1), true) as { items?: unknown[] }).items?.length === 1) n--;
  const span = pairLines(raw, n > 1 ? doc.getIn(segs.slice(0, n - 1), true) : doc.contents, segs[n - 1] as string);
  return span && raw.slice(0, span.from) + raw.slice(span.to);
}

export const WORKFLOW_EXT = [".yaml", ".yml", ".json"];

export interface WorkflowFile extends PinnedWorkflow {
  name: string;
  /** absolute path */
  file: string;
}

export interface WorkflowListing {
  workflows: Record<string, WorkflowFile>;
  errors: FileError[];
}

/** Workflow files in `.agents/workflows/`, name → absolute path (first by extension order). */
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
