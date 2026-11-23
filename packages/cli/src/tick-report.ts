/**
 * How a tick reads to a person, shared by `tick` and `watch`: one line per action carried out, the
 * failures and the problems that kept facts from being whole. The JSON is the runtime's report itself.
 */
import type { TickReport } from "@norn/runtime";
import { ruleCaption } from "./captions.ts";

type Outcome = TickReport["outcomes"][number];

/** The unit, else the story a story action names, else the item an intake takes. */
function who(d: Outcome["decision"]): string {
  if (d.unit) return d.unit;
  const loose = d as { story?: unknown; item?: { key?: unknown } };
  if (typeof loose.story === "string") return loose.story;
  return typeof loose.item?.key === "string" ? loose.item.key : "-";
}

/**
 * One action as a line. `captioned` adds the rule's plain-word caption, for `norn tick`'s markdown only:
 * the watch's lines also travel in its JSON, which carries no prose.
 */
export function outcomeLine(o: Outcome, captioned = false): string {
  const caption = captioned ? ruleCaption(o.decision.rule) : undefined;
  const base = `${who(o.decision)}  ${o.decision.rule} → ${o.decision.kind}${caption ? `: ${caption}` : ""}`;
  if (o.ok) return base;
  if (lostRace(o)) return `${base}  lost a race, decided again next tick: ${o.error}`;
  return `${base}  FAILED: ${o.error}${o.retryable ? " (retried next tick)" : ""}`;
}

/**
 * Kinds that only keep a story where it is: decide asks for them again on every tick a unit waits (an
 * agent or check running, a unit parked) or a shared store's story is held.
 */
export const STANDING: ReadonlySet<string> = new Set(["noop", "notify", "flush", "renew_claim"]);

/**
 * Whether the outcome only kept its story where it is: a standing kind, or a launch that waited on its
 * worktree's setup, which decide asks for again every tick the setup runs. A launch whose setup failed
 * wrote the park, so it moved something.
 */
export function standing(o: Outcome): boolean {
  if (!o.ok) return false;
  if (STANDING.has(o.decision.kind)) return true;
  const detail = o.detail as { waiting?: unknown } | undefined;
  return detail?.waiting === "setup";
}

/**
 * A tick in one line for a person watching: its time and each action that moved something or failed,
 * then problems not said on the tick before (`said`); null for a tick of only waiting.
 */
export function watchLine(r: TickReport, time: string, said: ReadonlySet<string>): string | null {
  const acts = r.outcomes.filter((o) => !standing(o)).map((o) => {
    const base = `${who(o.decision)} ${o.decision.rule} → ${o.decision.kind}`;
    return o.ok ? base : `${base} FAILED: ${o.error}`;
  });
  const fresh = r.problems.filter((p) => !said.has(p)).map((p) => `problem: ${p}`);
  const parts = [...(r.skipped ? [`skipped: ${r.skipped}`] : []), ...acts, ...fresh];
  return parts.length === 0 ? null : `${time}  ${parts.join("; ")}`;
}

/** Another writer moved the record after the tick read it: nothing was committed and the next tick decides again. */
export const lostRace = (o: Outcome): boolean => !o.ok && o.retryable && o.error.startsWith("conflict:");

/** A lost race is not a failure: it changed nothing, and the next tick reads the record as it is. */
export const failedCount = (r: TickReport): number => r.outcomes.filter((o) => !o.ok && !lostRace(o)).length;

export function tickLines(r: TickReport, captioned = false): string[] {
  return [...r.outcomes.map((o) => outcomeLine(o, captioned)), ...r.problems.map((p) => `problem: ${p}`)];
}

export function tickMarkdown(r: TickReport): string {
  const lines = tickLines(r, true);
  const head = `# Tick ${r.tick_id}\n\n${r.outcomes.length} action${r.outcomes.length === 1 ? "" : "s"}, ${failedCount(r)} failed`;
  return lines.length === 0 ? `${head}\n\nNothing to do.` : `${head}\n\n${lines.map((l) => `- ${l}`).join("\n")}`;
}
