/**
 * The inputs read off the story's record rather than its documents: `record` (what every unit of the
 * story reported, its criteria reports with their evidence), `resolution` (the merges a resolver
 * finished, to review against git's own merge) and `base_side` (what the base changed in each path a
 * base update conflicted in). The vcs slot answers no log, so where the agent needs commits the text
 * names the exact git command over the commits the receipts recorded, as `diff` does.
 */
import type { KernelReceipt, RunState, UnitJournal } from "@norn/kernel";
import { parseUnitId } from "@norn/plugin-api";
import { type CriterionVerdict, check } from "@norn/schema";
import { Type } from "@sinclair/typebox";
import { branchOf } from "./branches.ts";
import type { RuntimeEnv } from "./env.ts";

/** What an input resolves to: the text to write as its file, or why there is none yet. */
export type Resolved = { text: string } | { note: string };

const UPDATE_KIND = "update-branch";
const BaseRef = Type.Object({ ref: Type.String({ minLength: 1 }), sha: Type.String({ minLength: 1 }) });
const UpdateConflict = Type.Object({ base: BaseRef, conflicts: Type.Array(Type.String({ minLength: 1 })) });
const UpdateMerged = Type.Object({ base: BaseRef, head: Type.String({ minLength: 1 }), anchor: Type.Optional(Type.String({ minLength: 1 })) });

const short = (sha: string): string => sha.slice(0, 12);
const code = (s: string): string => `\`${s}\``;
const quoted = (path: string): string => `'${path.replaceAll("'", "'\\''")}'`;

/** The receipts of the unit's current round: those after its last `round.started`. */
export function roundOf(record: UnitJournal): KernelReceipt[] {
  const start = record.receipts.findLastIndex((r) => r.data.kind === "round.started");
  return record.receipts.slice(start + 1);
}

type UpdateFinished = KernelReceipt & { data: { kind: "step.finished" } };
const isUpdate = (r: KernelReceipt): r is UpdateFinished => r.data.kind === "step.finished" && r.data.step_kind === UPDATE_KIND;

function conflictOf(r: UpdateFinished) {
  if (r.data.outcome !== "conflict") return null;
  const v = check(UpdateConflict, r.data.detail);
  return v.ok ? v.value : null;
}

function conflictLine(r: UpdateFinished): string {
  const c = conflictOf(r);
  const step = code(r.data.step ?? UPDATE_KIND);
  if (!c) return `- ${step} ended \`conflict\` (${r.at}); its receipt names no base commit or paths`;
  return `- ${step} could not merge ${code(c.base.ref)} at ${code(short(c.base.sha))} (${r.at}): ${c.conflicts.map(code).join(", ") || "no paths named"}`;
}

/**
 * The base side of the conflict that sent the unit here: the latest base update's receipt, when it
 * ended `conflict`. The update aborted its merge, so the resolver merges the named commit itself.
 */
export async function baseSideOf(env: RuntimeEnv, record: UnitJournal): Promise<Resolved> {
  const last = record.receipts.findLast(isUpdate);
  if (!last) return { note: "no base update has run for this unit yet, so no base conflict sent it here" };
  if (last.data.outcome !== "conflict") return { note: `no base conflict sent this unit here: the last base update (${code(last.data.step ?? UPDATE_KIND)}, receipt ${last.seq}) ended ${code(last.data.outcome)}` };
  const c = conflictOf(last);
  if (!c) return { note: `the last base update (receipt ${last.seq}) ended \`conflict\` without naming the base commit and paths; run it again to have them recorded` };
  const mb = await env.slots.vcs.mergeBase(branchOf(record.unit), c.base.sha).catch(() => null);
  const from = mb?.ok && mb.value ? mb.value : `$(git merge-base HEAD ${c.base.sha})`;
  const lines = [
    `The base update at ${code(last.data.step ?? UPDATE_KIND)} could not merge ${code(c.base.ref)} at ${code(c.base.sha)} into the story branch ${code(branchOf(record.unit))}: it conflicts in ${c.conflicts.length} path${c.conflicts.length === 1 ? "" : "s"}.`,
    `norn aborted that merge, so the worktree starts clean: merge the commit yourself (\`git merge ${c.base.sha}\`), resolve, and commit the merge.`,
    "",
    "The base side of each conflicting path, what the base changed there since the story branch left it:",
    "",
    ...c.conflicts.map((p) => `- ${code(p)}: the commits \`git log --format='%h %an %s' ${from}..${c.base.sha} -- ${quoted(p)}\`, the change \`git diff ${from} ${c.base.sha} -- ${quoted(p)}\``),
  ];
  const earlier = roundOf(record).filter((r) => isUpdate(r) && r.seq !== last.seq && r.data.outcome === "conflict") as UpdateFinished[];
  if (earlier.length > 0) lines.push("", "Earlier base conflicts this round:", "", ...earlier.map(conflictLine));
  return { text: lines.join("\n") };
}

