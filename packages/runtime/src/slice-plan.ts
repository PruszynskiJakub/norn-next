/**
 * The story's slice plan as decide reads it: each slice file the story keeps as a document
 * (`slices/<nn>-<slug>.md`), read from its frontmatter only: `id`, `depends_on`, `workflow` and a
 * `status` of `dropped`. A file that does not parse or does not validate makes the whole plan
 * invalid, never a plan without that slice: starting the others could start a slice whose
 * dependency was the broken one.
 */
import type { SlicePlan } from "@norn/kernel";
import { ok, type PluginResult, parseUnitId } from "@norn/plugin-api";
import { parse } from "yaml";
import { frontmatterOf } from "./criteria.ts";
import type { RuntimeEnv } from "./env.ts";
import { listStoryDocs, readStoryDoc } from "./story-docs.ts";

const SLICES = "slices";
const FILE_RE = /^([0-9]{2,3})-[^/]+\.md$/;
const WORKFLOW_RE = /^[a-z][a-z0-9_-]*$/;

type Planned = SlicePlan["slices"][number];
type Parsed = { slice: Planned | null } | { invalid: string };

function parseSlice(story: string, file: string, nn: string, text: string): Parsed {
  const yaml = frontmatterOf(text);
  if (yaml === null) return { invalid: `${file} has no frontmatter` };
  let data: unknown;
  try {
    data = parse(yaml);
  } catch (e) {
    return { invalid: `the frontmatter of ${file} is not valid YAML: ${(e as Error).message}` };
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) return { invalid: `the frontmatter of ${file} is not a mapping` };
  const fm = data as Record<string, unknown>;
  const unit = `${story}/${nn}`;
  if (fm.id !== unit) return { invalid: `${file} has id ${JSON.stringify(fm.id ?? null)}; its file name makes it ${unit}` };
  if (fm.status === "dropped") return { slice: null };
  const deps = fm.depends_on ?? [];
  if (!Array.isArray(deps) || deps.some((d) => typeof d !== "string")) return { invalid: `${file}: depends_on is not a list of slice ids` };
  for (const d of deps as string[]) {
    const ref = parseUnitId(d);
    if (ref?.story !== story || ref.slice === null) return { invalid: `${file}: depends_on names ${JSON.stringify(d)}, not a slice of ${story}` };
    if (d === unit) return { invalid: `${file}: ${unit} depends on itself` };
  }
  const workflow = fm.workflow;
  if (workflow !== undefined && workflow !== null && (typeof workflow !== "string" || !WORKFLOW_RE.test(workflow)))
    return { invalid: `${file}: workflow ${JSON.stringify(workflow)} is not a workflow name` };
  return { slice: { unit, depends_on: [...new Set(deps as string[])], ...(typeof workflow === "string" && { workflow }) } };
}

/**
 * The plan of `story`'s slice files; undefined when it keeps none, so decide reads "no slice files".
 * A store that cannot be read fails: an empty plan would end the slices step stuck for nothing.
 */
export async function readSlicePlan(env: RuntimeEnv, story: string): Promise<PluginResult<SlicePlan | undefined>> {
  const listed = await listStoryDocs(env, story, SLICES);
  if (!listed.ok) return listed;
  const files = listed.value.filter((p) => p.endsWith(".md"));
  if (files.length === 0) return ok(undefined);
  const slices: Planned[] = [];
  const invalid = (why: string) => ok({ slices: [], invalid: why });
  const seen = new Set<string>();
  for (const path of files) {
    const file = path.slice(SLICES.length + 1);
    const nn = FILE_RE.exec(file)?.[1];
    if (nn === undefined) return invalid(`${path} is not named <nn>-<slug>.md`);
    if (seen.has(nn)) return invalid(`more than one slice file is numbered ${nn}`);
    seen.add(nn);
    const read = await readStoryDoc(env, story, path);
    if (!read.ok) return read;
    if (read.value === null) continue;
    const parsed = parseSlice(story, path, nn, read.value);
    if ("invalid" in parsed) return invalid(parsed.invalid);
    if (parsed.slice) slices.push(parsed.slice);
  }
  const units = new Set(slices.map((s) => s.unit));
  for (const s of slices) {
    const missing = s.depends_on.find((d) => !units.has(d));
    // a slice waiting on one that is not planned would never start
    if (missing) return invalid(`${s.unit} depends on ${missing}, which no slice file plans (or it is dropped)`);
  }
  return ok({ slices });
}
