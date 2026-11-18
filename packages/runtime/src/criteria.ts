/**
 * The criteria a unit declares, which a criteria report must cover: the frontmatter `criteria` of the
 * story's spec for the story unit, of the slice's file for a slice. Read after the agent's edits are
 * read back, so the report is checked against the spec the agent just saw. A frontmatter that does
 * not parse or a `criteria` that fails validation is refused, never read as "none declared": a QA
 * report checked against nothing would pass whatever it covers.
 */
import { ok, parseUnitId, type PluginResult } from "@norn/plugin-api";
import { check, Criterion } from "@norn/schema";
import { Type } from "@sinclair/typebox";
import { parse } from "yaml";
import type { RuntimeEnv } from "./env.ts";
import { specFolder, worktreeOf } from "./inputs.ts";
import { SPEC_ARTIFACT } from "./spec-mirror.ts";
import { listStoryDocs, readStoryDoc } from "./story-docs.ts";

const Criteria = Type.Array(Criterion);

/** The YAML of a leading frontmatter block, or null when the text has none. */
export function frontmatterOf(text: string): string | null {
  if (!text.startsWith("---\n")) return null;
  const end = text.indexOf("\n---", 3);
  if (end < 0) return null;
  const after = text.charAt(end + 4);
  return after === "" || after === "\n" ? text.slice(4, end + 1) : null;
}

export type DeclaredCriteria = PluginResult<{ criteria: Criterion[] | null; file: string }>;

/** The `criteria` of `text`'s frontmatter; null when the frontmatter or the key is absent. */
export function criteriaOf(text: string | null, file: string): DeclaredCriteria {
  const yaml = text === null ? null : frontmatterOf(text);
  if (yaml === null) return ok({ criteria: null, file });
  let data: unknown;
  try {
    data = parse(yaml);
  } catch (e) {
    return { ok: false, failure: { code: "invalid", message: `the frontmatter of ${file} is not valid YAML: ${(e as Error).message}`, retryable: false } };
  }
  const raw = data !== null && typeof data === "object" ? (data as Record<string, unknown>).criteria : undefined;
  if (raw === undefined || raw === null) return ok({ criteria: null, file });
  const v = check(Criteria, raw);
  if (!v.ok) return { ok: false, failure: { code: "invalid", message: `the frontmatter criteria of ${file} do not validate: ${v.errors.map((e) => `${e.path || "/"} ${e.message}`).join("; ")}`, retryable: false } };
  return ok({ criteria: v.value, file });
}

/** The slice's file in its worktree's spec folder, `slices/<nn>-<slug>.md`; null when there is none. */
async function sliceFile(env: RuntimeEnv, unit: string, nn: string): Promise<{ path: string; file: string } | null> {
  const dir = `${specFolder(unit)}/slices`;
  const worktree = worktreeOf(env, unit);
  const names = await env.ctx.files.list(`${worktree}/${dir}`);
  const name = names.find((n) => n.startsWith(`${nn}-`) && n.endsWith(".md"));
  return name ? { path: `${worktree}/${dir}/${name}`, file: `${dir}/${name}` } : null;
}

/**
 * The slice's file as the story's documents hold it, for a slice whose worktree has none: a step that
 * does not name the `slice` input never had it written there, and its criteria still count.
 */
async function sliceDocument(env: RuntimeEnv, unit: string, nn: string): Promise<PluginResult<{ text: string; file: string } | null>> {
  const listed = await listStoryDocs(env, unit, "slices");
  if (!listed.ok) return listed;
  const artifact = listed.value.find((p) => p.slice("slices/".length).startsWith(`${nn}-`) && p.endsWith(".md"));
  if (!artifact) return ok(null);
  const read = await readStoryDoc(env, unit, artifact);
  if (!read.ok) return read;
  return ok(read.value === null ? null : { text: read.value, file: `${specFolder(unit)}/${artifact}` });
}

export async function declaredCriteria(env: RuntimeEnv, unit: string): Promise<DeclaredCriteria> {
  const ref = parseUnitId(unit);
  if (ref?.slice) {
    const nn = ref.slice;
    try {
      const found = await sliceFile(env, unit, nn);
      if (found) return criteriaOf(await env.ctx.files.read(found.path), found.file);
    } catch (e) {
      return { ok: false, failure: { code: "unavailable", message: `reading the slice file of ${unit}: ${(e as Error).message}`, retryable: true } };
    }
    const kept = await sliceDocument(env, unit, nn);
    if (!kept.ok) return kept;
    if (!kept.value) return ok({ criteria: null, file: `${specFolder(unit)}/slices/${nn}-*.md` });
    return criteriaOf(kept.value.text, kept.value.file);
  }
  const spec = await readStoryDoc(env, unit, SPEC_ARTIFACT);
  if (!spec.ok) return spec;
  return criteriaOf(spec.value, `${specFolder(unit)}/${SPEC_ARTIFACT}`);
}
