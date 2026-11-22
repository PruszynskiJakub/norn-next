/**
 * Making a step's inputs readable. The kernel's brief names its inputs by kind (`spec`, `handoff`,
 * `last_check`, ...); before a launch, and whenever `norn brief` renders, the host writes each one it
 * holds as a file under `.agents/` inside the unit's worktree and the brief lists the paths, short
 * ones inline. The story's documents go to its spec folder, `.agents/specs/<story>/` (`spec.md`,
 * `handoffs/<unit>.md`), the layout a repo keeping specs in `.agents` uses; every other input goes to
 * the run folder's `in/` (`.agents/run/in/`, `$NORN_IN`), and the run writes its reports to its
 * `out/` (`$NORN_OUT`), which every launch empties. Each folder norn writes holds a `.gitignore` of
 * `*`, so nothing the agent reads or reports is ever committed, whether or not the repo commits the
 * rest of `.agents/`.
 *
 * The spec, the handoff, the slice files (`slices/<nn>-<slug>.md`) and the files the workflow's steps
 * produce (`produces:`, such as `pr.md`) are documents the agent edits there: what it changed is read
 * back into the story's documents when it reports (and before the next materialization), so the next
 * step reads it, a slice in its own worktree included.
 * A copy of what norn last wrote sits in `.agents/run/.base/`, and only a file that differs from it
 * is read back, so a worktree that kept a stale, untouched copy never overwrites a newer document.
 */
import { type BriefInputs, type BriefInputView, type BriefStory, type KernelReceipt, producedFiles, type SourceDoc, type UnitJournal, type WorkflowStepDoc } from "@norn/kernel";
import { type HostFiles, ok, type PluginResult, parseStoryKey, parseUnitId, RUN_DIRS_ENV, type TrackerItem } from "@norn/plugin-api";
import type { CriterionVerdict, Finding } from "@norn/schema";
import { baseRefOf, cutFrom } from "./branches.ts";
import type { RuntimeEnv } from "./env.ts";
import { mirrorItem, SPEC_ARTIFACT } from "./spec-mirror.ts";
import { readStepRun } from "./step-runs.ts";
import { AWAIT_CHECKS, checksText } from "./steps-forge/await-checks.ts";
import { baseSideOf, recordOf, type Resolved, resolutionOf, roundOf, standing, storyUnits } from "./input-history.ts";
import { HANDOFFS_DIR, handoffArtifact, listStoryDocs, readStoryDoc, writeStoryDoc } from "./story-docs.ts";

const AGENTS_DIR = ".agents";
/** the folder of each story's documents in a worktree: `.agents/specs/<story>/` */
export const SPECS_DIR = `${AGENTS_DIR}/specs`;
/** the folder of what belongs to one run: its inputs, its reports and norn's copies of the documents */
export const RUN_DIR = `${AGENTS_DIR}/run`;
/** the folder of the inputs rewritten for every run */
export const INPUTS_DIR = `${RUN_DIR}/in`;
/** the folder a run writes its reports to, emptied at every launch */
export const OUT_DIR = `${RUN_DIR}/out`;
/** The evidence files a report re-encoded, norn's own beside `out/`, so the agent's files stay as written. */
export const EVIDENCE_COPIES_DIR = `${RUN_DIR}/evidence`;
const BASE_DIR = `${RUN_DIR}/.base`;
/** where a worktree made before the run folder keeps its copies; read so its untouched documents still read as untouched */
const LEGACY_BASE_DIR = `${AGENTS_DIR}/inputs/.base`;
const IGNORE_ALL = "*\n";
const IGNORE_FILE = ".gitignore";
/** Text up to this long is shown in the brief itself as well as written to its file. */
const INLINE_MAX = 1500;

export const INPUTS_NOTE = `norn's files in this worktree are under \`${AGENTS_DIR}/\` and ignored by git: the story's spec and this unit's handoff in \`${SPECS_DIR}/<story>/\`, the other inputs in \`${INPUTS_DIR}/\` (\`$${RUN_DIRS_ENV.in}\`). Edit the handoff, and add your sections to the spec below its item block; norn reads both back when you report, and the slice files in its \`slices/\` folder too. The other inputs are rewritten for every run.`;

