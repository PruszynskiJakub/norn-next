/**
 * gh-64 `norn migrate`, the config part (D13, B40–B45): rewrite old config keys into the three-file
 * shape. The user file is rewritten in place; the team file, the workflows it hands limits and mode
 * to, the slices and specs that lose criteria `needs`, and the team schema copy are returned for the
 * caller to stage. Files are edited as YAML documents, so comments and key order stay. Every step
 * reads what is there and changes only old keys, so a second run changes nothing (B45).
 */
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { AGENT_NAMES, isAgentName, SPEC_FILE } from "@norn/schema";
import { type Document, isMap, isScalar, isSeq, type Pair, parseDocument, type YAMLMap } from "yaml";
import { writeConfigSchemas, WORKFLOW_EXT } from "./config.ts";
import { atomicWrite, isErrno, readText } from "./fsx.ts";
import { LOCAL_CONFIG_SCHEMA_FILE, REPO_CONFIG_FILE, REPO_CONFIG_SCHEMA_FILE, repoConfigPath, slicesDir, specsDir, userConfigPath, workflowsDir } from "./paths.ts";

export interface ConfigMigrationRemoved {
  file: "user" | "repo";
  /** the old key */
  key: string;
  value: unknown;
  /** what to do about it, for the person */
  note: string;
}

export interface ConfigMigration {
  /** absolute paths rewritten, the user file among them */
  changed: string[];
  /** repo-relative paths to stage (team file, workflows, slices, specs, schema copy) */
  stage: string[];
  /** B43: keys dropped with their value and what to do */
  removed: ConfigMigrationRemoved[];
  /** B40: renames, `old → new` */
  renamed: Array<{ file: "user" | "repo"; from: string; to: string }>;
}

const USER_FILE = "~/.norn/config.yaml";

type Map = YAMLMap<unknown, unknown>;

const pairOf = (m: Map, key: string): Pair<unknown, unknown> | undefined => m.items.find((p) => isScalar(p.key) && p.key.value === key);

/** Rename a top-level key in place (position and comments kept); drops the old key when the new one exists. */
function renameKey(doc: Document, from: string, to: string): boolean {
  const m = doc.contents;
  if (!isMap(m)) return false;
  const p = pairOf(m, from);
  if (!p) return false;
  if (pairOf(m, to)) m.delete(from);
  else if (isScalar(p.key)) p.key.value = to;
  return true;
}

const js = (doc: Document, path: string[]): unknown => {
  const v = doc.getIn(path, true);
  return v && typeof (v as { toJSON?: unknown }).toJSON === "function" ? (v as { toJSON: () => unknown }).toJSON() : v;
};

/** B40 (D9): the old notifier list as a `notify` map, and the adapters that have no place in it. */
function notifyOf(list: unknown): { notify: Record<string, unknown>; dropped: string[] } {
  const notify: Record<string, unknown> = {};
  const dropped: string[] = [];
  const items = Array.isArray(list) ? list : [];
  let os = false;
  for (const n of items) {
    const adapter = (n as { adapter?: unknown })?.adapter;
    const o = ((n as { options?: Record<string, unknown> })?.options ?? {}) as Record<string, unknown>;
    if (adapter === "os") os = true;
    else if (adapter === "herdr") continue; // inside Herdr it is on by itself (B20)
    else if (adapter === "ntfy") {
      const url = typeof o.url === "string" ? o.url : typeof o.topic === "string" ? `${typeof o.server === "string" ? o.server.replace(/\/+$/, "") : "https://ntfy.sh"}/${o.topic}` : null;
      if (url) notify.ntfy = url;
      else dropped.push("ntfy (no url or topic)");
    } else if (adapter === "webhook" && typeof o.url === "string") notify.webhook = o.url;
    else dropped.push(String(adapter));
  }
  if (!os) notify.os = false;
  return { notify, dropped };
}

/** One migration of one file's document; returns whether it changed. */
interface FileRun {
  doc: Document;
  file: "user" | "repo";
  out: ConfigMigration;
}

function drop(r: FileRun, key: string, note: string, path: string[] = [key]): void {
  r.out.removed.push({ file: r.file, key: path.join("."), value: js(r.doc, path), note });
  r.doc.deleteIn(path);
}

function rename(r: FileRun, from: string, to: string): void {
  if (renameKey(r.doc, from, to)) r.out.renamed.push({ file: r.file, from, to });
}

