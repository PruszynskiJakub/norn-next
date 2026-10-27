/**
 * Machine-local files of a unit worktree (A3, K4): `.env.norn` (slot env), the `.norn-unit`
 * marker, and the shared `info/exclude` entries that keep both out of commits.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { SlotConfig } from "@norn/schema";
import { isSliceKey, isStoryKey, parseSliceFileName, parseSpecDirName, sliceDirName, sliceKey, storyDirName } from "@norn/schema";
import { atomicWrite, readText } from "./fsx.ts";
import { git } from "./git.ts";
import { envNornPath, unitMarkerPath } from "./paths.ts";

/** Worktree files norn writes per machine; never committed. */
export const WORKTREE_LOCAL_FILES = [".env.norn", ".norn-unit"] as const;

/**
 * `.env.norn` and `.norn-unit` are machine-local: add them to the repo's shared `info/exclude`
 * (the common dir, so every worktree sees it). S1: rewritten atomically, appending only the
 * missing lines.
 */
export async function ensureExcluded(root: string): Promise<void> {
  const r = await git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (r.code !== 0) return;
  const path = join(r.stdout.trim(), "info", "exclude");
  const text = readText(path) ?? "";
  const missing = WORKTREE_LOCAL_FILES.filter((p) => !text.split("\n").includes(p));
  if (!missing.length) return;
  atomicWrite(path, `${text}${text && !text.endsWith("\n") ? "\n" : ""}# norn (machine-local worktree files)\n${missing.join("\n")}\n`);
}

/** `.env.norn` values for a slot: NORN_SLOT, PORT_BASE and config extras with `{slot}`/`{port_base}` substituted. */
export function slotEnv(slot: number, slots: SlotConfig): Record<string, string> {
  const portBase = slots.port_base + slot * slots.ports_per_slot;
  const env: Record<string, string> = { NORN_SLOT: String(slot), PORT_BASE: String(portBase) };
  for (const [k, v] of Object.entries(slots.env ?? {}))
    env[k] = v.replaceAll("{slot}", String(slot)).replaceAll("{port_base}", String(portBase));
  return env;
}

const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

function quote(v: string): string {
  return /^[A-Za-z0-9_./:@%+,-]*$/.test(v) ? v : `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

/** Write `.env.norn` (dotenv syntax, written by norn; do not edit). */
export function writeEnvNorn(worktree: string, env: Record<string, string>): void {
  const lines = ["# written by norn (K4); do not edit"];
  for (const [k, v] of Object.entries(env)) {
    if (!ENV_KEY.test(k)) throw new Error(`bad env key: ${k}`);
    lines.push(`${k}=${quote(v)}`);
  }
  atomicWrite(envNornPath(worktree), `${lines.join("\n")}\n`);
}

export function parseEnvText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trimStart().startsWith("#")) continue;
    let v = m[2] as string;
    if (v.startsWith('"') && v.endsWith('"') && v.length >= 2)
      v = v.slice(1, -1).replace(/\\(["\\n])/g, (_, c: string) => (c === "n" ? "\n" : c));
    out[m[1] as string] = v;
  }
  return out;
}

export function readEnvNorn(worktree: string): Record<string, string> | null {
  const text = readText(envNornPath(worktree));
  return text === null ? null : parseEnvText(text);
}

export interface UnitMarker {
  repo: string;
  story: string;
  /** null for the story worktree */
  slice: string | null;
  /** `_story` or `<nn>-<slug>` */
  unit: string;
  /** repo-relative spec folder */
  spec_dir: string;
}

/** Write `.norn-unit` (A3): `key=value` lines, so hooks can read it without JSON. */
export function writeUnitMarker(worktree: string, m: UnitMarker): void {
  const lines = [`repo=${m.repo}`, `story=${m.story}`, `slice=${m.slice ?? ""}`, `unit=${m.unit}`, `spec_dir=${m.spec_dir}`];
  atomicWrite(unitMarkerPath(worktree), `${lines.join("\n")}\n`);
}

/** null when absent; throws nothing — a malformed marker is returned as null with `exists`. */
export function readUnitMarker(worktree: string): { exists: boolean; marker: UnitMarker | null } {
  const text = readText(unitMarkerPath(worktree));
  if (text === null) return { exists: false, marker: null };
  const kv: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) kv[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  const slice = kv.slice ? kv.slice : null;
  const ok = !!kv.repo && isStoryKey(kv.story) && (slice === null || isSliceKey(slice)) && !!kv.unit && !!kv.spec_dir;
  return {
    exists: true,
    marker: ok ? { repo: kv.repo as string, story: kv.story as string, slice, unit: kv.unit as string, spec_dir: kv.spec_dir as string } : null,
  };
}

/** Story and slice worktrees found on disk: story key → path, slice key → path. */
export interface ScannedWorktrees {
  stories: Map<string, string>;
  slices: Map<string, string>;
}

/**
 * GR3 + A3: the unit worktrees beside the repo, found without git — what a read-only view (X1)
 * uses where observe lists `git worktree`. A story worktree is `<repo>-worktrees/<story>-<slug>`
 * (`storyDirName`), a slice worktree `<that>--<nn>-<slug>` (`sliceDirName`); a folder counts only
 * when its name has that shape (schema key patterns) and its `.norn-unit` marker names the same
 * story, and for a slice the slice its name's number gives. First folder (by name) per unit wins.
 */
export function scanWorktrees(repoRoot: string): ScannedWorktrees {
  const out: ScannedWorktrees = { stories: new Map(), slices: new Map() };
  const base = `${repoRoot.replace(/\/+$/, "")}-worktrees`;
  let names: string[];
  try {
    names = readdirSync(base).sort();
  } catch {
    return out;
  }
  for (const name of names) {
    const parts = name.split("--");
    if (parts.length > 2) continue;
    const spec = parseSpecDirName(parts[0] as string);
    if (!spec || storyDirName(spec.story, spec.slug) !== parts[0]) continue;
    const file = parts.length === 2 ? parseSliceFileName(`${parts[1]}.md`) : null;
    if (parts.length === 2 && (!file || sliceDirName(file.nn, file.slug) !== parts[1])) continue;
    const path = join(base, name);
    const marker = readUnitMarker(path).marker;
    if (!marker || marker.story !== spec.story) continue;
    if (!file) {
      if (marker.slice === null && !out.stories.has(spec.story)) out.stories.set(spec.story, path);
    } else if (marker.slice === sliceKey(spec.story, file.nn) && !out.slices.has(marker.slice)) out.slices.set(marker.slice, path);
  }
  return out;
}
