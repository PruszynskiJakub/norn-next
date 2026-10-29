/**
 * Markdown with YAML frontmatter: spec.md and slices/<nn>-<slug>.md (§7, §7.1).
 * The body is preserved byte for byte; patches touch only the given keys and keep
 * the rest of the YAML (order, comments) as written by humans and skills.
 */
import type { SchemaError, SliceFrontmatter, StoryFrontmatter } from "@norn/schema";
import { parseDocument, stringify } from "yaml";
import { atomicWrite, fileError, readText, type ReadResult, validated } from "./fsx.ts";

export interface MarkdownDoc<T> {
  frontmatter: T;
  /** everything after the closing `---` line, verbatim */
  body: string;
}

/** Fields the CLI may change (§7.1); everything else belongs to humans and skills. */
const STORY_CLI_FIELDS = [
  "status",
  "workflow",
  "title",
  "assignee",
  "url",
  "labels",
  "body_hash",
  "refined_body_hash",
  "merge",
] as const satisfies readonly (keyof StoryFrontmatter)[];
const SLICE_CLI_FIELDS = ["status", "workflow"] as const satisfies readonly (keyof SliceFrontmatter)[];

export type StoryPatch = { [K in (typeof STORY_CLI_FIELDS)[number]]?: StoryFrontmatter[K] | undefined };
export type SlicePatch = { [K in (typeof SLICE_CLI_FIELDS)[number]]?: SliceFrontmatter[K] | undefined };

interface Split {
  yaml: string;
  /** text from the start of the file through the closing delimiter line */
  head: string;
  body: string;
}

const OPEN = /^---[ \t]*\r?\n/;
const CLOSE = /^---[ \t]*(\r?\n|$)/m;

function splitFrontmatter(text: string): Split | null {
  const open = OPEN.exec(text);
  if (!open) return null;
  const rest = text.slice(open[0].length);
  // closing delimiter may directly follow (empty frontmatter)
  const close = CLOSE.exec(rest);
  if (!close) return null;
  const yaml = rest.slice(0, close.index);
  const end = open[0].length + close.index + close[0].length;
  return { yaml, head: text.slice(0, end), body: text.slice(end) };
}

function parseYaml(yaml: string): { ok: true; value: unknown } | { ok: false; errors: SchemaError[] } {
  const doc = parseDocument(yaml);
  if (doc.errors.length) return { ok: false, errors: doc.errors.map((e) => ({ path: "", message: `YAML: ${e.message}` })) };
  return { ok: true, value: doc.toJS() ?? {} };
}

function readMarkdown<N extends "story" | "slice">(name: N, path: string, root?: string) {
  type T = N extends "story" ? StoryFrontmatter : SliceFrontmatter;
  const raw = readText(path);
  if (raw === null) return { ok: false, reason: "missing" } as ReadResult<MarkdownDoc<T>>;
  return parseMarkdown(name, raw, path, root);
}

function parseMarkdown<N extends "story" | "slice">(name: N, raw: string, path: string, root?: string) {
  type T = N extends "story" ? StoryFrontmatter : SliceFrontmatter;
  const split = splitFrontmatter(raw);
  if (!split)
    return {
      ok: false,
      reason: "corrupt",
      error: fileError(path, [{ path: "", message: "missing YAML frontmatter (--- … ---)" }], root),
    } as ReadResult<MarkdownDoc<T>>;
  const y = parseYaml(split.yaml);
  if (!y.ok) return { ok: false, reason: "corrupt", error: fileError(path, y.errors, root) } as ReadResult<MarkdownDoc<T>>;
  const v = validated(name, y.value, path, raw, root);
  if (!v.ok) return v as ReadResult<MarkdownDoc<T>>;
  return { ok: true, value: { frontmatter: v.value as T, body: split.body }, raw } as ReadResult<MarkdownDoc<T>>;
}

export const readStoryFile = (path: string, root?: string) => readMarkdown("story", path, root);
export const readSliceFile = (path: string, root?: string) => readMarkdown("slice", path, root);
/** story.md text read elsewhere (e.g. `git show` of a pushed branch); `path` names it in errors. */
export const parseStoryFile = (raw: string, path: string) => parseMarkdown("story", raw, path);
export const parseSliceFile = (raw: string, path: string) => parseMarkdown("slice", raw, path);

/** Render a new markdown file (intake, tests). Body is appended verbatim. */
function renderMarkdown(frontmatter: object, body: string): string {
  return `---\n${stringify(frontmatter, { lineWidth: 0 })}---\n${body}`;
}

/** Create or replace a story/slice file after validating its frontmatter. */
export function writeStoryFile(path: string, frontmatter: StoryFrontmatter, body: string): void {
  assertFrontmatter("story", frontmatter, path);
  atomicWrite(path, renderMarkdown(frontmatter, body));
}
export function writeSliceFile(path: string, frontmatter: SliceFrontmatter, body: string): void {
  assertFrontmatter("slice", frontmatter, path);
  atomicWrite(path, renderMarkdown(frontmatter, body));
}

function assertFrontmatter(name: "story" | "slice", value: unknown, path: string): void {
  const v = validated(name, value, path, "");
  if (!v.ok) throw new Error(`refusing to write invalid ${name} frontmatter to ${path}: ${JSON.stringify(v.reason === "corrupt" ? v.error.errors : v.reason)}`);
}

/**
 * Patch only `patch`'s keys in a markdown file's frontmatter (undefined deletes a key),
 * keeping other YAML and the body verbatim. Refuses keys outside `allowed` (§7.1) and
 * results that fail validation; a corrupt or missing file is returned unchanged.
 */
function patchMarkdown<N extends "story" | "slice">(
  name: N,
  allowed: readonly string[],
  path: string,
  patch: Record<string, unknown>,
  root?: string,
) {
  type T = N extends "story" ? StoryFrontmatter : SliceFrontmatter;
  for (const k of Object.keys(patch))
    if (!allowed.includes(k)) throw new Error(`the CLI may not change ${name} frontmatter field '${k}' (§7.1)`);
  const current = readMarkdown(name, path, root);
  if (!current.ok) return current;
  const split = splitFrontmatter(current.raw) as Split;
  const doc = parseDocument(split.yaml);
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) doc.delete(k);
    else doc.set(k, v);
  }
  const next = doc.toJS() as unknown;
  const v = validated(name, next, path, "", root);
  if (!v.ok) return v as ReadResult<MarkdownDoc<T>>;
  let yaml = doc.toString({ lineWidth: 0 });
  if (yaml === "{}\n") yaml = "";
  const text = `---\n${yaml}---\n${split.body}`;
  atomicWrite(path, text);
  return { ok: true, value: { frontmatter: v.value as T, body: split.body }, raw: text } as ReadResult<MarkdownDoc<T>>;
}

export const patchStoryFile = (path: string, patch: StoryPatch, root?: string) =>
  patchMarkdown("story", STORY_CLI_FIELDS, path, patch, root);
export const patchSliceFile = (path: string, patch: SlicePatch, root?: string) =>
  patchMarkdown("slice", SLICE_CLI_FIELDS, path, patch, root);
