/**
 * Making a step's inputs readable. The kernel's brief names its inputs by kind (`spec`, `handoff`,
 * `last_check`, ...); before a launch, and whenever `norn brief` renders, the host writes each one it
 * holds as a file under `.agents/` inside the unit's worktree and the brief lists the paths, short
 * ones inline. The story's documents go to its spec folder, `.agents/specs/<story>/` (`spec.md`,
 * `handoffs/<unit>.md`), the layout a repo keeping specs in `.agents` uses; every other input goes to
 * `.agents/inputs/`. Each folder norn writes holds a `.gitignore` of `*`, so nothing the agent reads is
 * ever committed, whether or not the repo commits the rest of `.agents/`.
 *
 * The spec, the handoff and the slice files (`slices/<nn>-<slug>.md`) are documents the agent edits
 * there: what it changed is read back into the story's documents when it reports (and before the next
 * materialization), so the next step reads it, a slice in its own worktree included.
 * A copy of what norn last wrote sits in `.agents/inputs/.base/`, and only a file that differs from it
 * is read back, so a worktree that kept a stale, untouched copy never overwrites a newer document.
 */
import type { BriefInputs, BriefInputView, BriefStory, KernelReceipt, UnitJournal } from "@norn/kernel";
import { ok, type PluginResult, parseStoryKey, parseUnitId, type TrackerItem } from "@norn/plugin-api";
import type { CriterionVerdict } from "@norn/schema";
import { baseRefOf, cutFrom } from "./branches.ts";
import type { RuntimeEnv } from "./env.ts";
import { mirrorItem, SPEC_ARTIFACT } from "./spec-mirror.ts";
import { readStepRun } from "./step-runs.ts";
import { baseSideOf, recordOf, type Resolved, resolutionOf, roundOf, standing, storyUnits } from "./input-history.ts";
import { handoffArtifact, listStoryDocs, readStoryDoc, writeStoryDoc } from "./story-docs.ts";

const AGENTS_DIR = ".agents";
/** the folder of each story's documents in a worktree: `.agents/specs/<story>/` */
export const SPECS_DIR = `${AGENTS_DIR}/specs`;
/** the folder of the inputs rewritten for every run */
export const INPUTS_DIR = `${AGENTS_DIR}/inputs`;
const BASE_DIR = `${INPUTS_DIR}/.base`;
const IGNORE_ALL = "*\n";
/** Text up to this long is shown in the brief itself as well as written to its file. */
const INLINE_MAX = 1500;

export const INPUTS_NOTE = `norn's files in this worktree are under \`${AGENTS_DIR}/\` and ignored by git: the story's spec and this unit's handoff in \`${SPECS_DIR}/<story>/\`, the other inputs in \`${INPUTS_DIR}/\`. Edit the handoff, and add your sections to the spec below its item block; norn reads both back when you report, and the slice files in its \`slices/\` folder too. The other inputs are rewritten for every run.`;

/** The worktree a unit's agent works in: its own with a vcs that makes worktrees, else the repo's checkout. */
export function worktreeOf(env: RuntimeEnv, unit: string): string {
  const vcs = env.slots.vcs;
  return vcs.capabilities.worktrees ? vcs.worktree.path(unit) : env.ctx.repo.root;
}

interface Doc {
  /** `spec`, `handoff`, or a slice file's artifact path (`slices/01-parser.md`) */
  name: string;
  artifact: string;
  /** its file relative to the worktree: the artifact's own path in the story's spec folder */
  file: string;
  /** what norn last wrote there, relative to the worktree */
  base: string;
}

/** The story's spec folder in a worktree; `unit` may be a slice, whose story's folder it shares. */
export function specFolder(unit: string): string {
  const story = parseUnitId(unit)?.story;
  if (!story) throw new RangeError(`not a unit id: ${JSON.stringify(unit)}`);
  return `${SPECS_DIR}/${story}`;
}

function doc(name: string, unit: string, artifact: string): Doc {
  const file = `${specFolder(unit)}/${artifact}`;
  return { name, artifact, file, base: `${BASE_DIR}/${file.slice(AGENTS_DIR.length + 1)}` };
}
const docsOf = (unit: string): Doc[] => [doc("spec", unit, SPEC_ARTIFACT), doc("handoff", unit, handoffArtifact(unit))];

