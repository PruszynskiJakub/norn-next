/**
 * The id an answer to a dialog in an agent's pane goes under: the permission prompt its session
 * shows, or, while the session has sent no event, the dialog that keeps its hooks from loading (a
 * trust prompt). An unnamed permission's own id repeats for every prompt of the same text, so the
 * call it asks about is part of the id: each prompt is answered once, and a second one is not taken
 * for a replay of the first.
 */
import type { SessionFacts } from "@norn/kernel";

export function dialogInputId(permission: SessionFacts["permission"] | null, runId: string): string {
  if (!permission) return `dialog-${runId}`;
  return permission.call && permission.call.id !== permission.id ? `${permission.id}@${permission.call.id}` : permission.id;
}
