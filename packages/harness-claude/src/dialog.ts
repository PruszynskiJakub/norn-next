/**
 * Claude Code's choice dialogs (a permission prompt, the folder trust prompt) list numbered options,
 * the first the one that lets the agent go on, and take Esc as the refusal. A number outside the
 * menu does nothing there, so only single digits are offered as keys.
 */
import type { RunnerKey } from "@norn/plugin-api";

const pick = (n: string): RunnerKey[] => [{ text: n }, { key: "enter" }];

export function dialogKeys(answer: string): readonly RunnerKey[] | null {
  const a = answer.trim().toLowerCase();
  if (/^[1-9]$/.test(a)) return pick(a);
  if (a === "yes" || a === "y") return pick("1");
  if (a === "no" || a === "n") return [{ key: "esc" }];
  return null;
}