/** B40, B43: the user file. */
function migrateUser(r: FileRun): void {
  rename(r, "default_agent", "agent");
  rename(r, "default_mode", "mode");
  const notifiers = js(r.doc, ["notifiers"]);
  if (notifiers !== undefined) {
    const { notify, dropped } = notifyOf(notifiers);
    r.doc.delete("notifiers");
    if (Object.keys(notify).length && !r.doc.has("notify")) r.doc.set("notify", r.doc.createNode(notify));
    r.out.renamed.push({ file: "user", from: "notifiers", to: "notify" });
    for (const d of dropped) r.out.removed.push({ file: "user", key: "notifiers", value: d, note: "no longer supported: use notify.webhook" });
  }
  agentsEntries(r);
  if (r.doc.has("remote")) drop(r, "remote", `team settings: \`provider\` goes in the team file; the label, git remote and sync are fixed or derived`);
  for (const k of ["default_workflow", "default_slice_workflow", "base_branch"]) if (r.doc.has(k)) drop(r, k, `a team setting: set it in ${REPO_CONFIG_FILE} if you want it`);
  if (r.doc.has("limits")) drop(r, "limits", "set limits in a workflow's `defaults:`");
  for (const k of ["runner", "max_checks", "slots", "watch_interval", "claim"]) if (r.doc.has(k)) drop(r, k, REMOVED_NOTE[k] as string);
  const max = js(r.doc, ["max_agents"]);
  if (typeof max === "number" && max > 9) {
    r.doc.set("max_agents", 9);
    r.out.removed.push({ file: "user", key: "max_agents", value: max, note: "lowered to 9: there are 9 slots" });
  }
}

const REMOVED_NOTE: Record<string, string> = {
  runner: "norn detects the runner",
  max_checks: "checks follow max_agents",
  slots: "slots are fixed at 1–9",
  watch_interval: "use norn watch --interval or norn tick --interval",
  claim: "claim timing is derived from the tick interval",
};

/** B14 (D10): agent entries keep `model` and `args`; other fields and unknown agents are dropped. */
function agentsEntries(r: FileRun): void {
  const agents = r.doc.get("agents", true);
  if (!isMap(agents)) return;
  for (const p of [...agents.items]) {
    const name = isScalar(p.key) ? String(p.key.value) : "";
    if (!isAgentName(name)) {
      drop(r, name, `only ${AGENT_NAMES.join(", ")} are agents`, ["agents", name]);
      continue;
    }
    if (!isMap(p.value)) continue;
    for (const f of [...p.value.items]) {
      const field = isScalar(f.key) ? String(f.key.value) : "";
      if (field !== "model" && field !== "args") drop(r, field, "agent entries take only model and args", ["agents", name, field]);
    }
    if (!p.value.items.length) agents.delete(name);
  }
  if (!agents.items.length) r.doc.delete("agents");
}

