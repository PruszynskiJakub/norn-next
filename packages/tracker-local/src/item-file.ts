/**
 * One local item as a markdown file: YAML frontmatter, the body verbatim, then the comments under a
 * `## Comments` heading, each behind a marker line carrying its receipt id. The file is the whole
 * item, so one atomic write changes an item and records the receipt that changed it together.
 */
import { check, IsoTime, NonEmpty } from "@norn/schema";
import { type TrackerEffectKind, TRACKER_EFFECT_KINDS } from "@norn/plugin-api";
import { type Static, Type } from "@sinclair/typebox";
import { parseDocument, stringify } from "yaml";

/**
 * A receipt id as this file can hold it: it lands inside an HTML comment and a YAML key, so `>`,
 * whitespace and quotes would break one of the two.
 */
export const RECEIPT_ID_PATTERN = "^[0-9A-Za-z_-]{1,64}$";
const RECEIPT_RE = new RegExp(RECEIPT_ID_PATTERN);

export function isReceiptId(s: string): boolean {
  return RECEIPT_RE.test(s);
}

export const ItemFrontmatter = Type.Object(
  {
    title: Type.String(),
    open: Type.Boolean(),
    assignees: Type.Array(NonEmpty),
    labels: Type.Array(NonEmpty),
    created_at: IsoTime,
    updated_at: IsoTime,
    /** every receipt performed on this item, with its effect kind; a replay is found here */
    receipts: Type.Record(Type.String({ pattern: RECEIPT_ID_PATTERN }), Type.Union(TRACKER_EFFECT_KINDS.map((k) => Type.Literal(k)))),
  },
  { additionalProperties: false, title: "LocalTrackerItem" },
);
export type ItemFrontmatter = Static<typeof ItemFrontmatter> & { receipts: Record<string, TrackerEffectKind> };

export interface ItemComment {
  receipt_id: string;
  at: string;
  body: string;
}

export interface ItemFile {
  frontmatter: ItemFrontmatter;
  /** the description, byte for byte as written */
  body: string;
  comments: ItemComment[];
}

export type ParsedItem = { ok: true; value: ItemFile } | { ok: false; problem: string };

const OPEN = /^---[ \t]*\r?\n/;
const CLOSE = /^---[ \t]*(\r?\n|$)/m;
/**
 * The heading always follows the body after exactly one added newline, so the body splits back off
 * byte for byte. A body holding a full marker line would be read as comments; nothing writes one.
 */
const COMMENTS_HEADING = "\n## Comments\n";
const MARKER = "^<!-- norn:comment receipt=([0-9A-Za-z_-]+) at=(\\S+) -->\\n";
/** A fresh regex per use: a shared global one carries `lastIndex` from one search into the next. */
const markerRe = () => new RegExp(MARKER, "gm");

function marker(c: ItemComment): string {
  return `<!-- norn:comment receipt=${c.receipt_id} at=${c.at} -->`;
}

export function renderItem(item: ItemFile): string {
  const yaml = stringify(item.frontmatter, { lineWidth: 0 });
  let text = `---\n${yaml}---\n${item.body}`;
  if (item.comments.length === 0) return text;
  text += COMMENTS_HEADING;
  for (const c of item.comments) text += `\n${marker(c)}\n${c.body}\n`;
  return text;
}

function splitComments(rest: string): { body: string; comments: ItemComment[] } {
  const first = markerRe().exec(rest);
  if (!first) return { body: rest, comments: [] };
  const heading = rest.lastIndexOf(COMMENTS_HEADING, first.index);
  if (heading < 0) return { body: rest, comments: [] };
  const section = rest.slice(heading + COMMENTS_HEADING.length);
  const marks = [...section.matchAll(markerRe())];
  const comments = marks.map((m, i) => {
    const start = (m.index as number) + m[0].length;
    const next = marks[i + 1];
    // every comment is written as `<marker>\n<body>\n`, and each later marker is preceded by one blank line
    let chunk = section.slice(start, next ? (next.index as number) - 1 : section.length);
    if (chunk.endsWith("\n")) chunk = chunk.slice(0, -1);
    return { receipt_id: m[1] as string, at: m[2] as string, body: chunk };
  });
  return { body: rest.slice(0, heading), comments };
}

/** Parse an item file; any doubt about its shape is a problem to report, never a guess. */
export function parseItem(text: string): ParsedItem {
  const open = OPEN.exec(text);
  if (!open) return { ok: false, problem: "missing YAML frontmatter (--- … ---)" };
  const afterOpen = text.slice(open[0].length);
  const close = CLOSE.exec(afterOpen);
  if (!close) return { ok: false, problem: "unclosed YAML frontmatter" };
  const doc = parseDocument(afterOpen.slice(0, close.index));
  if (doc.errors.length > 0) return { ok: false, problem: `YAML: ${doc.errors.map((e) => e.message).join("; ")}` };
  const fm = check(ItemFrontmatter, doc.toJS() ?? {});
  if (!fm.ok) return { ok: false, problem: fm.errors.map((e) => `${e.path || "/"} ${e.message}`).join("; ") };
  const { body, comments } = splitComments(afterOpen.slice(close.index + close[0].length));
  return { ok: true, value: { frontmatter: fm.value as ItemFrontmatter, body, comments } };
}