/**
 * The resolution to review: the merges on the story branch since the change request last took it, as
 * the latest base update that ended `resolved` measured them, with the conflicts this round recorded.
 */
export function resolutionOf(record: UnitJournal): Resolved {
  const last = record.receipts.findLast((r) => isUpdate(r) && r.data.outcome === "resolved") as UpdateFinished | undefined;
  if (!last) return { note: "no base update of this unit has ended `resolved` yet, so there is no resolution to review" };
  const v = check(UpdateMerged, last.data.detail);
  if (!v.ok || v.value.anchor === undefined) return { note: `the base update that ended \`resolved\` (receipt ${last.seq}) recorded no anchor to measure the merges from; run it again to have it recorded` };
  const { base, head, anchor } = v.value;
  const lines = [
    `The base update at ${code(last.data.step ?? UPDATE_KIND)} (${last.at}) took ${code(base.ref)} at ${code(short(base.sha))} and ended \`resolved\`: since the change request last took the branch (${code(short(anchor))}), the story holds only base merges, and a resolver finished at least one of them.`,
    "",
    "Each merge's remerge-diff is where it differs from git's own merge of its parents, a base change the resolver dropped included. Read them all, newest first:",
    "",
    `    git log --first-parent --merges --remerge-diff --format='%H %s' ${anchor}..${head}`,
  ];
  const conflicts = roundOf(record).filter((r) => isUpdate(r) && r.data.outcome === "conflict") as UpdateFinished[];
  if (conflicts.length > 0) lines.push("", "The base conflicts this round recorded, oldest first:", "", ...conflicts.map(conflictLine));
  return { text: lines.join("\n") };
}

/** Every unit of the unit's story, its own first and then its slices by number; a unit that cannot be read is left out. */
export async function storyUnits(env: RuntimeEnv, unit: string): Promise<UnitJournal[]> {
  const story = parseUnitId(unit)?.story;
  if (!story) return [];
  const listed = await env.slots.store.listUnits({ story });
  const ids = listed.ok ? listed.value : [];
  const ordered = [...ids].sort((a, b) => (a === story ? -1 : b === story ? 1 : a.localeCompare(b)));
  const out: UnitJournal[] = [];
  for (const id of ordered) {
    const read = await env.journal.readUnit(id);
    if (read.ok) out.push(read.value);
  }
  return out;
}

/** Where a unit stands, in a few words. */
export function standing(record: UnitJournal): string {
  if (record.corrupt !== undefined) return `corrupt: ${record.corrupt}`;
  const s: RunState | null = record.state;
  if (!s) return "not started";
  if (s.ended) return `ended ${code(s.ended)} at ${code(s.step)}${s.ended_reason ? ` (${s.ended_reason})` : ""}`;
  if (s.parked) return `waits at ${code(s.step)} #${s.attempt}: ${s.parked.reason}`;
  return `at ${code(s.step)} #${s.attempt}`;
}

const oneLine = (text: string, max = 300): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/** How receipt `r` ended a step, in one line; `said` adds what the report or ruling said. */
function eventLine(r: KernelReceipt, said: boolean): string | null {
  const d = r.data;
  const at = `${d.step ?? "?"}${d.attempt !== undefined ? ` #${d.attempt}` : ""}`;
  const text = (t: string | undefined) => (said && t ? `: ${oneLine(t)}` : "");
  switch (d.kind) {
    case "run.reported":
      if (d.verb === "ask") return null;
      return `${code(at)} reported \`${d.verb}${d.outcome ? ` ${d.outcome}` : ""}\`${text(d.text)}${said && d.criteria ? " (criteria report below)" : ""}`;
    case "check.finished":
      return `${code(at)} check exited ${d.exit} (\`${d.outcome}\`)`;
    case "gate.decided":
      return `${code(at)} decided \`${d.outcome}\` by ${d.by}${d.delegated ? " (delegated)" : ""}${text(d.reason)}`;
    case "step.finished":
      return `${code(at)} ${d.step_kind} ended \`${d.outcome}\``;
    case "run.classified":
      return `${code(at)} run judged \`${d.outcome}\``;
    case "step.moved":
      return `moved to ${code(d.to)} by ${d.by}${text(d.reason)}`;
    case "unit.marked":
      return `marked \`${d.ended}\`${text(d.reason)}`;
    default:
      return null;
  }
}

