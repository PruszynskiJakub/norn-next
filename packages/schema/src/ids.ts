/**
 * Identifiers (§5.1) and naming rules shared by every package.
 * Pure functions only; no IO.
 */
import {
  DURATION_PATTERN,
  GIT_SHA_PATTERN,
  type RemoteProvider,
  SLICE_KEY_PATTERN,
  SLICE_NN_PATTERN,
  STORY_KEY_PATTERN,
  ULID_PATTERN,
} from "./common.ts";

// ---------------------------------------------------------------- ULID

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ULID_RE = new RegExp(ULID_PATTERN);
let lastTime = -1;
let lastRandom: number[] = [];

function randomDigits(): number[] {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b & 31);
}

/** Monotonic ULID: within one millisecond, ids strictly increase. */
export function ulid(now: number = Date.now()): string {
  if (!Number.isInteger(now) || now < 0 || now > 2 ** 48 - 1) throw new RangeError(`ulid: bad time ${now}`);
  let rand: number[];
  if (now <= lastTime) {
    now = lastTime;
    rand = lastRandom.slice();
    let i = rand.length - 1;
    while (i >= 0 && rand[i] === 31) rand[i--] = 0;
    if (i < 0) throw new Error("ulid: random overflow within one millisecond");
    rand[i] = (rand[i] as number) + 1;
  } else {
    rand = randomDigits();
  }
  lastTime = now;
  lastRandom = rand;
  let time = "";
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  return time + rand.map((d) => CROCKFORD[d]).join("");
}

/**
 * Deterministic ULID derived from a seed ULID and an index: same timestamp as the
 * seed, randomness from sha256(seed:index). Lets the pure `decide` mint receipt and
 * run ids from `tick_id` so `norn run view --why` replays to identical actions (O5).
 */
export function deriveUlid(seed: string, index: number): string {
  if (!isUlid(seed)) throw new Error(`not a ULID: ${seed}`);
  const digest = new Bun.CryptoHasher("sha256").update(`${seed}:${index}`).digest();
  let rand = "";
  for (let i = 0; i < 16; i++) rand += CROCKFORD[(digest[i] as number) & 31];
  return seed.slice(0, 10) + rand;
}

export function isUlid(s: unknown): s is string {
  return typeof s === "string" && ULID_RE.test(s);
}

/** Milliseconds encoded in a ULID. */
export function ulidTime(id: string): number {
  if (!isUlid(id)) throw new Error(`not a ULID: ${id}`);
  let t = 0;
  for (const c of id.slice(0, 10)) t = t * 32 + CROCKFORD.indexOf(c);
  return t;
}

// ---------------------------------------------------------------- keys

export type KeyPrefix = "gh" | "gl";
const PROVIDER_PREFIX: Record<RemoteProvider, KeyPrefix> = { gh: "gh", glab: "gl" };
const PREFIX_PROVIDER: Record<KeyPrefix, RemoteProvider> = { gh: "gh", gl: "glab" };

export interface StoryKeyParts {
  prefix: KeyPrefix;
  provider: RemoteProvider;
  number: number;
}
export interface SliceKeyParts {
  story: string;
  /** Zero-padded slice number as written in the key, e.g. "03". */
  nn: string;
}

const STORY_KEY_RE = new RegExp(STORY_KEY_PATTERN);
const SLICE_KEY_RE = new RegExp(SLICE_KEY_PATTERN);
const SLICE_NN_RE = new RegExp(SLICE_NN_PATTERN);

export function storyKey(provider: RemoteProvider, number: number): string {
  if (!Number.isInteger(number) || number < 1) throw new RangeError(`bad issue number: ${number}`);
  return `${PROVIDER_PREFIX[provider]}-${number}`;
}
export function isStoryKey(s: unknown): s is string {
  return typeof s === "string" && STORY_KEY_RE.test(s);
}
export function parseStoryKey(key: string): StoryKeyParts | null {
  if (!isStoryKey(key)) return null;
  const [prefix, n] = key.split("-") as [KeyPrefix, string];
  return { prefix, provider: PREFIX_PROVIDER[prefix], number: Number(n) };
}

