/**
 * The story's spec as a document an agent reads and edits: the tracker item mirrored into a block
 * norn owns (frontmatter with the key, title, labels and link, then the title and body), and below it
 * whatever people and later steps write (a Plan, notes). Re-mirroring rewrites only norn's block and
 * its own frontmatter keys, so a section or a frontmatter key someone wrote survives every change to
 * the item; decide never reads any of it.
 */
import type { TrackerItem } from "@norn/plugin-api";

export const SPEC_ARTIFACT = "spec.md";

const BEGIN = "<!-- norn:item: norn rewrites this block from the tracker item; write your own sections below the end marker -->";
const END = "<!-- /norn:item -->";

/** A YAML scalar that reads back as `s` whatever it holds: a JSON string is one. */
const scalar = (s: string): string => JSON.stringify(s);

/** The frontmatter keys norn writes from the item; every other key belongs to whoever wrote it. */
const ITEM_KEYS: ReadonlySet<string> = new Set(["key", "title", "labels", "url"]);

/**
 * The lines of an existing frontmatter outside norn's keys (a top-level key and the indented or list
 * lines under it), so a key a later step adds (the slices' `criteria`) survives every re-mirror.
 */
function keptLines(existing: string | null): string[] {
  if (existing === null || !existing.startsWith("---\n")) return [];
  const end = existing.indexOf("\n---\n", 3);
  if (end < 0) return [];
  const kept: string[] = [];
  let keep = false;
  for (const line of existing.slice(4, end).split("\n")) {
    const top = /^([A-Za-z_][\w-]*)\s*:/.exec(line);
    if (top) keep = !ITEM_KEYS.has(top[1] as string);
    if (keep) kept.push(line);
  }
  return kept;
}

function frontmatter(item: TrackerItem, existing: string | null): string {
  const lines = [`key: ${scalar(item.key)}`, `title: ${scalar(item.title)}`, `labels: [${[...item.labels].sort().map(scalar).join(", ")}]`];
  if (item.url !== undefined) lines.push(`url: ${scalar(item.url)}`);
  lines.push(...keptLines(existing));
  return `---\n${lines.join("\n")}\n---\n`;
}

function itemBlock(item: TrackerItem): string {
  const body = item.body.trim();
  const link = item.url !== undefined ? `\n\n${item.url}` : "";
  return `${BEGIN}\n# ${item.title.trim() || item.key}\n\n${body || "(the tracker item has no body)"}${link}\n${END}\n`;
}

/** The text after a leading frontmatter block, or all of it when there is none. */
function withoutFrontmatter(text: string): string {
  if (!text.startsWith("---\n")) return text;
  const end = text.indexOf("\n---\n", 4);
  return end < 0 ? text : text.slice(end + 5);
}

/**
 * The spec with `item` mirrored into it. What `existing` holds outside norn's block is kept as written:
 * the text before the block and after it. A spec someone rewrote without the markers keeps all of its
 * text below a fresh block, so nothing a person wrote is ever dropped.
 */
export function mirrorItem(item: TrackerItem, existing: string | null): string {
  const head = frontmatter(item, existing);
  const block = itemBlock(item);
  if (existing === null || existing.trim() === "") return `${head}${block}`;
  const rest = withoutFrontmatter(existing);
  const begin = rest.indexOf(BEGIN);
  const end = begin < 0 ? -1 : rest.indexOf(END, begin);
  if (begin < 0 || end < 0) return `${head}${block}\n${rest.replace(/^\n+/, "")}`;
  const before = rest.slice(0, begin);
  const after = rest.slice(end + END.length).replace(/^\n/, "");
  return `${head}${before}${block}${after}`;
}
