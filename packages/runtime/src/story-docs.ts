/**
 * A story's documents (its spec, each unit's handoff): text kept with its run data, never in the
 * repo. The store's artifacts hold them when it offers artifacts; a store without them leaves them in
 * the machine folder, so a brief can name them either way.
 */
import { fail, normalizeArtifactPath, ok, type PluginResult, parseUnitId } from "@norn/plugin-api";
import type { RuntimeEnv } from "./env.ts";

export const HANDOFFS_DIR = "handoffs";

/** The artifact a unit's handoff is kept as: `handoffs/gh-12.md`, `handoffs/gh-12-03.md`. */
export function handoffArtifact(unit: string): string {
  return `${HANDOFFS_DIR}/${unit.replace("/", "-")}.md`;
}

function storyOf(unit: string): string {
  const ref = parseUnitId(unit);
  if (!ref) throw new RangeError(`not a unit id: ${JSON.stringify(unit)}`);
  return ref.story;
}

function fallbackPath(env: RuntimeEnv, story: string, path: string): string {
  return `${env.ctx.repo.dataDir}/runtime/docs/${story}/${path}`;
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The document's text, or null when there is none. `unit` may be a slice: its story keeps the document. */
export async function readStoryDoc(env: RuntimeEnv, unit: string, path: string): Promise<PluginResult<string | null>> {
  const story = storyOf(unit);
  const artifacts = env.slots.store.artifacts;
  if (artifacts) return artifacts.read(story, path);
  const clean = normalizeArtifactPath(path);
  if (clean === null) return fail("invalid", `${JSON.stringify(path)} cannot name a story document`, false);
  try {
    return ok(await env.ctx.files.read(fallbackPath(env, story, clean)));
  } catch (e) {
    return fail("unavailable", `reading ${clean} of ${story}: ${message(e)}`);
  }
}

export async function writeStoryDoc(env: RuntimeEnv, unit: string, path: string, text: string): Promise<PluginResult<null>> {
  const story = storyOf(unit);
  const artifacts = env.slots.store.artifacts;
  if (artifacts) return artifacts.write(story, path, text);
  const clean = normalizeArtifactPath(path);
  if (clean === null) return fail("invalid", `${JSON.stringify(path)} cannot name a story document`, false);
  try {
    await env.ctx.files.write(fallbackPath(env, story, clean), text);
    return ok(null);
  } catch (e) {
    return fail("unavailable", `writing ${clean} of ${story}: ${message(e)}`);
  }
}

/** Remove the document; removing one that is not there is not an error. */
export async function removeStoryDoc(env: RuntimeEnv, unit: string, path: string): Promise<PluginResult<null>> {
  const story = storyOf(unit);
  const artifacts = env.slots.store.artifacts;
  if (artifacts) return artifacts.remove(story, path);
  const clean = normalizeArtifactPath(path);
  if (clean === null) return fail("invalid", `${JSON.stringify(path)} cannot name a story document`, false);
  try {
    await env.ctx.files.remove(fallbackPath(env, story, clean));
    return ok(null);
  } catch (e) {
    return fail("unavailable", `removing ${clean} of ${story}: ${message(e)}`);
  }
}

/** The story's documents in `folder` (`slices`), as paths under it, sorted; one level only. */
export async function listStoryDocs(env: RuntimeEnv, unit: string, folder: string): Promise<PluginResult<string[]>> {
  const story = storyOf(unit);
  const clean = normalizeArtifactPath(folder);
  if (clean === null) return fail("invalid", `${JSON.stringify(folder)} cannot name a folder of story documents`, false);
  const artifacts = env.slots.store.artifacts;
  if (artifacts) {
    const all = await artifacts.list(story);
    if (!all.ok) return all;
    return ok(all.value.filter((p) => p.startsWith(`${clean}/`) && !p.slice(clean.length + 1).includes("/")));
  }
  try {
    return ok((await env.ctx.files.list(fallbackPath(env, story, clean))).map((n) => `${clean}/${n}`).sort());
  } catch (e) {
    return fail("unavailable", `listing ${clean} of ${story}: ${message(e)}`);
  }
}
