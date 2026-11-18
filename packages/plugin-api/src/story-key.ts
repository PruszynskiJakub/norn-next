/**
 * Story keys any tracker can mint: `<prefix>-<id>`, the prefix declared by the tracker (`gh`, `lt`,
 * ...) and the id a positive integer. Branch and slug rules are the old ones with only the prefix
 * opened up, so a branch made before the cutover still parses.
 */
import { SLICE_NN_PATTERN, SLUG_PATTERN, slugify as schemaSlugify } from "@norn/schema";
import { Type } from "@sinclair/typebox";

export const KEY_PREFIX_PATTERN = "^[a-z][a-z0-9]{0,7}$";
export const GENERIC_STORY_KEY_PATTERN = "^[a-z][a-z0-9]{0,7}-[1-9][0-9]*$";

/** A story key with any tracker's prefix, e.g. `gh-12` or `lt-3`. */
export const GenericStoryKey = Type.String({ pattern: GENERIC_STORY_KEY_PATTERN, description: "Story key <prefix>-<id>, e.g. gh-12 or lt-3" });

const PREFIX_RE = new RegExp(KEY_PREFIX_PATTERN);
const KEY_RE = /^([a-z][a-z0-9]{0,7})-([1-9][0-9]*)$/;
const SLUG_RE = new RegExp(SLUG_PATTERN);
const NN_RE = new RegExp(SLICE_NN_PATTERN);

export interface StoryKey {
  prefix: string;
  id: number;
}

export function isKeyPrefix(s: unknown): s is string {
  return typeof s === "string" && PREFIX_RE.test(s);
}

/** `gh-12` → `{ prefix: "gh", id: 12 }`; null for anything else, or for another tracker's prefix when `prefix` is given. */
export function parseStoryKey(key: string, prefix?: string): StoryKey | null {
  const m = KEY_RE.exec(key);
  if (!m) return null;
  const id = Number(m[2]);
  // a key past the safe integers cannot round-trip, and two such keys could name one story
  if (!Number.isSafeInteger(id)) return null;
  if (prefix !== undefined && m[1] !== prefix) return null;
  return { prefix: m[1] as string, id };
}

export function formatStoryKey(prefix: string, id: number): string {
  if (!isKeyPrefix(prefix)) throw new RangeError(`bad story key prefix: ${JSON.stringify(prefix)}`);
  if (!Number.isSafeInteger(id) || id < 1) throw new RangeError(`bad story id: ${id}`);
  return `${prefix}-${id}`;
}

function assertKey(key: string): void {
  if (!parseStoryKey(key)) throw new RangeError(`not a story key: ${JSON.stringify(key)}`);
}

function assertSlug(slug: string): void {
  if (!SLUG_RE.test(slug)) throw new RangeError(`not a slug: ${JSON.stringify(slug)}`);
}

/** The story branch and spec folder name: `gh-12-fix-login`. */
export function storyBranch(key: string, slug: string): string {
  assertKey(key);
  assertSlug(slug);
  return `${key}-${slug}`;
}

/** A slice branch: `gh-12/03-add-form`; `nn` is padded to two digits and may have three. */
export function sliceBranch(key: string, nn: number | string, slug: string): string {
  assertKey(key);
  assertSlug(slug);
  const padded = String(nn).padStart(2, "0");
  if (!NN_RE.test(padded)) throw new RangeError(`bad slice number: ${nn}`);
  return `${key}/${padded}-${slug}`;
}

/**
 * Lowercase ASCII `[a-z0-9]` words joined by `-`, at most `max` characters cut at a word boundary,
 * `untitled` when nothing remains. The same rule as every branch made so far, so both name alike.
 */
export function slugify(title: string, max?: number): string {
  return schemaSlugify(title, max);
}
