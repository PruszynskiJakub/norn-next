/**
 * Claude Code's choice dialogs (a permission prompt, the folder trust prompt) take Esc as the
 * refusal. A numbered menu takes an option's number; a menu with no numbers (the trust prompt since
 * Claude Code 2.1, whose cursor starts on "No, exit") only moves its cursor, so the dialog as the
 * pane shows it says how far to move. A number outside the menu does nothing there, so only single
 * digits are offered as keys.
 */
import type { RunnerKey } from "@norn/plugin-api";

const pick = (n: string): RunnerKey[] => [{ text: n }, { key: "enter" }];

const CURSOR = "❯";
const NUMBERED = /^(\d)\.\s/;

interface Menu {
  options: string[];
  cursor: number;
  numbered: boolean;
}

/** The block of lines holding the cursor, each with the cursor taken off; null when none shows. */
function menuOf(dialog: string): Menu | null {
  const blocks = dialog.split(/\n\s*\n/).map((b) => b.split("\n").map((l) => l.trim()).filter((l) => l !== ""));
  const block = blocks.find((b) => b.some((l) => l.startsWith(CURSOR)));
  if (!block) return null;
  const lines = block.map((l) => (l.startsWith(CURSOR) ? l.slice(CURSOR.length).trim() : l));
  const at = block.findIndex((l) => l.startsWith(CURSOR));
  // a numbered menu may share its block with its question; its options are the numbered lines
  if (NUMBERED.test(lines[at] as string)) return { options: lines.filter((l) => NUMBERED.test(l)), cursor: 0, numbered: true };
  return { options: lines, cursor: at, numbered: false };
}

/** The keys that move a menu's cursor onto option `index` (from 0) and confirm it. */
function moveTo(menu: Menu, index: number): RunnerKey[] {
  const step: RunnerKey = { key: index > menu.cursor ? "down" : "up" };
  return [...Array.from({ length: Math.abs(index - menu.cursor) }, () => step), { key: "enter" }];
}

export function dialogKeys(answer: string, dialog?: string): readonly RunnerKey[] | null {
  const a = answer.trim().toLowerCase();
  if (a === "no" || a === "n") return [{ key: "esc" }];
  const yes = a === "yes" || a === "y";
  if (!yes && !/^[1-9]$/.test(a)) return null;
  const menu = dialog !== undefined ? menuOf(dialog) : null;
  // yes on a pane that was read is placed on what it shows, never guessed: a guess may confirm "No, exit"
  if (!menu) return yes && dialog !== undefined ? null : pick(yes ? "1" : a);
  const label = (o: string) => o.replace(NUMBERED, "").toLowerCase();
  // the option that says yes, not the first: a menu may list its refusal first
  const index = yes ? menu.options.findIndex((o) => label(o).startsWith("yes")) : Number(a) - 1;
  if (index < 0 || index >= menu.options.length) return null;
  return menu.numbered ? pick(String(index + 1)) : moveTo(menu, index);
}