/** The run folder's `in/` and `out/` in a worktree, as every launch sets them in the agent's env. */
export function runDirsEnv(worktree: string): Record<string, string> {
  return { [RUN_DIRS_ENV.in]: `${worktree}/${INPUTS_DIR}`, [RUN_DIRS_ENV.out]: `${worktree}/${OUT_DIR}` };
}

/**
 * Empty the run folder's `out/` before a launch: a report belongs to the run that wrote it, and one an
 * earlier run left (it died before it reported) would otherwise be collected as this run's.
 */
export async function clearOut(files: HostFiles, worktree: string): Promise<void> {
  // run/ and out/ are norn's own: one made a link is removed as itself, since emptying through it
  // would delete the files it points at, outside the worktree too
  for (const dir of [RUN_DIR, OUT_DIR]) {
    const path = `${worktree}/${dir}`;
    if (files.readLink && (await files.readLink(path)) !== null) await files.remove(path);
  }
  await emptyFolder(files, `${worktree}/${OUT_DIR}`);
  await emptyFolder(files, `${worktree}/${EVIDENCE_COPIES_DIR}`);
  await makeOut(files, worktree);
}

/**
 * Make sure `out/` exists: the host makes a folder only for a file in it, and an agent writing a
 * report through the shell (`> $NORN_OUT/criteria.json`) gets no folder made for it.
 */
async function makeOut(files: HostFiles, worktree: string): Promise<void> {
  await files.write(`${worktree}/${OUT_DIR}/${IGNORE_FILE}`, IGNORE_ALL);
}

async function emptyFolder(files: HostFiles, dir: string): Promise<void> {
  for (const name of await files.list(dir)) {
    const path = `${dir}/${name}`;
    // a link is removed as itself: listing it would walk into its target, and empty a folder outside out/
    const link = files.readLink ? await files.readLink(path) : null;
    if (link !== null) {
      await files.remove(path);
      continue;
    }
    let inner: string[];
    try {
      inner = await files.list(path);
    } catch {
      // listing a file fails: it has nothing inside
      inner = [];
    }
    if (inner.length > 0) await emptyFolder(files, path);
    try {
      await files.remove(path);
    } catch {
      // a folder is not removed as a file; left empty, it holds no report
    }
  }
}

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
  legacyBase: string;
}

/** The story's spec folder in a worktree; `unit` may be a slice, whose story's folder it shares. */
export function specFolder(unit: string): string {
  const story = parseUnitId(unit)?.story;
  if (!story) throw new RangeError(`not a unit id: ${JSON.stringify(unit)}`);
  return `${SPECS_DIR}/${story}`;
}

function doc(name: string, unit: string, artifact: string): Doc {
  const file = `${specFolder(unit)}/${artifact}`;
  const rel = file.slice(AGENTS_DIR.length + 1);
  return { name, artifact, file, base: `${BASE_DIR}/${rel}`, legacyBase: `${LEGACY_BASE_DIR}/${rel}` };
}
const docsOf = (unit: string): Doc[] => [doc("spec", unit, SPEC_ARTIFACT), doc("handoff", unit, handoffArtifact(unit))];

/** The story's slice files are documents too: the slice step writes them here, and each slice reads its own. */
const SLICES = "slices";

/**
 * What norn writes in a story's spec folder itself, a folder ending in `/`: the loader refuses a
 * `produces:` file among them, as norn would overwrite it, or read it back as its own document.
 */
export const SPEC_FOLDER_FILES = [IGNORE_FILE, SPEC_ARTIFACT, `${HANDOFFS_DIR}/`, `${SLICES}/`] as const;
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
 * The step of a unit's pinned workflow that produces `name` and its file, relative to the story's
 * spec folder: an agent step's `produces:`, or the products the step kind it runs declares, which
 * follow the same path rule. Null when no step produces it.
 */