/** Pad a slice number to two digits: 3 → "03". */
function sliceNn(n: number | string): string {
  const s = String(n).padStart(2, "0");
  if (!SLICE_NN_RE.test(s)) throw new RangeError(`bad slice number: ${n}`);
  return s;
}
export function sliceKey(story: string, n: number | string): string {
  if (!isStoryKey(story)) throw new Error(`not a story key: ${story}`);
  return `${story}/${sliceNn(n)}`;
}
export function isSliceKey(s: unknown): s is string {
  return typeof s === "string" && SLICE_KEY_RE.test(s);
}
export function parseSliceKey(key: string): SliceKeyParts | null {
  if (!isSliceKey(key)) return null;
  const [story, nn] = key.split("/") as [string, string];
  return { story, nn };
}

/** A unit key is a story key or a slice key; the story key of either. */
export function storyOf(unitKey: string): string {
  const slice = parseSliceKey(unitKey);
  if (slice) return slice.story;
  if (isStoryKey(unitKey)) return unitKey;
  throw new Error(`not a story or slice key: ${unitKey}`);
}

// ---------------------------------------------------------------- git

const GIT_SHA_RE = new RegExp(GIT_SHA_PATTERN);
/** A full git commit id (`GitSha`). */
export function isGitSha(s: unknown): s is string {
  return typeof s === "string" && GIT_SHA_RE.test(s);
}

// ---------------------------------------------------------------- slugs

const SLUG_MAX = 40;
const TRANSLIT: Record<string, string> = { ł: "l", Ł: "l", ß: "ss", æ: "ae", ø: "o", đ: "d", þ: "th" };

/**
 * Slug rule (ID1): lowercase ASCII, `[a-z0-9]` words joined by `-`, at most
 * 40 chars cut at a word boundary, `untitled` if nothing remains. Frozen at creation.
 */
export function slugify(title: string, max = SLUG_MAX): string {
  const words = title
    .replace(/[łŁßæøđþ]/g, (c) => TRANSLIT[c] ?? c)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  let out = "";
  for (const w of words) {
    const next = out ? `${out}-${w}` : w;
    if (next.length > max) {
      if (!out) out = w.slice(0, max);
      break;
    }
    out = next;
  }
  return out || "untitled";
}

// ---------------------------------------------------------------- naming (§7, GR3)

export const STORY_UNIT_DIR = "_story";
/** Repo-relative folder holding every story's spec folder (§7). */
export const SPECS_DIR = ".agents/specs";

const SPEC_DIR_RE = /^((?:gh|gl)-[1-9][0-9]*)-([a-z0-9]+(?:-[a-z0-9]+)*)$/;
const SLICE_FILE_RE = /^([0-9]{2,3})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;

/** Spec folder name (and story branch) `gh-123-fix-login` → `{ story: "gh-123", slug: "fix-login" }`. */
export function parseSpecDirName(name: string): { story: string; slug: string } | null {
  const m = SPEC_DIR_RE.exec(name);
  return m && isStoryKey(m[1]) ? { story: m[1] as string, slug: m[2] as string } : null;
}
/** Slice file name `03-add-form.md` → `{ nn: "03", slug: "add-form" }`. */
export function parseSliceFileName(name: string): { nn: string; slug: string } | null {
  const m = SLICE_FILE_RE.exec(name);
  return m ? { nn: m[1] as string, slug: m[2] as string } : null;
}

/** Spec folder name and story branch: `gh-123-fix-login`. */
export function storyDirName(story: string, slug: string): string {
  return `${story}-${slug}`;
}
export const storyBranch = storyDirName;
/** Slice file stem and `runs/<unit>` folder: `03-add-form`. */
export function sliceDirName(nn: string, slug: string): string {
  return `${sliceNn(nn)}-${slug}`;
}
/**
 * The folder that holds every story's run state: `runs/` in the checkout's machine dir (S12, gh-195 D1:
 * `<machine dir>/runs/<story>/<unit>/`), and, in a spec folder of an older norn's tree, the folder that
 * held its units' records and still holds the units' handoffs (gh-195/05: the handoff stays there until
 * gh-195/07 moves it to `handoffs/`).
 */
