/**
 * The notes for a person that agents' reports left open: what `story view` and `status` list beside a
 * gate, so the person reads them before approving. A gate's `approve` acknowledges every note
 * reported before it; a note never blocks and never changes the route.
 */
import type { KernelReceipt } from "@norn/kernel";
import type { RuntimeEnv } from "@norn/runtime";
import { failure } from "./output.ts";
import type { StoryView } from "./views.ts";

export interface OpenNote {
  unit: string;
  step: string | null;
  attempt: number | null;
  at: string;
  text: string;
  /** the acceptance criterion the note is about */
  criterion?: string;
}

/** The notes reported on `receipts` since the unit's last approve, oldest first; a report the journal rejected never stood. */
export function openNotesOf(unit: string, receipts: readonly KernelReceipt[]): OpenNote[] {
  const rejected = new Set(receipts.flatMap((r) => (r.data.kind === "receipt.rejected" ? [r.data.seq] : [])));
  const since = receipts.findLastIndex((r) => r.data.kind === "gate.decided" && r.data.outcome === "approve");
  return receipts.slice(since + 1).flatMap((r) => {
    const d = r.data;
    if (d.kind !== "run.reported" || rejected.has(r.seq)) return [];
    return (d.notes ?? []).map((n) => ({ unit, step: d.step ?? null, attempt: d.attempt ?? null, at: r.at, text: n.text, ...(n.criterion !== undefined && { criterion: n.criterion }) }));
  });
}

/** The open notes of every unit of the story that waits at a gate. */
export async function gateNotes(env: RuntimeEnv, story: StoryView): Promise<OpenNote[]> {
  const out: OpenNote[] = [];
  for (const u of story.units) {
    if (u.waiting?.for !== "gate") continue;
    const read = await env.journal.readUnit(u.id);
    if (!read.ok) throw failure(`cannot read ${u.id}: ${read.failure.message}`, "try again", read.failure.code);
    out.push(...openNotesOf(u.id, read.value.receipts));
  }
  return out;
}

export function noteLine(n: OpenNote): string {
  const from = `${n.step ?? "a step"}${n.attempt ? ` #${n.attempt}` : ""}`;
  return `- ${n.unit}, from ${from}: ${n.criterion !== undefined ? `\`${n.criterion}\` ` : ""}${n.text.trim().replaceAll("\n", "\n  ")}`;
}
