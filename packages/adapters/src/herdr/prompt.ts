/**
 * R6.2, L1 (A4, A7): read the prompt an agent is blocked on off its pane screen (`pane read`).
 * Recognizes the choice dialogs of terminal agents (Claude Code permission and trust prompts):
 *
 *   ╌╌╌╌╌╌╌╌╌╌╌╌╌                      ← separator above the dialog
 *    Contains brace with quote …       ← question block
 *    Do you want to proceed?
 *    ❯ 1. Yes                          ← options; `❯` marks the cursor
 *      2. No
 *    Esc to cancel · Tab to amend      ← footer
 *
 * Numbered menus are answered by number, unnumbered ones (`❯ No, exit` / `  Yes, I trust …`) by
 * arrows from the cursor. The pending command is the first line of the `│` box above the dialog,
 * when the box's top is on screen. Null when no dialog is recognized.
 */
import type { PanePrompt } from "@norn/core";

const FOOTER = /(Enter to confirm|Esc to cancel|Tab to amend)/;
const SEPARATOR = /^\s*[─╌━┄┈═-]{8,}\s*$/;
const CURSOR = /^\s*[❯›]\s+(\S.*)$/;
const NUMBERED = /^\s*(?:[❯›]\s+)?(\d+)\.\s+(\S.*)$/;
const INDENTED = /^\s{3,}(\S.*)$/;
const BOX = /^\s*│/;

export function parsePanePrompt(screen: string): PanePrompt | null {
  const lines = screen.split("\n").map((l) => l.replace(/\s+$/, ""));
  const footer = lines.findLastIndex((l) => FOOTER.test(l));
  if (footer < 0) return null;
  let end = footer - 1;
  while (end >= 0 && (lines[end] as string).trim() === "") end--;
  let start = end;
  const optionLine = (l: string) => CURSOR.test(l) || NUMBERED.test(l) || INDENTED.test(l);
  while (start - 1 >= 0 && optionLine(lines[start - 1] as string)) start--;
  if (end < 0 || !optionLine(lines[end] as string)) return null;
  const block = lines.slice(start, end + 1);
  if (!block.some((l) => CURSOR.test(l))) return null;

  const numberedMenu = block.some((l) => NUMBERED.test(l));
  const options: string[] = [];
  let cursor = 0;
  for (const l of block) {
    const num = NUMBERED.exec(l);
    const mark = CURSOR.test(l);
    if (num) {
      if (mark) cursor = options.length;
      options.push((num[2] as string).trim());
    } else if (mark && !numberedMenu) {
      cursor = options.length;
      options.push((CURSOR.exec(l)?.[1] as string).trim());
    } else if (numberedMenu && options.length) {
      // a wrapped option label continues the previous one
      options[options.length - 1] = `${options[options.length - 1]} ${l.trim()}`;
    } else options.push(l.trim());
  }
  if (!options.length) return null;

  const sep = lines.slice(0, start).findLastIndex((l) => SEPARATOR.test(l));
  const question = lines
    .slice(sep + 1, start)
    .map((l) => l.trim())
    .filter((l) => l !== "" && !BOX.test(l))
    .join(" ");
  const prompt: PanePrompt = { question: question || "the agent waits for a choice", options, choice: { numbered: numberedMenu, cursor } };
  if (sep > 0) {
    // the `│` box right above the separator holds the pending command; only a box whose top is on screen
    let top = sep - 1;
    while (top - 1 >= 0 && BOX.test(lines[top - 1] as string)) top--;
    if (BOX.test(lines[sep - 1] as string) && top > 0) {
      const first = (lines[top] as string).replace(BOX, "").trim();
      if (first) prompt.command = first;
    }
  }
  return prompt;
}
