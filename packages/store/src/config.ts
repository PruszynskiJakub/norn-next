/**
 * Config layers (K2) and workflow files (W1). Reads only; the merge rule lives in
 * `resolveConfig` (@norn/schema) and workflow graph checks in @norn/core.
 */
import { readdirSync } from "node:fs";
import { extname, join } from "node:path";
import type { FileError } from "@norn/core";
import { type ConfigLayer, DEFAULT_CONFIG, isConfigKey, type ResolvedConfig, resolveConfig, validate } from "@norn/schema";
import { type Document, isCollection, isMap, isScalar, parseDocument, parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { atomicWrite, fileError, isErrno, readText, type ReadResult, validated } from "./fsx.ts";
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
 * merged with `<repoRoot>/.agents/norn.config.yaml` via resolveConfig (K2).
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

// ---------------------------------------------------------------- editing a layer (B62–B68)

export type ConfigLayerName = "user" | "repo";

export type ConfigEditResult =
  | { ok: true; path: string; changed: boolean; value?: unknown }
  | { ok: false; code: "unknown_key" | "invalid_value"; error: string };

/**
 * Set (`set`: a YAML value as typed, `auto`, `90m`, `[{adapter: os}]`) or remove (`unset`) one
 * dotted key in the user or repo config file (D8). The file is edited as a YAML document; a list is
 * replaced whole (B63). The edited layer and the merged result are validated before anything is
 * written (B66), and the write is atomic (S1). A changed value, a new key or a removed key touches
 * only its own lines, so comments and key order stay (B67). Removing a key the file lacks writes nothing.
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
  if (!isConfigKey(key)) return { ok: false, code: "unknown_key", error: `no setting '${key}'` };
  const home = nornHome(opts.home, opts.env);
  const paths = { user: userConfigPath(home), repo: repoConfigPath(opts.repoRoot) };
  const path = paths[opts.file];
  const raw = readText(path) ?? "";
  const doc = parseDocument(raw);
  if (doc.errors.length) return { ok: false, code: "invalid_value", error: `${path}: YAML: ${doc.errors[0]?.message}` };
  const segs = key.split(".");
  const otherFile = opts.file === "user" ? "repo" : "user";
  const other = readConfigLayer(paths[otherFile]);
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
      setIn(doc, segs, value, opts.file === "repo" ? other : undefined);
      spliced ??= withNewKey(raw, doc, segs);
    }
  } catch (e) {
    return { ok: false, code: "invalid_value", error: `${key}: ${(e as Error).message}` };
  }
  const layer = (doc.toJS() ?? {}) as unknown;
  const checked = validate("config", layer);
  if (!checked.ok) return { ok: false, code: "invalid_value", error: problems(opts.file, checked.errors) };
  const layers = { [opts.file]: checked.value, [otherFile]: other.ok ? other.value : {} } as Record<ConfigLayerName, ConfigLayer>;
  const merged = validate("resolved-config", resolveConfig(layers.user, layers.repo));
  if (!merged.ok) return { ok: false, code: "invalid_value", error: problems("merged config", merged.errors) };
  // B67: the original text with only the changed lines touched, as long as it means the same as the edited document
  const text = spliced !== null && JSON.stringify(parseYaml(spliced) ?? {}) === JSON.stringify(layer) ? spliced : rendered(doc);
  if (text === raw) return { ok: true, path, changed: false, value };
  atomicWrite(path, text);
  return { ok: true, path, changed: true, value };
}

const problems = (where: string, errors: Array<{ path: string; message: string }>) =>
  `${where}: ${errors.map((e) => `${e.path || "/"} ${e.message}`).join("; ")}`;

function setIn(doc: Document, segs: string[], value: unknown, below?: ReadResult<ConfigLayer>): void {
  // a layer's `agents.<name>` replaces the agent whole (K2), so a new entry starts from the agent the
  // layers below resolve to: the user file's for the repo file, else the built-in one
  const name = segs[1] as string;
  const agent = segs[0] === "agents" && segs.length > 2 ? ((below?.ok ? below.value.agents?.[name] : undefined) ?? DEFAULT_CONFIG.agents[name]) : undefined;
  if (agent && !doc.hasIn(segs.slice(0, 2))) doc.setIn(segs.slice(0, 2), doc.createNode(structuredClone(agent)));
  doc.setIn(segs, doc.createNode(value));
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