/** The story's slice files are documents too: the slice step writes them here, and each slice reads its own. */
const SLICES = "slices";
const sliceDoc = (unit: string, artifact: string): Doc => doc(artifact, unit, artifact);

/** The slice files in the worktree's spec folder, as documents to read back. */
async function sliceDocsIn(env: RuntimeEnv, unit: string, worktree: string): Promise<Doc[]> {
  let names: string[];
  try {
    names = await env.ctx.files.list(`${worktree}/${specFolder(unit)}/${SLICES}`);
  } catch {
    return [];
  }
  return names.filter((n) => n.endsWith(".md")).map((n) => sliceDoc(unit, `${SLICES}/${n}`));
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

/** Mirror the item into the story's spec, keeping every section written beside it; nothing is written when it reads the same. */
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

/**
 * Read the unit's edited documents in its worktree back into the story's documents: each one that
 * differs from what norn last wrote there. Answers the names read back; a document that cannot be
 * read back is left as it is, never half written.
 */
export async function readBackDocs(env: RuntimeEnv, unit: string, worktree = worktreeOf(env, unit)): Promise<string[]> {
  const back: string[] = [];
  for (const d of [...docsOf(unit), ...(await sliceDocsIn(env, unit, worktree))]) {
    const text = await readFile(env, `${worktree}/${d.file}`);
    if (text === null) continue;
    const base = await readFile(env, `${worktree}/${d.base}`);
    if (text === base) continue;
    const wrote = await writeStoryDoc(env, unit, d.artifact, text);
    if (!wrote.ok) continue;
    try {
      await env.ctx.files.write(`${worktree}/${d.base}`, text);
    } catch {
      // the document is kept; a missing base only reads it back once more, unchanged
    }
    back.push(d.name);
  }
  return back;
}

function handoffTemplate(unit: string): string {
  return `# Handoff: ${unit}\n\nThis unit's current state, for the next agent and the person. Rewrite it in place.\n\n## State\n\n## Notes\n`;
}

/**
 * The receipt whose findings the step reads: the one that sent this visit back, else (a review of
 * rework) the latest this round that carried findings, unless a clean judgement settled it since.
 * Only that one: older findings were answered by the rework since, and showing them again would send
 * the agent after problems already fixed. A red check is skipped in the search, never a stop: it has
 * no findings of its own, and the review findings before it are still the ones the rework answers.
 */
function findingsReceipt(record: UnitJournal, reworkFrom: number | undefined): KernelReceipt | undefined {
  if (reworkFrom !== undefined) {
    const r = record.receipts.find((x) => x.seq === reworkFrom);
    return r && r.data.kind !== "check.finished" ? r : undefined;
  }
  const round = roundOf(record);
  const at = round.findLastIndex((x) => carriesFindings(record, x));
  const found = round[at];
  if (!found) return undefined;
  return round.slice(at + 1).some((x) => settles(record, found, x)) ? undefined : found;
}

const handsBackFindings = (record: UnitJournal, step: string | undefined, outcome: string | undefined): boolean =>
  step !== undefined && outcome !== undefined && record.state?.workflow.doc.steps[step]?.hand_back?.[outcome] === "findings";

function carriesFindings(record: UnitJournal, r: KernelReceipt): boolean {
  const d = r.data;
  if (d.kind === "gate.decided") return d.outcome === "reject";
  if (d.kind !== "run.reported" || d.verb !== "done" || (d.text === undefined && d.criteria === undefined)) return false;
  return handsBackFindings(record, d.step, d.outcome);
}

/** Whether `later` judged the work clean after `found`: a gate decided `approve`, or the step that sent the findings reported an outcome that hands none back. */
function settles(record: UnitJournal, found: KernelReceipt, later: KernelReceipt): boolean {
  const d = later.data;
  if (d.kind === "gate.decided") return d.outcome === "approve" || (d.step === found.data.step && d.outcome !== "reject");
  return d.kind === "run.reported" && d.verb === "done" && d.step === found.data.step && !handsBackFindings(record, d.step, d.outcome);
}

function noFindingsNote(record: UnitJournal, brief: BriefInputs): string {
  const by = brief.rework_from !== undefined ? record.receipts.find((x) => x.seq === brief.rework_from) : undefined;
  if (by?.data.kind !== "check.finished") return "no findings sent this work back";
  const where = brief.inputs.includes("last_check") ? "under Rework and in `last_check`" : "under Rework";
  return `the check \`${by.data.step ?? "check"}\` sent the work back, with no findings: its output is ${where}`;
}

/** The criteria a report did not pass, one line each, with the repro or how to check it. */
export function unsettledCriteria(criteria: readonly CriterionVerdict[] | undefined): string {
  const lines = (criteria ?? [])
    .filter((c) => c.verdict !== "pass")
    .map((c) => `- \`${c.id}\` ${c.verdict}${c.repro ? `: ${c.repro}` : ""}${c.reason ? ` (${c.reason})` : ""}${c.how ? `; how to check: ${c.how}` : ""}${c.evidence ? `; evidence: ${c.evidence}` : ""}`);
  return lines.length > 0 ? `\n\nCriteria not passed:\n\n${lines.join("\n")}` : "";
}

function findingsText(r: KernelReceipt): string | null {
  const d = r.data;
  if (d.kind === "gate.decided") return `\`${d.step ?? "the gate"}\` was decided \`${d.outcome}\` by ${d.by}${d.reason ? `:\n\n${d.reason}` : "."}`;
  if (d.kind === "run.reported") return `\`${d.step ?? "a step"}\` reported \`${d.verb}${d.outcome ? ` ${d.outcome}` : ""}\`${d.text ? `:\n\n${d.text}` : "."}${unsettledCriteria(d.criteria)}`;
  return null;
}

async function lastCheckText(env: RuntimeEnv, record: UnitJournal): Promise<string | null> {
  const r = record.receipts.findLast((x) => x.data.kind === "check.finished");
  if (!r || r.data.kind !== "check.finished") return null;
  const d = r.data;
  const head = `Check \`${d.step ?? "check"}\` exited ${d.exit} (\`${d.outcome}\`).`;
  const run = await readStepRun(env.ctx, record.unit);
  const tail = run && run.run_id === d.run_id ? run.output?.trimEnd() : undefined;
  return tail ? `${head}\n\nThe end of its output:\n\n${tail}` : head;
}

/** Write `text` as the input's file (and keep it inline when short). */
async function written(env: RuntimeEnv, worktree: string, name: string, file: string, label: string, text: string): Promise<BriefInputView> {
  const path = `${INPUTS_DIR}/${file}`;
  await env.ctx.files.write(`${worktree}/${path}`, text.endsWith("\n") ? text : `${text}\n`);
  return { name, label, path, ...(text.length <= INLINE_MAX && { text }) };
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
    await env.ctx.files.write(`${worktree}/${INPUTS_DIR}/.gitignore`, IGNORE_ALL);
    await env.ctx.files.write(`${worktree}/${specFolder(unit)}/.gitignore`, IGNORE_ALL);
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

async function materializeDoc(env: RuntimeEnv, worktree: string, d: Doc, text: string): Promise<void> {
  await env.ctx.files.write(`${worktree}/${d.file}`, text);
  await env.ctx.files.write(`${worktree}/${d.base}`, text);
}

async function materializeOne(env: RuntimeEnv, record: UnitJournal, brief: BriefInputs, worktree: string, name: string, item: TrackerItem | null, out: MaterializedInputs): Promise<BriefInputView> {
  const unit = record.unit;
  const [spec, handoff] = docsOf(unit) as [Doc, Doc];
  switch (name) {
    case "spec": {
      const mirrored = item ? await mirrorSpec(env, unit, item) : await readStoryDoc(env, unit, SPEC_ARTIFACT);
      const text = mirrored.ok ? mirrored.value : null;
      if (text === null) return { name, label: "the story's spec", note: "norn holds no spec for this story yet: the tracker item could not be read" };
      await materializeDoc(env, worktree, spec, text);
      return { name, label: "the story's spec: its tracker item, mirrored, and the sections later steps added", path: spec.file };
    }
    case "handoff": {
      const kept = await readStoryDoc(env, unit, handoff.artifact);
      const text = kept.ok && kept.value !== null ? kept.value : handoffTemplate(unit);
      await materializeDoc(env, worktree, handoff, text);
      out.handoff = handoff.file;
      return { name, label: "this unit's handoff, which you keep current", path: out.handoff };
    }
    case "last_check": {
      const text = await lastCheckText(env, record);
      if (text === null) return { name, label: "the last check's result", note: "no check has run for this unit yet" };
      return written(env, worktree, name, "last_check.md", "the last check's result", text);
    }
    case "last_findings": {
      const r = findingsReceipt(record, brief.rework_from);
      const text = r ? findingsText(r) : null;
      if (text === null) {
        // a file an earlier visit was given would still read as findings to an agent that opens it
        await env.ctx.files.remove(`${worktree}/${INPUTS_DIR}/last_findings.md`);
        return { name, label: "the last findings", note: noFindingsNote(record, brief) };
      }
      return written(env, worktree, name, "last_findings.md", "the last findings sent back", text);
    }
    case "diff":
      return { name, label: "the change so far", note: `run \`git diff ${cutFrom(unit, await baseRefOf(env))}...HEAD\` in this worktree` };
    case "slice":
      return materializeSlice(env, worktree, unit, name);
    case "slices":
      return materializeSlices(env, worktree, unit, name);
    case "record":
      return resolvedInput(env, worktree, name, "the story's record: every unit's outcomes, gate rulings and criteria reports with their evidence", await recordOf(env, record));
    case "resolution":
      return resolvedInput(env, worktree, name, "the resolution to review: each merge's remerge-diff and the conflicts this round recorded", resolutionOf(record));
    case "base_side":
      return resolvedInput(env, worktree, name, "the base side of the conflict: the base commit to merge and what it changed in each conflicting path", await baseSideOf(env, record));
    default: {
      // a kind the host has no rule for: a story document of that name, when one was kept
      const kept = await readStoryDoc(env, unit, `${name}.md`);
      if (kept.ok && kept.value !== null) return written(env, worktree, name, `${name}.md`, `the story's ${name}`, kept.value);
      return { name, note: "norn holds nothing for this input yet" };
    }
  }
}

async function resolvedInput(env: RuntimeEnv, worktree: string, name: string, label: string, got: Resolved): Promise<BriefInputView> {
  if ("note" in got) return { name, label, note: got.note };
  return written(env, worktree, name, `${name}.md`, label, got.text);
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
  const kept = artifact ? await readStoryDoc(env, unit, artifact) : null;
  if (!artifact || !kept?.ok || kept.value === null)
    return { name, label, note: `norn holds no slice file for ${unit}: none named \`${SLICES}/${nn}-<slug>.md\` was written to the story's spec folder` };
  const d = sliceDoc(unit, artifact);
  await materializeDoc(env, worktree, d, kept.value);
  return { name, label, path: d.file };
}

async function materializeSlices(env: RuntimeEnv, worktree: string, unit: string, name: string): Promise<BriefInputView> {
  const label = "every slice file of the story: scope, dependencies, acceptance criteria";
  const folder = `${specFolder(unit)}/${SLICES}/`;
  const artifacts = await sliceDocs(env, unit);
  const units = new Map((await storyUnits(env, unit)).map((u) => [u.unit, u]));
  const story = parseUnitId(unit)?.story ?? unit;
  const lines: string[] = [];
  for (const artifact of artifacts) {
    const kept = await readStoryDoc(env, unit, artifact);
    if (!kept.ok || kept.value === null) continue;
    await materializeDoc(env, worktree, sliceDoc(unit, artifact), kept.value);
    const file = artifact.slice(SLICES.length + 1);
    const nn = /^(\d+)-/.exec(file)?.[1];
    const u = nn ? units.get(`${story}/${nn}`) : undefined;
    lines.push(`- \`${file}\`: ${u ? standing(u) : "not started"}`);
  }
  if (lines.length === 0) return { name, label, path: folder, note: `no slice files yet: the slice step writes them to \`${folder}\`` };
  return { name, label, path: folder, text: `The slice files, each with where its slice stands:\n\n${lines.join("\n")}` };
}
