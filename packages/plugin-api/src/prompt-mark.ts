/**
 * Telling norn's prompts from a person's, per prompt (plugin API 1.5).
 *
 * An environment variable set at launch marks the whole process, so every prompt a person later
 * types in the pane would read as norn's. Instead every prompt norn sends (the brief, a nudge, an
 * answer) ends with one mark line naming its source and an id the host minted and recorded before
 * sending. The mark travels inside the prompt text, so it reaches the hook whichever way the
 * prompt went in (a launch argument, typing into a pane, a hook's added context) and needs no
 * shared state between the sender and the hook process. Both Claude Code (`UserPromptSubmit`) and
 * pi (`before_agent_start`) hand the hook the submitted text.
 *
 * A harness reads the mark in `normalize` (pure) and puts the id on `turn.started` as `prompt_id`.
 * The host trusts an id only when it recorded sending it and has not seen it received before, so
 * a person pasting an old nudge back in is still the person: a mark is a claim, the record decides.
 */
import type { TurnSource } from "./events.ts";

/** The sources norn sends prompts as; `person` is what a prompt without a trusted mark is. */
export type NornPromptSource = Exclude<TurnSource, "person">;

export interface PromptMark {
  source: NornPromptSource;
  /** minted by the host, unique per prompt sent: `[A-Za-z0-9._:-]{1,128}` */
  id: string;
}

const SOURCES: ReadonlySet<string> = new Set<NornPromptSource>(["brief", "nudge", "answer"]);
const ID = /^[A-Za-z0-9._:-]{1,128}$/;
// an HTML comment: markdown renders it as nothing, and an agent reads it as a note rather than an order
const LINE = /^<!-- norn-prompt source=([a-z]+) id=([A-Za-z0-9._:-]{1,128}) -->$/;

/** The mark line for one prompt. Throws on an id outside the charset: a host minting one is a host defect. */
export function promptMarkLine(mark: PromptMark): string {
  if (!SOURCES.has(mark.source)) throw new RangeError(`not a norn prompt source: ${mark.source}`);
  if (!ID.test(mark.id)) throw new RangeError(`not a prompt id: ${JSON.stringify(mark.id)}`);
  return `<!-- norn-prompt source=${mark.source} id=${mark.id} -->`;
}

/** `text` with its mark as the last line. */
export function markPrompt(text: string, mark: PromptMark): string {
  const line = promptMarkLine(mark);
  return text.endsWith("\n") ? `${text}${line}` : `${text}\n\n${line}`;
}

/**
 * The mark a submitted prompt carries, or null. Only the last non-blank line counts: a mark quoted
 * mid-prompt (a person pasting a log) is text, and an agent may trim trailing whitespace.
 */
export function readPromptMark(text: string): PromptMark | null {
  const last = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "")
    .at(-1);
  const m = last === undefined ? null : LINE.exec(last);
  if (!m || !SOURCES.has(m[1] as string)) return null;
  return { source: m[1] as NornPromptSource, id: m[2] as string };
}
