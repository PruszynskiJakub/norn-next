/**
 * What norn writes into a unit's worktree, as one table of mounts. The kernel's brief names its
 * inputs by kind (`spec`, `handoff`, `last_check`, ...); before a launch, and whenever `norn brief`
 * renders, each one norn holds is written by its row and the brief lists the paths, short ones inline.
 * The story's documents go to its spec folder, `.agents/specs/<story>/` (`spec.md`,
 * `handoffs/<unit>.md`, `slices/<nn>-<slug>.md`), the layout a repo keeping specs in `.agents` uses;
 * every other input goes to `.agents/inputs/`. Each input row's folder carries the `ignoreAll` mark, so
 * nothing the agent reads is ever committed, whether or not the repo commits the rest of `.agents/`.
 *
 * An `in` row is rewritten for every run. An `in-out` row is a document the agent edits: what it
 * changed is read back into the story's documents when it reports, while a tick gathers facts at a
 * slices step, and before the next materialization, so the next step reads it, a slice in its own
 * worktree included. A copy of what norn last wrote sits in `.agents/inputs/.base/`, and only a file
 * that differs from it is read back, so a worktree that kept a stale, untouched copy never overwrites
 * a newer document.
 *
 * Two more rows are written by the launcher before the agent starts, hooks first: the harness's hook
 * files, whose write and ownership check are `harness.install`'s, and the pack's skills in
 * `.agents/skills/`, with the harness's own skills folder as their second path (skills.ts).
 */
import type { BriefInputs, BriefInputView, BriefStory, UnitJournal } from "@norn/kernel";
import { fail, type Harness, type HostFiles, ok, type PluginResult, parseStoryKey, parseUnitId, type TrackerItem } from "@norn/plugin-api";
import type { RuntimeEnv } from "./env.ts";
import { standing, storyUnits } from "./input-history.ts";
import { type InputText, inputText } from "./inputs.ts";
import { harnessHeld, ignoreAll, skillMark } from "./ownership.ts";
import { installSkills, type PackSkills, SKILLS_DIR } from "./skills.ts";
import { mirrorItem, SPEC_ARTIFACT } from "./spec-mirror.ts";
import { handoffArtifact, listStoryDocs, readStoryDoc, writeStoryDoc } from "./story-docs.ts";

const AGENTS_DIR = ".agents";
/** the folder of each story's documents in a worktree: `.agents/specs/<story>/` */
export const SPECS_DIR = `${AGENTS_DIR}/specs`;
/** the folder of the inputs rewritten for every run */
export const INPUTS_DIR = `${AGENTS_DIR}/inputs`;
const BASE_DIR = `${INPUTS_DIR}/.base`;
const SLICES = "slices";
/** Text up to this long is shown in the brief itself as well as written to its file. */
const INLINE_MAX = 1500;

export const INPUTS_NOTE = `norn's files in this worktree are under \`${AGENTS_DIR}/\` and ignored by git: the story's spec and this unit's handoff in \`${SPECS_DIR}/<story>/\`, the other inputs in \`${INPUTS_DIR}/\`. Edit the handoff, and add your sections to the spec below its item block; norn reads both back when you report, and the slice files in its \`slices/\` folder too. The other inputs are rewritten for every run.`;

/** The worktree a unit's agent works in: its own with a vcs that makes worktrees, else the repo's checkout. */
export function worktreeOf(env: RuntimeEnv, unit: string): string {
  const vcs = env.slots.vcs;
  return vcs.capabilities.worktrees ? vcs.worktree.path(unit) : env.ctx.repo.root;
}