export const RUNS_DIR = "runs";
/**
 * gh-71 D2 (B30, B36), gh-195 D7: a unit's record folder relative to the story's run-state folder,
 * `<unit>` (`_story` or `<nn>-<slug>`): `UnitFacts.record` for a slice or a flat story record. The one
 * place that names it: store's run-state resolver (`run-state.ts`) resolves it under a root,
 * `runStatePath` below joins it to the story, and pure decide compares against it as is. Nothing else
 * builds this path by hand (gh-195 prefactor 1).
 */
export function unitRecordPath(unit: string): string {
  return unit;
}
/** gh-71 B30: the folder under `_story/` that holds the story's rounds. */
export const ROUNDS_DIR = "rounds";
/** gh-71 B30: a round's folder name, `01-triage` (two digits from 01). */
export function roundDirName(n: number, workflow: string): string {
  return `${String(n).padStart(2, "0")}-${workflow}`;
}
const ROUND_DIR_RE = /^([0-9]{2,})-(.+)$/;
export function parseRoundDirName(name: string): { n: number; workflow: string } | null {
  const m = ROUND_DIR_RE.exec(name);
  return m ? { n: Number(m[1]), workflow: m[2] as string } : null;
}
/** gh-195 D9 (B39): the folder of a spec that holds its units' handoffs, `<spec folder>/handoffs/`. */
export const HANDOFFS_DIR = "handoffs";
/**
 * gh-195 prefactor 2 (B6, B39): a unit's handoff relative to its spec folder, keyed by the unit, never by
 * its record folder. The one place that names it: store's `handoffPath` resolves it under a spec folder.
 * gh-195/07 (D9, B39): `handoffs/_story.md` for the story (one file across rounds), `handoffs/<nn>-<slug>.md`
 * for a slice, each on its unit's branch; prose only (B6), its run state is in the machine dir (S12).
 */
export function unitHandoffPath(unit: string): string {
  return `${HANDOFFS_DIR}/${unit}.md`;
}
/**
 * gh-195/07 (B8, B34, D13 step 2): where an older norn kept a unit's handoff in its tree, `runs/<unit>/handoff.md`
 * (the story's above its round folders, gh-71 B31); read only by the move that takes it to `unitHandoffPath`.
 */
export function treeHandoffPath(unit: string): string {
  return `${RUNS_DIR}/${unit}/handoff.md`;
}
/** gh-71 B30: a story round's record folder relative to the story's run-state folder, `_story/rounds/01-triage`. */
export function roundRecordPath(n: number, workflow: string): string {
  return `${unitRecordPath(STORY_UNIT_DIR)}/${ROUNDS_DIR}/${roundDirName(n, workflow)}`;
}
/**
 * gh-195 D7: a unit's record as observe resolved it, relative to the story's run-state folder. A record
 * an older norn wrote into facts named it from the spec folder (`runs/_story/rounds/01-story`); it reads
 * as the same unit's record (`_story/rounds/01-story`).
 */
export const normalRecord = (record: string): string => record.replace(new RegExp(`^${RUNS_DIR}/`), "");
/**
 * gh-195 prefactor 1: the story a unit's run state belongs to, as the run-state resolver takes it: its
 * key and its root-relative spec folder (`.agents/specs/<id>-<slug>`).
 */
export interface RunStory {
  key: string;
  spec_dir: string;
}
/**
 * gh-195 prefactor 1, S12 (B2, B4): the pure half of the run-state resolver — where a unit's run state
 * sits relative to the checkout's machine dir, `runs/<story>/<unit>`, for a story and a unit (store's
 * `runStateFile` resolves such a path). A relative path is not looked at on disk, so the story unit is
 * `runs/<story>/_story` here, not its round (store's `runStateDir` resolves that). Nothing outside here
 * and store's `run-state.ts` joins a story with `runs/` (test/repo/repo.test.ts).
 */
export const runStatePath = (story: RunStory, unit: string): string => `${storyRunStatePath(story)}/${unitRecordPath(unit)}`;
/**
 * gh-195 prefactor 1 (review F1): a unit's run-state folder relative to the machine dir from its record,
 * the unit's path inside the story's run state as observe resolved it (`UnitFacts.record`, e.g. `_story/rounds/01-story`).
 */