function recordLine(r: KernelReceipt): string | null {
  const line = eventLine(r, true);
  return line === null ? null : `- ${line}`;
}

const HISTORY_MAX = 20;

/**
 * What the unit's steps did this round, oldest first, without what they said: the outcomes that
 * route the work, so an agent sees where its step sits. The newest lines win when it runs long.
 */
export function historyOf(record: UnitJournal): string[] {
  const lines = roundOf(record)
    .map((r) => eventLine(r, false))
    .filter((l): l is string => l !== null);
  if (lines.length <= HISTORY_MAX) return lines;
  return [`… ${lines.length - HISTORY_MAX + 1} earlier`, ...lines.slice(-(HISTORY_MAX - 1))];
}

const RULINGS_MAX = 10;

/**
 * The gate rulings with a reason on the story's units, every round, newest kept when they run long: a
 * reason is what settles a question. `except` is the receipt the brief already shows under Rework.
 */
export async function rulingsOf(env: RuntimeEnv, record: UnitJournal, except?: number): Promise<string[]> {
  const found: { at: string; line: string }[] = [];
  for (const u of await storyUnits(env, record.unit)) {
    for (const r of u.receipts) {
      const d = r.data;
      if (d.kind !== "gate.decided" || !d.reason?.trim()) continue;
      if (u.unit === record.unit && r.seq === except) continue;
      found.push({ at: r.at, line: `${code(u.unit)} ${code(`${d.step ?? "?"}${d.attempt !== undefined ? ` #${d.attempt}` : ""}`)} decided \`${d.outcome}\` by ${d.by}${d.delegated ? " (delegated)" : ""}: ${d.reason.trim()}` });
    }
  }
  const lines = found.sort((a, b) => a.at.localeCompare(b.at)).map((f) => f.line);
  if (lines.length <= RULINGS_MAX) return lines;
  return [`… ${lines.length - RULINGS_MAX} earlier, in the story's record`, ...lines.slice(-RULINGS_MAX)];
}

function verdictLine(c: CriterionVerdict): string {
  const said = c.verdict === "pass" ? `evidence: ${c.evidence}` : c.verdict === "fail" ? `repro: ${c.repro}` : c.verdict === "person" ? `how to check: ${c.how}` : `${c.reason}; how to check: ${c.how}`;
  return `- ${code(c.id)} ${c.verdict}; ${said}`;
}

/** The latest criteria report of each step of the unit, in full: what the PR's evidence cites. */
function criteriaReports(record: UnitJournal): string[] {
  const latest = new Map<string, KernelReceipt>();
  for (const r of record.receipts) if (r.data.kind === "run.reported" && r.data.criteria) latest.set(r.data.step ?? "?", r);
  const out: string[] = [];
  for (const r of latest.values()) {
    if (r.data.kind !== "run.reported" || !r.data.criteria) continue;
    out.push("", `Criteria report of ${code(`${r.data.step ?? "?"} #${r.data.attempt ?? "?"}`)} (${r.at}), outcome \`${r.data.outcome ?? "?"}\`:`, "", ...r.data.criteria.map(verdictLine));
  }
  return out;
}

/** The story's record: each unit's outcomes, gate rulings and criteria reports with their evidence. */
export async function recordOf(env: RuntimeEnv, record: UnitJournal): Promise<Resolved> {
  const story = parseUnitId(record.unit)?.story ?? record.unit;
  const units = await storyUnits(env, record.unit);
  if (units.length === 0) return { note: `norn holds no record for ${story} yet` };
  const lines = [
    `The record of ${code(story)}: what each of its units reported, every check and gate ruling, and the criteria reports with the evidence each verdict cites. The record is the story's receipts, kept with its run data and not in the repo; this file is its summary. norn keeps no evidence files of its own, so evidence is what the reports wrote.`,
  ];
  for (const u of units) {
    lines.push("", `## ${code(u.unit)}${u.unit === story ? " (the story)" : ""}: ${standing(u)}`, "");
    const events = u.receipts.map(recordLine).filter((l): l is string => l !== null);
    lines.push(...(events.length > 0 ? events : ["- nothing reported yet"]), ...criteriaReports(u));
  }
  return { text: lines.join("\n") };
}