const PERSONAL_NOTE = (key: string, value: unknown) => `set it in ${USER_FILE} if you want it${key !== "agents" ? `: \`${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}\`` : ""}`;

/** B40–B43: the team file; returns the limits and mode it hands to the workflows. */
function migrateRepo(r: FileRun): { limits: Record<string, unknown> | null; mode: string | null } {
  const remote = js(r.doc, ["remote"]) as Record<string, unknown> | undefined;
  if (remote !== undefined) {
    const provider = remote?.provider;
    const m = r.doc.contents as Map;
    const pair = pairOf(m, "remote");
    if (provider !== undefined && !r.doc.has("provider") && pair && isScalar(pair.key)) {
      // in place of `remote:`, so the line keeps its position and comment
      pair.key.value = "provider";
      pair.value = r.doc.createNode(provider);
      r.out.renamed.push({ file: "repo", from: "remote.provider", to: "provider" });
    } else r.doc.delete("remote");
    for (const [k, v] of Object.entries(remote ?? {}))
      if (k !== "provider") r.out.removed.push({ file: "repo", key: `remote.${k}`, value: v, note: k === "label" ? "the label is always norn" : "norn derives or fixes it" });
  }
  rename(r, "default_workflow", "workflow");
  rename(r, "default_slice_workflow", "slice_workflow");
  const limits = (js(r.doc, ["limits"]) as Record<string, unknown> | undefined) ?? null;
  if (limits) {
    r.doc.delete("limits");
    r.out.renamed.push({ file: "repo", from: "limits", to: "each workflow's defaults:" });
  }
  const mode = (js(r.doc, ["default_mode"]) as string | undefined) ?? null;
  if (mode) {
    r.doc.delete("default_mode");
    r.out.renamed.push({ file: "repo", from: "default_mode", to: "each workflow's mode" });
  }
  // B43: personal and machine keys leave the team file, each listed with its value
  const agent = js(r.doc, ["default_agent"]);
  if (agent !== undefined) {
    r.out.removed.push({ file: "repo", key: "agent", value: agent, note: PERSONAL_NOTE("agent", agent) });
    r.doc.delete("default_agent");
  }
  for (const k of ["agents", "max_agents", "notifiers", "trace"]) if (r.doc.has(k)) drop(r, k, PERSONAL_NOTE(k, js(r.doc, [k])));
  for (const k of ["runner", "max_checks", "slots", "watch_interval", "claim"]) if (r.doc.has(k)) drop(r, k, REMOVED_NOTE[k] as string);
  return { limits, mode };
}

/** B41, B42: fill each workflow's `defaults:` and `mode` from the old team values it does not set. */
function migrateWorkflows(root: string, limits: Record<string, unknown> | null, mode: string | null, out: ConfigMigration): void {
  if (!limits && !mode) return;
  const wanted = Object.fromEntries(Object.entries(limits ?? {}).filter(([k]) => ["deadline", "nudges", "retries", "stalled"].includes(k)));
  let names: string[];
  try {
    names = readdirSync(workflowsDir(root)).filter((n) => WORKFLOW_EXT.includes(n.slice(n.lastIndexOf("."))) && !n.endsWith(".json"));
  } catch (e) {
    if (isErrno(e, "ENOENT")) return;
    throw e;
  }
  for (const n of names.sort()) {
    const path = join(workflowsDir(root), n);
    const raw = readText(path);
    if (raw === null) continue;
    const doc = parseDocument(raw);
    if (doc.errors.length || !isMap(doc.contents)) continue;
    let changed = false;
    if (mode && !doc.has("mode")) {
      doc.set("mode", mode);
      changed = true;
    }
    for (const [k, v] of Object.entries(wanted)) {
      if (doc.hasIn(["defaults", k])) continue;
      if (!doc.has("defaults")) doc.set("defaults", doc.createNode({}));
      doc.setIn(["defaults", k], v);
      changed = true;
    }
    if (!changed) continue;
    atomicWrite(path, doc.toString());
    out.changed.push(path);
    out.stage.push(relative(root, path));
  }
}

/** B44: strip criteria `needs` from every slice file and spec under `.agents/specs/`. */
function stripNeeds(root: string, out: ConfigMigration): void {
  let specs: string[];
  try {
    specs = readdirSync(specsDir(root));
  } catch (e) {
    if (isErrno(e, "ENOENT")) return;
    throw e;
  }
  const files: string[] = [];
  for (const s of specs.sort()) {
    const dir = join(specsDir(root), s);
    files.push(join(dir, SPEC_FILE));
    try {
      for (const f of readdirSync(slicesDir(dir)).sort()) if (f.endsWith(".md")) files.push(join(slicesDir(dir), f));
    } catch {
      // no slices
    }
  }
  for (const path of files) {
    const raw = readText(path);
    const m = raw && /^(---[ \t]*\r?\n)([\s\S]*?)(\r?\n---[ \t]*(?:\r?\n|$))/.exec(raw);
    if (!raw || !m) continue;
    const doc = parseDocument(m[2] as string);
    const criteria = doc.get("criteria", true);
    if (!isSeq(criteria)) continue;
    let changed = false;
    for (const c of criteria.items)
      if (isMap(c) && c.has("needs")) {
        c.delete("needs");
        changed = true;
      }
    if (!changed) continue;
    const yaml = doc.toString().replace(/\n$/, "");
    atomicWrite(path, `${m[1]}${yaml}${m[3]}${raw.slice(m[0].length)}`);
    out.changed.push(path);
    out.stage.push(relative(root, path));
  }
}

/**
 * D13: the whole config migration. `root` is the main checkout; `home` the norn home. Writes the
 * changed files; returns what changed, what to stage and every key dropped or renamed.
 */
export function migrateConfig(opts: { root: string; home: string }): ConfigMigration {
  const out: ConfigMigration = { changed: [], stage: [], removed: [], renamed: [] };
  const edit = (path: string, file: "user" | "repo", fn: (r: FileRun) => void) => {
    const raw = readText(path);
    if (raw === null) return;
    const doc = parseDocument(raw);
    if (doc.errors.length || !isMap(doc.contents)) return;
    // a comment at the top of the file belongs to the file, not to the first key (which may be dropped)
    const first = doc.contents.items[0];
    if (first && isScalar(first.key) && first.key.commentBefore && !doc.commentBefore) {
      doc.commentBefore = first.key.commentBefore;
      first.key.commentBefore = undefined;
    }
    fn({ doc, file, out });
    const text = doc.toString();
    if (text === raw || (isMap(doc.contents) && !doc.contents.items.length && raw.trim() === "")) return;
    atomicWrite(path, isMap(doc.contents) && !doc.contents.items.length ? text.replace(/^\{\}\n$/m, "") : text);
    out.changed.push(path);
    if (file === "repo") out.stage.push(relative(opts.root, path));
  };
  edit(userConfigPath(opts.home), "user", migrateUser);
  let handed: { limits: Record<string, unknown> | null; mode: string | null } = { limits: null, mode: null };
  edit(repoConfigPath(opts.root), "repo", (r) => {
    handed = migrateRepo(r);
  });
  migrateWorkflows(opts.root, handed.limits, handed.mode, out);
  stripNeeds(opts.root, out);
  // B55: the schema copies follow the norn that ran migrate; the team copy is staged
  for (const p of writeConfigSchemas({ repoRoot: opts.root, home: opts.home })) {
    out.changed.push(p);
    for (const rel of [REPO_CONFIG_SCHEMA_FILE, LOCAL_CONFIG_SCHEMA_FILE]) if (p === join(opts.root, rel)) out.stage.push(rel);
  }
  return out;
}