export const recordRunStatePath = (story: RunStory, record: string): string => `${storyRunStatePath(story)}/${normalRecord(record)}`;
/** gh-195 prefactor 1: round `n`'s run-state folder relative to the machine dir (`runs/<story>/_story/rounds/NN-<wf>`). */
export const roundRunStatePath = (story: RunStory, n: number, workflow: string): string => `${storyRunStatePath(story)}/${roundRecordPath(n, workflow)}`;
/** gh-195 prefactor 1, S12: the folder relative to the machine dir that holds every unit's run state of a story (`runs/<story>`). */
export const storyRunStatePath = (story: RunStory): string => `${RUNS_DIR}/${story.key}`;
/**
 * gh-195/05: where an older norn kept a unit's record in a git tree, relative to its root
 * (`<spec folder>/runs/<unit>`): what is read from a branch or base tree an older norn wrote (the
 * mailbox's step stamp, finished stories on the base until gh-195/16) and what `unpushed_runs` measures.
 */
export const treeRunStatePath = (story: RunStory, unit: string): string => `${treeStoryRunStatePath(story)}/${unitRecordPath(unit)}`;
/** gh-195/05: round `n`'s record folder in an older norn's tree (`<spec folder>/runs/_story/rounds/NN-<wf>`). */
export const treeRoundRunStatePath = (story: RunStory, n: number, workflow: string): string => `${treeStoryRunStatePath(story)}/${roundRecordPath(n, workflow)}`;
/** gh-195/05: the folder of an older norn's tree that held every unit's record of a story (`<spec folder>/runs`). */
export const treeStoryRunStatePath = (story: RunStory): string => `${story.spec_dir}/${RUNS_DIR}`;
/** Slice branch: `gh-123/03-add-form`. */
export function sliceBranch(story: string, nn: string, slug: string): string {
  return `${story}/${sliceDirName(nn, slug)}`;
}
export function specDir(story: string, slug: string): string {
  return `${SPECS_DIR}/${storyDirName(story, slug)}`;
}
/** GR2: the story's spec file in its spec folder: the mirrored issue, then the refined spec. */
export const SPEC_FILE = "spec.md";
/** The name older norn releases wrote; still read when a spec folder has no `spec.md` (GR2). */
export const LEGACY_SPEC_FILE = "story.md";
/** GR9: the story PR body an agent writes, in the spec folder. */
export const PR_BODY_FILE = "pr.md";
export function claimRef(story: string): string {
  return `refs/norn/claims/${story}`;
}
export function mailboxPrefix(story: string): string {
  return `refs/norn/inbox/${story}/`;
}
export function mailboxRef(story: string, id: string): string {
  return `${mailboxPrefix(story)}${id}`;
}
/** gh-195 D2 (B10): the ref holding a story's record, one commit per push whose tree is its run-state folder. */
export const RECORD_REF_PREFIX = "refs/norn/runs/";
export function recordRef(story: string): string {
  return `${RECORD_REF_PREFIX}${story}`;
}

/** Receipt file name `NNNN-<kind>.json` (S6). */
export function receiptFileName(n: number, kind: string): string {
  if (!Number.isInteger(n) || n < 1 || n > 9999) throw new RangeError(`bad receipt number: ${n}`);
  return `${String(n).padStart(4, "0")}-${kind}.json`;
}
export function parseReceiptFileName(name: string): { n: number; kind: string } | null {
  const m = /^(\d{4})-([a-z]+)\.json$/.exec(name);
  return m ? { n: Number(m[1]), kind: m[2] as string } : null;
}

// ---------------------------------------------------------------- durations

const DURATION_RE = new RegExp(DURATION_PATTERN);
const UNIT_MS = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

/** `1h30m` → 5_400_000. Throws on malformed input. */
export function parseDuration(s: string): number {
  if (!DURATION_RE.test(s)) throw new Error(`bad duration: ${s}`);
  let ms = 0;
  for (const m of s.matchAll(/(\d+)(ms|s|m|h|d)/g)) ms += Number(m[1]) * UNIT_MS[m[2] as keyof typeof UNIT_MS];
  return ms;
}