export function producerOf(env: RuntimeEnv, steps: Readonly<Record<string, WorkflowStepDoc>>, name: string): { step: string; file: string } | null {
  for (const [step, s] of Object.entries(steps)) {
    const own = s.produces?.[name]?.file;
    if (own !== undefined) return { step, file: own };
    const product = kindProducts(env, s).find((p) => p.name === name);
    if (product) return { step, file: product.file };
  }
  return null;
}

const kindProducts = (env: RuntimeEnv, step: WorkflowStepDoc) => Object.keys(step).flatMap((k) => (Object.hasOwn(env.slots.stepKinds, k) ? (env.slots.stepKinds[k]?.produces ?? []) : []));

/** Every file the steps of a unit's pinned workflow produce, step kinds' included, relative to the story's spec folder. */
export function producedOf(env: RuntimeEnv, record: UnitJournal): string[] {
  const steps = record.state?.workflow.doc.steps ?? {};
  return [...new Set([...producedFiles(steps), ...Object.values(steps).flatMap((s) => kindProducts(env, s).map((p) => p.file))])];
}

/**
 * Read the unit's edited documents in its worktree back into the story's documents: each one that
 * differs from what norn last wrote there, the `produced` files (relative to the spec folder) among
 * them. Answers the names read back; a document that cannot be read back is left as it is, never half
 * written.
 */
