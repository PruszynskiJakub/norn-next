/**
 * Where store "local" keeps each record under `<machine folder>/runs-v2/`. One folder per story holds
 * its units, claim, mailbox and artifacts, so archiving a story is one marker beside them all.
 *
 *   stories/<story>/units/story/state.json            the story's own unit
 *   stories/<story>/units/<nn>/receipts/<seq>-<id>.json   a slice's receipts
 *   stories/<story>/claim.json, mailbox.json, archived.json
 *   stories/<story>/artifacts/<encoded path>
 *
 *   floor.json                                        the norn version floor
 *
 * Lock files sit beside the record they guard (`<record>.lock`).
 */
import { parseUnitId } from "@norn/plugin-api";
import { STORE_DIR } from "./config.ts";

/** The units folder name of a story's own unit; slices are all digits, so it never collides with one. */
export const STORY_UNIT_DIR = "story";
export const STATE_FILE = "state.json";
export const RECEIPTS_DIR = "receipts";
export const ARCHIVED_FILE = "archived.json";

/** `<seq>-<id>.json`, the seq zero-padded so a listing reads in order to a person too. */
export const RECEIPT_FILE_RE = /^([0-9]{8,})-(.+)\.json$/;
const SEQ_WIDTH = 8;

/** A file name a store-local record never takes; host temp files of an atomic write start with a dot. */
export const isHidden = (name: string): boolean => name.startsWith(".");

export interface Layout {
  floor: string;
  stories: string;
  story(story: string): string;
  units(story: string): string;
  /** the folder of one unit; the unit must already be validated */
  unit(unit: string): string;
  receipts(unit: string): string;
  receipt(unit: string, seq: number, id: string): string;
  state(unit: string): string;
  archived(story: string): string;
  claim(story: string): string;
  mailbox(story: string): string;
  artifacts(story: string): string;
}

export function layout(dataDir: string): Layout {
  const root = `${dataDir.replace(/\/+$/, "")}/${STORE_DIR}`;
  const stories = `${root}/stories`;
  const story = (s: string) => `${stories}/${s}`;
  const units = (s: string) => `${story(s)}/units`;
  const unit = (u: string) => {
    const ref = parseUnitId(u);
    if (!ref) throw new RangeError(`not a unit: ${u}`);
    return `${units(ref.story)}/${ref.slice ?? STORY_UNIT_DIR}`;
  };
  const receipts = (u: string) => `${unit(u)}/${RECEIPTS_DIR}`;
  return {
    floor: `${root}/floor.json`,
    stories,
    story,
    units,
    unit,
    receipts,
    receipt: (u, seq, id) => `${receipts(u)}/${String(seq).padStart(SEQ_WIDTH, "0")}-${id}.json`,
    state: (u) => `${unit(u)}/${STATE_FILE}`,
    archived: (s) => `${story(s)}/${ARCHIVED_FILE}`,
    claim: (s) => `${story(s)}/claim.json`,
    mailbox: (s) => `${story(s)}/mailbox.json`,
    artifacts: (s) => `${story(s)}/artifacts`,
  };
}

/** The unit id a units folder entry names, or null for an entry that is not a unit folder. */
export function unitOfDir(story: string, name: string): string | null {
  if (name === STORY_UNIT_DIR) return story;
  const id = `${story}/${name}`;
  return parseUnitId(id)?.slice === name ? id : null;
}

/** Longest file name most file systems take, in bytes; an artifact path that encodes longer is refused. */
const MAX_NAME_BYTES = 255;

/** Bytes that stand for themselves in an artifact file name: none is a letter whose case a file system could fold. */
const LITERAL = /^[a-z0-9_~.-]$/;
/** Marks an uppercase letter, written as its lowercase; itself always percent-encoded, so it is never ambiguous. */
const UPPER = "!";
const hex = (b: number): string => `%${b.toString(16).padStart(2, "0")}`;

/**
 * An artifact path as one flat file name. Flat because HostFiles cannot tell a folder from a file in a
 * listing; `/` is percent-encoded so it cannot nest, and a leading dot is encoded so no artifact hides
 * among a host's temp files. Uppercase letters become `!` and the lowercase letter, and every byte
 * outside ASCII is percent-encoded with lowercase hex, because the default file systems on macOS and
 * Windows fold case (and macOS folds Unicode normalization too): two paths that differ only there would
 * otherwise land in one file and the second write would silently replace the first. Null when the name
 * would be too long for a file system.
 */
export function encodeArtifactName(path: string): string | null {
  let name = "";
  for (const b of new TextEncoder().encode(path)) {
    const ch = String.fromCharCode(b);
    if (LITERAL.test(ch)) name += ch;
    else if (b >= 0x41 && b <= 0x5a) name += UPPER + ch.toLowerCase();
    else name += hex(b);
  }
  if (name.startsWith(".")) name = hex(0x2e) + name.slice(1);
  return name.length <= MAX_NAME_BYTES ? name : null;
}

/** The artifact path a file name holds, or null when the name is not one `encodeArtifactName` makes. */
export function decodeArtifactName(name: string): string | null {
  const bytes: number[] = [];
  for (let i = 0; i < name.length; i++) {
    const ch = name.charAt(i);
    if (ch === "%") {
      const pair = name.slice(i + 1, i + 3);
      if (!/^[0-9a-f]{2}$/.test(pair)) return null;
      bytes.push(Number.parseInt(pair, 16));
      i += 2;
    } else if (ch === UPPER) {
      const lower = name.charAt(i + 1);
      if (!/^[a-z]$/.test(lower)) return null;
      bytes.push(lower.toUpperCase().charCodeAt(0));
      i += 1;
    } else if (LITERAL.test(ch)) bytes.push(ch.charCodeAt(0));
    else return null;
  }
  let path: string;
  try {
    path = new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
  } catch {
    return null;
  }
  // only the one spelling encode makes is an artifact; any other is a file that is not ours
  return encodeArtifactName(path) === name ? path : null;
}
