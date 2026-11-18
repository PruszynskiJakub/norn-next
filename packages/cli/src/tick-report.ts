/**
 * How a tick reads to a person, shared by `tick` and `watch`: one line per action carried out, the
 * failures and the problems that kept facts from being whole. The JSON is the runtime's report itself.
 */
import type { TickReport } from "@norn/runtime";

type Outcome = TickReport["outcomes"][number];

/** The unit, else the story a story action names, else the item an intake takes. */
function who(d: Outcome["decision"]): string {
  if (d.unit) return d.unit;
  const loose = d as { story?: unknown; item?: { key?: unknown } };
  if (typeof loose.story === "string") return loose.story;
  return typeof loose.item?.key === "string" ? loose.item.key : "-";
}

export function outcomeLine(o: Outcome): string {
  const base = `${who(o.decision)}  ${o.decision.rule} → ${o.decision.kind}`;
  return o.ok ? base : `${base}  FAILED: ${o.error}${o.retryable ? " (retried next tick)" : ""}`;
}

export const failedCount = (r: TickReport): number => r.outcomes.filter((o) => !o.ok).length;

export function tickLines(r: TickReport): string[] {
  return [...r.outcomes.map(outcomeLine), ...r.problems.map((p) => `problem: ${p}`)];
}

export function tickMarkdown(r: TickReport): string {
  const lines = tickLines(r);
  const head = `# Tick ${r.tick_id}\n\n${r.outcomes.length} action${r.outcomes.length === 1 ? "" : "s"}, ${failedCount(r)} failed`;
  return lines.length === 0 ? `${head}\n\nNothing to do.` : `${head}\n\n${lines.map((l) => `- ${l}`).join("\n")}`;
}