export async function readBackDocs(env: RuntimeEnv, unit: string, worktree = worktreeOf(env, unit), produced: readonly string[] = []): Promise<string[]> {
  const back: string[] = [];
  const own = [...docsOf(unit), ...(await sliceDocsIn(env, unit, worktree))];
  const made = produced.filter((f) => !own.some((d) => d.artifact === f)).map((f) => doc(f, unit, f));
  for (const d of [...own, ...made]) {
    const text = await readFile(env, `${worktree}/${d.file}`);
    if (text === null) continue;
    const base = (await readFile(env, `${worktree}/${d.base}`)) ?? (await readFile(env, `${worktree}/${d.legacyBase}`));
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
    return r && !isCheck(r) ? r : undefined;
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
  if (d.kind !== "run.reported" || d.verb !== "done" || (d.text === undefined && d.criteria === undefined && d.findings === undefined)) return false;
  return handsBackFindings(record, d.step, d.outcome);
}

/** Whether `later` judged the work clean after `found`: a gate decided `approve`, or the step that sent the findings reported an outcome that hands none back. */
function settles(record: UnitJournal, found: KernelReceipt, later: KernelReceipt): boolean {
  const d = later.data;
  if (d.kind === "gate.decided") return d.outcome === "approve" || (d.step === found.data.step && d.outcome !== "reject");
  return d.kind === "run.reported" && d.verb === "done" && d.step === found.data.step && !handsBackFindings(record, d.step, d.outcome);
}

/** A check's receipt: a check step's, or the change's checks settling, which `last_check` reads alike. */
const isCheck = (r: KernelReceipt): boolean => r.data.kind === "check.finished" || (r.data.kind === "step.finished" && r.data.step_kind === AWAIT_CHECKS);

function noFindingsNote(record: UnitJournal, brief: BriefInputs): string {
  const by = brief.rework_from !== undefined ? record.receipts.find((x) => x.seq === brief.rework_from) : undefined;
  if (!by || !isCheck(by)) return "no findings sent this work back";
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

function findingLine(f: Finding, severity: boolean): string {
  const where = [f.file !== undefined ? `${f.file}${f.line !== undefined ? `:${f.line}` : ""}` : undefined, f.criterion].filter((x) => x !== undefined);
  const head = `- ${f.id !== undefined ? `\`${f.id}\` ` : ""}${severity ? `${f.severity}: ` : ""}${f.title}${where.length > 0 ? ` (${where.join(", ")})` : ""}`;
  const more = [f.detail, f.repro !== undefined ? `Repro: ${f.repro}` : undefined].filter((x): x is string => x !== undefined && x.trim() !== "");
  return [head, ...more.map((m) => `  ${m.trim().replaceAll("\n", "\n  ")}`)].join("\n");
}

/**
 * A report's findings, the ones that send the work back (blocking, major) first: a minor or nit
 * finding is a note for the person, and listing it among the rework would have it fixed in a round
 * nobody asked for.
 */
export function findingsList(findings: readonly Finding[] | undefined): string {
  const all = findings ?? [];
  const rework = all.filter((f) => f.severity === "blocking" || f.severity === "major");
  const other = all.filter((f) => f.severity !== "blocking" && f.severity !== "major");
  const out: string[] = [];
  if (rework.length > 0) out.push(`\n\nBlocking findings:\n\n${rework.map((f) => findingLine(f, f.severity !== "blocking")).join("\n")}`);
  if (other.length > 0) out.push(`\n\nOther findings, notes for the person rather than rework:\n\n${other.map((f) => findingLine(f, true)).join("\n")}`);
  return out.join("");
}

function findingsText(r: KernelReceipt): string | null {
  const d = r.data;
  if (d.kind === "gate.decided") return `\`${d.step ?? "the gate"}\` was decided \`${d.outcome}\` by ${d.by}${d.reason ? `:\n\n${d.reason}` : "."}`;
  if (d.kind === "run.reported")
    return `\`${d.step ?? "a step"}\` reported \`${d.verb}${d.outcome ? ` ${d.outcome}` : ""}\`${d.text ? `:\n\n${d.text}` : "."}${findingsList(d.findings)}${unsettledCriteria(d.criteria)}`;
  return null;
}

async function lastCheckText(env: RuntimeEnv, record: UnitJournal): Promise<string | null> {
  const r = record.receipts.findLast(isCheck);
  if (r?.data.kind === "step.finished") return checksText(r.data.step ?? r.data.step_kind, r.data.outcome, r.data.detail) ?? `Check \`${r.data.step ?? r.data.step_kind}\` ended \`${r.data.outcome}\`.`;
  if (!r || r.data.kind !== "check.finished") return null;
  const d = r.data;
  const head = `Check \`${d.step ?? "check"}\` exited ${d.exit} (\`${d.outcome}\`).`;
  const run = await readStepRun(env.ctx, record.unit);
  const tail = run && run.run_id === d.run_id ? run.output?.trimEnd() : undefined;
  return tail ? `${head}\n\nThe end of its output:\n\n${tail}` : head;
}

/** The input a signal's firing reaches the next agent step as. */
const SIGNAL_INPUT = "signal";
const SIGNAL_LABEL = "the signal that moved the story from where it waited, with what its source reported";

type SignalFinished = KernelReceipt & { data: Extract<KernelReceipt["data"], { kind: "step.finished" }> & { signal: NonNullable<Extract<KernelReceipt["data"], { kind: "step.finished" }>["signal"]> } };

/**
 * The receipt of the last signal that fired this round, while no agent step has run since but the
 * visit now starting: only the agent step right after the signal reads it, as a later one works from
 * what that step made of it.
 */
function signalReceipt(record: UnitJournal): SignalFinished | undefined {
  const round = roundOf(record);
  const at = round.findLastIndex((r) => r.data.kind === "step.finished" && r.data.signal !== undefined);
  const fired = round[at] as SignalFinished | undefined;
  if (!fired) return undefined;
  const now = record.state;
  const since = round.slice(at + 1).some((r) => r.data.kind === "run.started" && r.data.run_kind === "agent" && (r.data.step !== now?.step || r.data.attempt !== now?.attempt));
  return since ? undefined : fired;
}

function signalText(r: SignalFinished): string {
  const { signal, detail } = r.data;
  const head = `\`${r.data.step ?? "the step"}\` was moved by the signal \`${signal.type}\`, reported by ${signal.source} for occurrence \`${signal.id}\`.`;
  return detail === undefined ? head : `${head}\n\nWhat the source reported:\n\n\`\`\`json\n${JSON.stringify(detail, null, 2)}\n\`\`\``;
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
    await env.ctx.files.write(`${worktree}/${RUN_DIR}/${IGNORE_FILE}`, IGNORE_ALL);
    await env.ctx.files.write(`${worktree}/${specFolder(unit)}/${IGNORE_FILE}`, IGNORE_ALL);
    await makeOut(env.ctx.files, worktree);
    await readBackDocs(env, unit, worktree, producedOf(env, record));
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
    // every agent step keeps the unit's handoff current, so a workflow never has to list it
    if (!brief.inputs.includes("handoff")) out.inputs.push(await materializeOne(env, record, brief, worktree, "handoff", item, out));
    // a signal's detail reaches the agent step after it whether or not the step lists it: the workflow
    // author routes the signal, and cannot know which source's evidence the next step will need
    if (!brief.inputs.includes(SIGNAL_INPUT)) {
      const fired = signalReceipt(record);
      if (fired?.data.detail !== undefined) out.inputs.push(await written(env, worktree, SIGNAL_INPUT, `${SIGNAL_INPUT}.md`, SIGNAL_LABEL, signalText(fired)));
      else await env.ctx.files.remove(`${worktree}/${INPUTS_DIR}/${SIGNAL_INPUT}.md`);
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

/**
 * Every input name a step may list, each served by its case in `materializeOne`: the workflow loader
 * refuses a file naming any other, so a misspelt name fails at load instead of reaching the agent as
 * an empty input. Adding an input means adding its name here and its case below; the switch is
 * checked against this list.
 */
export const HOST_INPUTS = ["spec", "handoff", "last_check", "last_findings", SIGNAL_INPUT, "diff", "slice", "slices", "record", "resolution", "base_side"] as const;
type HostInput = (typeof HOST_INPUTS)[number];
const isHostInput = (name: string): name is HostInput => (HOST_INPUTS as readonly string[]).includes(name);

async function materializeOne(env: RuntimeEnv, record: UnitJournal, brief: BriefInputs, worktree: string, read: string, item: TrackerItem | null, out: MaterializedInputs): Promise<BriefInputView> {
  const unit = record.unit;
  const [spec, handoff] = docsOf(unit) as [Doc, Doc];
  // the optional mark only says the step may run without it; what it names is read the same way
  const name = read.endsWith("?") ? read.slice(0, -1) : read;
  if (!isHostInput(name)) {
    const doc = record.state?.workflow.doc;
    const source = doc?.sources?.[name];
    if (source) return sourceView(env, name, source);
    const producer = producerOf(env, doc?.steps ?? {}, name);
    if (producer) return materializeProduced(env, worktree, unit, name, producer.step, producer.file);
    // a pinned revision is loaded without the input check, so it may still name one: noted, never failed
    return { name, note: "norn provides no input of this name" };
  }
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
    case SIGNAL_INPUT: {
      const fired = signalReceipt(record);
      if (!fired) {
        await env.ctx.files.remove(`${worktree}/${INPUTS_DIR}/${SIGNAL_INPUT}.md`);
        return { name, label: SIGNAL_LABEL, note: "no signal moved the story since its last agent step" };
      }
      return written(env, worktree, name, `${SIGNAL_INPUT}.md`, SIGNAL_LABEL, signalText(fired));
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
  }
}

/**
 * A workflow source, where this machine's config binds it, else at the workflow's path, which is
 * relative to the repo and so to the worktree. norn copies nothing: the agent reads it in place.
 */
function sourceView(env: RuntimeEnv, name: string, source: SourceDoc): BriefInputView {
  const label = `the source \`${name}\` (a ${source.type}), read-only`;
  const path = env.config.kernel.sources?.[name] ?? source.path;
  return path === undefined ? { name, label, note: "nothing binds it on this machine, and the step reads it only when bound" } : { name, label, path };
}

/** A file an earlier step produced, from the story's documents, so a step in another worktree reads it too. */
async function materializeProduced(env: RuntimeEnv, worktree: string, unit: string, name: string, step: string, file: string): Promise<BriefInputView> {
  const label = `produced by step ${step}`;
  const d = doc(name, unit, file);
  const kept = await readStoryDoc(env, unit, d.artifact);
  if (!kept.ok || kept.value === null) return { name, label, note: `norn holds no \`${d.artifact}\` for this story yet: step ${step} has not produced it` };
  await materializeDoc(env, worktree, d, kept.value);
  return { name, label, path: d.file };
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