/** The story's spec folder in a worktree; `unit` may be a slice, whose story's folder it shares. */
export function specFolder(unit: string): string {
  const story = parseUnitId(unit)?.story;
  if (!story) throw new RangeError(`not a unit id: ${JSON.stringify(unit)}`);
  return `${SPECS_DIR}/${story}`;
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

async function readFile(env: RuntimeEnv, path: string): Promise<string | null> {
  try {
    return await env.ctx.files.read(path);
  } catch {
    return null;
  }
}

/** The story's tracker item, or null when the tracker does not have it or cannot answer now. */
export async function storyItem(env: RuntimeEnv, unit: string): Promise<TrackerItem | null> {
  const story = parseUnitId(unit)?.story;
  const key = story ? parseStoryKey(story, env.slots.tracker.keyPrefix) : null;
  if (!key) return null;
  try {
    const got = await env.slots.tracker.get(key.id);
    return got.ok ? got.value : null;
  } catch {
    return null;
  }
}

/**
 * Refresh the spec row's source: mirror the item into the story's spec, keeping every section written
 * beside it; nothing is written when it reads the same.
 */
export async function mirrorSpec(env: RuntimeEnv, unit: string, item: TrackerItem): Promise<PluginResult<string>> {
  const current = await readStoryDoc(env, unit, SPEC_ARTIFACT);
  if (!current.ok) return current;
  const next = mirrorItem(item, current.value);
  if (next !== current.value) {
    const wrote = await writeStoryDoc(env, unit, SPEC_ARTIFACT, next);
    if (!wrote.ok) return wrote;
  }
  return ok(next);
}

function handoffTemplate(unit: string): string {
  return `# Handoff: ${unit}\n\nThis unit's current state, for the next agent and the person. Rewrite it in place.\n\n## State\n\n## Notes\n`;
}

/** A row whose files are the story's documents: the agent edits them and they are read back. */
interface DocRow {
  readonly name: "spec" | "handoff" | "slices";
  readonly mode: "in-out";
  /** the ownership mark of the row's folder: norn's whole, so every write under it is allowed */
  readonly mark: typeof ignoreAll;
  /** the folder carrying the mark, relative to the worktree */
  readonly folder: (unit: string) => string;
  /** the row's documents present in `worktree`, as artifact paths in the story's documents */
  readonly present: (env: RuntimeEnv, unit: string, worktree: string) => Promise<string[]>;
  /** the name read back for `artifact`: the row's own, or the artifact for a folder of them */
  readonly nameOf: (artifact: string) => string;
  /** the text the row writes for `artifact`, or null when norn holds none */
  readonly source: (env: RuntimeEnv, unit: string, artifact: string, item: TrackerItem | null) => Promise<string | null>;
}

/** The row of every other input: a file per kind, rewritten for every run. */
interface InputsRow {
  readonly name: "inputs";
  readonly mode: "in";
  readonly mark: typeof ignoreAll;
  readonly folder: (unit: string) => string;
  readonly source: (env: RuntimeEnv, record: UnitJournal, brief: BriefInputs, kind: string) => Promise<InputText>;
}

/** The pack's skills: an `in` row under the skills' mark, its second path the harness's skills folder. */
interface SkillsRow {
  readonly name: "skills";
  readonly mode: "in";
  readonly mark: typeof skillMark;
  readonly folder: () => string;
  /** the harness's own skills folder, linked to the row's folder; none when the harness reads no skills */
  readonly second: (harness: Harness) => string | undefined;
  readonly write: typeof installSkills;
}

/** The harness's hook files: written, and their ownership checked, by the harness itself. */
interface HooksRow {
  readonly name: "hooks";
  readonly mode: "in";
  readonly mark: typeof harnessHeld;
  readonly write: (harness: Harness, worktree: string, hookCommand: string) => Promise<unknown>;
}

const kept = async (env: RuntimeEnv, unit: string, artifact: string): Promise<string | null> => {
  const got = await readStoryDoc(env, unit, artifact);
  return got.ok ? got.value : null;
};

async function slicesIn(env: RuntimeEnv, unit: string, worktree: string): Promise<string[]> {
  let names: string[];
  try {
    names = await env.ctx.files.list(`${worktree}/${specFolder(unit)}/${SLICES}`);
  } catch {
    return [];
  }
  return names.filter((n) => n.endsWith(".md")).map((n) => `${SLICES}/${n}`);
}

const SPEC: DocRow = {
  name: "spec",
  mode: "in-out",
  mark: ignoreAll,
  folder: specFolder,
  present: async () => [SPEC_ARTIFACT],
  nameOf: () => "spec",
  source: async (env, unit, _artifact, item) => {
    const got = item ? await mirrorSpec(env, unit, item) : await readStoryDoc(env, unit, SPEC_ARTIFACT);
    return got.ok ? got.value : null;
  },
};

const HANDOFF: DocRow = {
  name: "handoff",
  mode: "in-out",
  mark: ignoreAll,
  folder: specFolder,
  present: async (_env, unit) => [handoffArtifact(unit)],
  nameOf: () => "handoff",
  source: (env, unit, artifact) => kept(env, unit, artifact),
};

const SLICE_FILES: DocRow = {
  name: "slices",
  mode: "in-out",
  mark: ignoreAll,
  folder: specFolder,
  present: slicesIn,
  nameOf: (artifact) => artifact,
  source: (env, unit, artifact) => kept(env, unit, artifact),
};

const INPUTS: InputsRow = { name: "inputs", mode: "in", mark: ignoreAll, folder: () => INPUTS_DIR, source: inputText };

const SKILLS: SkillsRow = { name: "skills", mode: "in", mark: skillMark, folder: () => SKILLS_DIR, second: (harness) => harness.skillsDir, write: installSkills };

const HOOKS: HooksRow = { name: "hooks", mode: "in", mark: harnessHeld, write: (harness, worktree, hookCommand) => harness.install({ worktree, hookCommand }) };

/** Every file norn writes into a worktree, row by row. */
const MOUNTS: readonly (DocRow | InputsRow | SkillsRow | HooksRow)[] = [INPUTS, SPEC, HANDOFF, SLICE_FILES, SKILLS, HOOKS];
/** The rows of a step's inputs, each under a folder norn owns whole. */
const INPUT_ROWS = MOUNTS.filter((r): r is DocRow | InputsRow => r.mark === ignoreAll);
const DOC_ROWS = MOUNTS.filter((r): r is DocRow => r.mode === "in-out");

/** The file an `in-out` row's artifact is mounted at, relative to the worktree. */
const fileOf = (row: DocRow, unit: string, artifact: string): string => `${row.folder(unit)}/${artifact}`;
const baseOf = (file: string): string => `${BASE_DIR}/${file.slice(AGENTS_DIR.length + 1)}`;

/** Mount a document: its file and, so read-back can tell an edit, the copy of what norn wrote. */
async function mountDoc(env: RuntimeEnv, worktree: string, row: DocRow, unit: string, artifact: string, text: string): Promise<string> {
  const file = fileOf(row, unit, artifact);
  await env.ctx.files.write(`${worktree}/${file}`, text);
  await env.ctx.files.write(`${worktree}/${baseOf(file)}`, text);
  return file;
}

/** Mount an input as its file (and keep it inline when short). */
async function mountInput(env: RuntimeEnv, worktree: string, unit: string, name: string, got: { label: string; text: string }): Promise<BriefInputView> {
  const path = `${INPUTS.folder(unit)}/${name}.md`;
  await env.ctx.files.write(`${worktree}/${path}`, got.text.endsWith("\n") ? got.text : `${got.text}\n`);
  return { name, label: got.label, path, ...(got.text.length <= INLINE_MAX && { text: got.text }) };
}

/**
 * The read-back rule over the `in-out` rows: each of the unit's documents in its worktree that
 * differs from what norn last wrote there goes into the story's documents. Answers the names read
 * back; a document that cannot be read back is left as it is, never half written.
 */
export async function readBackDocs(env: RuntimeEnv, unit: string, worktree = worktreeOf(env, unit)): Promise<string[]> {
  const back: string[] = [];
  for (const row of DOC_ROWS) {
    for (const artifact of await row.present(env, unit, worktree)) {
      const file = fileOf(row, unit, artifact);
      const text = await readFile(env, `${worktree}/${file}`);
      if (text === null) continue;
      const base = await readFile(env, `${worktree}/${baseOf(file)}`);
      if (text === base) continue;
      const wrote = await writeStoryDoc(env, unit, artifact, text);
      if (!wrote.ok) continue;
      try {
        await env.ctx.files.write(`${worktree}/${baseOf(file)}`, text);
      } catch {
        // the document is kept; a missing base only reads it back once more, unchanged
      }
      back.push(row.nameOf(artifact));
    }
  }
  return back;
}

export interface MaterializedInputs {
  inputs: BriefInputView[];
  story?: BriefStory;
  /** the handoff's path, relative to the worktree, when the step names one */
  handoff?: string;
}

/**
 * Write the step's inputs into the unit's worktree and say where each is. Edited documents are read
 * back first, so a rewrite never drops what the agent changed; an input norn holds nothing for is
 * listed with a note rather than left out, so the agent knows it looked.
 */
export async function materializeInputs(env: RuntimeEnv, record: UnitJournal, brief: BriefInputs, worktree = worktreeOf(env, record.unit)): Promise<PluginResult<MaterializedInputs>> {
  const unit = record.unit;
  try {
    const marked = new Set<string>();
    for (const row of INPUT_ROWS) {
      const folder = row.folder(unit);
      if (marked.has(folder)) continue;
      marked.add(folder);
      await row.mark.mark(env.ctx.files, `${worktree}/${folder}`);
    }
    await readBackDocs(env, unit, worktree);
    const item = await storyItem(env, unit);
    const out: MaterializedInputs = { inputs: [] };
    if (item) out.story = { key: item.key, title: item.title, ...(item.url !== undefined && { url: item.url }) };
    for (const input of brief.inputs) {
      if (typeof input !== "string") {
        out.inputs.push({ name: input.file, ...(input.label !== undefined && { label: input.label }), path: input.file });
        continue;
      }
      out.inputs.push(await materializeOne(env, record, brief, worktree, input, item, out));
    }
    return ok(out);
  } catch (e) {
    return { ok: false, failure: { code: "unavailable", message: `the inputs of ${unit} could not be written under ${worktree}/${AGENTS_DIR}: ${message(e)}`, retryable: true } };
  }
}

async function materializeOne(env: RuntimeEnv, record: UnitJournal, brief: BriefInputs, worktree: string, name: string, item: TrackerItem | null, out: MaterializedInputs): Promise<BriefInputView> {
  const unit = record.unit;
  switch (name) {
    case "spec": {
      const text = await SPEC.source(env, unit, SPEC_ARTIFACT, item);
      if (text === null) return { name, label: "the story's spec", note: "norn holds no spec for this story yet: the tracker item could not be read" };
      return { name, label: "the story's spec: its tracker item, mirrored, and the sections later steps added", path: await mountDoc(env, worktree, SPEC, unit, SPEC_ARTIFACT, text) };
    }
    case "handoff": {
      const artifact = handoffArtifact(unit);
      // an empty handoff is filled from the template, so the agent always has one to rewrite
      const text = (await HANDOFF.source(env, unit, artifact, item)) ?? handoffTemplate(unit);
      out.handoff = await mountDoc(env, worktree, HANDOFF, unit, artifact, text);
      return { name, label: "this unit's handoff, which you keep current", path: out.handoff };
    }
    case "slice":
      return materializeSlice(env, worktree, unit, name);
    case "slices":
      return materializeSlices(env, worktree, unit, name);
    default: {
      const got = await INPUTS.source(env, record, brief, name);
      if ("note" in got) return { name, ...(got.label !== undefined && { label: got.label }), note: got.note };
      return mountInput(env, worktree, unit, name, got);
    }
  }
}

/**
 * The story's slice files as its documents hold them, after reading back the ones edited in the
 * story's worktree: a person edits them there at the slice gate, and a slice runs in a worktree of its
 * own, so its file reaches it only through the documents.
 */
async function sliceDocs(env: RuntimeEnv, unit: string): Promise<string[]> {
  const story = parseUnitId(unit)?.story;
  if (story && story !== unit) await readBackDocs(env, story);
  const listed = await listStoryDocs(env, unit, SLICES);
  return listed.ok ? listed.value.filter((p) => p.endsWith(".md")) : [];
}

async function materializeSlice(env: RuntimeEnv, worktree: string, unit: string, name: string): Promise<BriefInputView> {
  const label = "this slice's file: its scope, dependencies and acceptance criteria, each with its verifier";
  const nn = parseUnitId(unit)?.slice;
  if (!nn) return { name, label, note: `${unit} is the story, not a slice: it has no slice file of its own (\`slices\` names them all)` };
  const artifact = (await sliceDocs(env, unit)).find((p) => p.slice(SLICES.length + 1).startsWith(`${nn}-`));
  const text = artifact ? await SLICE_FILES.source(env, unit, artifact, null) : null;
  if (!artifact || text === null) return { name, label, note: `norn holds no slice file for ${unit}: none named \`${SLICES}/${nn}-<slug>.md\` was written to the story's spec folder` };
  return { name, label, path: await mountDoc(env, worktree, SLICE_FILES, unit, artifact, text) };
}

async function materializeSlices(env: RuntimeEnv, worktree: string, unit: string, name: string): Promise<BriefInputView> {
  const label = "every slice file of the story: scope, dependencies, acceptance criteria";
  const folder = `${SLICE_FILES.folder(unit)}/${SLICES}/`;
  const artifacts = await sliceDocs(env, unit);
  const units = new Map((await storyUnits(env, unit)).map((u) => [u.unit, u]));
  const story = parseUnitId(unit)?.story ?? unit;
  const lines: string[] = [];
  for (const artifact of artifacts) {
    const text = await SLICE_FILES.source(env, unit, artifact, null);
    if (text === null) continue;
    await mountDoc(env, worktree, SLICE_FILES, unit, artifact, text);
    const file = artifact.slice(SLICES.length + 1);
    const nn = /^(\d+)-/.exec(file)?.[1];
    const u = nn ? units.get(`${story}/${nn}`) : undefined;
    lines.push(`- \`${file}\`: ${u ? standing(u) : "not started"}`);
  }
  if (lines.length === 0) return { name, label, path: folder, note: `no slice files yet: the slice step writes them to \`${folder}\`` };
  return { name, label, path: folder, text: `The slice files, each with where its slice stands:\n\n${lines.join("\n")}` };
}

/**
 * Mount the rows a launch writes before the agent starts: the hooks, then the pack's skills. A row
 * that cannot be written refuses the launch, naming the harness and where.
 */
export async function mountLaunch(files: HostFiles, harness: Harness, worktree: string, hookCommand: string, skills: PackSkills | undefined): Promise<PluginResult<void>> {
  try {
    await HOOKS.write(harness, worktree, hookCommand);
  } catch (e) {
    return fail("unavailable", `${harness.name}: installing hooks in ${worktree} failed: ${message(e)}`);
  }
  const second = SKILLS.second(harness);
  if (second === undefined || skills === undefined) return ok(undefined);
  try {
    await SKILLS.write(files, worktree, second, skills);
  } catch (e) {
    return fail("unavailable", `${harness.name}: writing the pack's skills to ${worktree}/${second} failed: ${message(e)}`);
  }
  return ok(undefined);
}
