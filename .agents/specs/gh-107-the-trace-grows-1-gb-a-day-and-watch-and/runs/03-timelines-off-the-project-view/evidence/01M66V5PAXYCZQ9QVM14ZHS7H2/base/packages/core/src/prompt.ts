/**
 * R6.2: turning a person's answer into the keystrokes a pane prompt expects. Pure: the options and
 * how they are chosen come from the runner (PanePrompt) via the implicit ask's park.
 *
 * - choice prompt, answer names an option (its number or its label) → the option number + enter,
 *   or arrow keys from the cursor + enter when the menu shows no numbers;
 * - otherwise → the text + enter.
 */
import type { PromptChoice } from "@norn/schema";
import type { PromptKey } from "./ports.ts";

/** Index of the option an answer names (1-based number, exact label, or unique label prefix); null = none. */
export function optionIndex(options: readonly string[], answer: string): number | null {
  const a = answer.trim();
  if (/^\d+$/.test(a)) {
    const n = Number(a);
    return n >= 1 && n <= options.length ? n - 1 : null;
  }
  const lower = a.toLowerCase();
  const exact = options.findIndex((o) => o.toLowerCase() === lower);
  if (exact >= 0) return exact;
  const prefixed = options.flatMap((o, i) => (o.toLowerCase().startsWith(lower) ? [i] : []));
  return prefixed.length === 1 ? (prefixed[0] as number) : null;
}

/** R6.2: the keystrokes that answer a prompt with `answer`; `option` is the chosen index when it named one. */
export function promptKeys(prompt: { options?: readonly string[]; choice?: PromptChoice | null }, answer: string): { keys: PromptKey[]; option: number | null } {
  const options = prompt.options ?? [];
  const i = options.length ? optionIndex(options, answer) : null;
  if (i === null) return { keys: [{ text: answer }, { key: "enter" }], option: null };
  const choice = prompt.choice ?? { numbered: true, cursor: 0 };
  if (choice.numbered) return { keys: [{ text: String(i + 1) }, { key: "enter" }], option: i };
  const delta = i - choice.cursor;
  const arrows: PromptKey[] = Array.from({ length: Math.abs(delta) }, () => ({ key: delta > 0 ? "down" : "up" }) as const);
  return { keys: [...arrows, { key: "enter" }], option: i };
}

/** L1: the options as one line, `1. Yes · 2. No`, for inbox details and refusals. */
export const optionsLine = (options: readonly string[]): string => options.map((o, i) => `${i + 1}. ${o}`).join(" · ");
