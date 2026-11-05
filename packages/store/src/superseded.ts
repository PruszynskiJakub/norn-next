/**
 * gh-195 D11 (B27, T7a, R2.3): this checkout's own record of a story another heartbeat now holds.
 *
 * Observe reports it (`localRecordOf`, read-only, H2) with whether it is on the story's record ref
 * already: its tree is the tree of a record commit this machine pushed (`Norn-Holder` this machine) in
 * the history of the record ref here. A clean release (`norn story handoff`, a clean `watch` exit,
 * `norn story close`) pushes the record before the claim goes (B15), so its copy is on the ref and is
 * removed quietly (`dropLocalRecord`). A takeover without a release leaves receipts the ref never got:
 * the copy is set aside under `superseded/<story>-<ulid>/` (`setAsideRecord`), never pushed and never
 * merged, with `superseded.json` naming the new holder and its newest receipt for its Check item, until
 * `norn tidy` deletes it after `trace.retain` (`pruneSuperseded`). Durable facts only, never timing.
 */
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { type LocalSupersededFile, parseReceiptFileName, type RunStory, STORY_UNIT_DIR, ulidTime } from "@norn/schema";
import { atomicWriteJson, isErrno, readText } from "./fsx.ts";
import { git } from "./git.ts";
import { parseLocalJson } from "./local-json.ts";
import { receiptsDir, supersededDir } from "./paths.ts";
import { readRecordRef, recordTreeId } from "./record-ref.ts";
import { machineRunsDir, runStateDirIn, storyRunStateDir } from "./run-state.ts";

/** D11: a local record of a story another heartbeat holds (`StoryFacts.local_record`). */
export interface LocalRecordFacts {
  /** its newest receipt, `NNNN-<kind>`: the story unit's, else the first slice's that has one; null = none */
  last_receipt: string | null;
  /** its tree is a record this machine pushed to the story's ref: released cleanly (B15) */
  on_ref: boolean;
}

/** The receipt file names of a unit folder, ascending; [] when it has none. */
function receiptNames(dir: string): string[] {
  try {
    return readdirSync(receiptsDir(dir))
      .filter((f) => parseReceiptFileName(f))
      .sort();
  } catch (e) {
    if (isErrno(e, "ENOENT") || isErrno(e, "ENOTDIR")) return [];
    throw e;
  }
}

/** The newest receipt (`NNNN-<kind>`) of a story's run-state folder `base`: the story unit's, else a slice's. */
export function lastReceiptIn(base: string): string | null {
  const units = (() => {
    try {
      return readdirSync(base, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith(".") && d.name !== STORY_UNIT_DIR)
        .map((d) => d.name)
        .sort();
    } catch {
      return [];
    }
  })();
  for (const unit of [STORY_UNIT_DIR, ...units]) {
    const last = receiptNames(runStateDirIn(base, unit)).at(-1);
    if (last) return last.replace(/\.json$/, "");
  }
  return null;
}

/**
 * D11: the local record of `story` in this checkout's machine dir, or null when it holds no file.
 * `holder` is this machine (`user@host`), matched against the record commits' `Norn-Holder`.
 */
export async function localRecordOf(root: string, story: RunStory, holder: string): Promise<LocalRecordFacts | null> {
  const base = storyRunStateDir(root, story);
  if (!existsSync(base)) return null;
  const ref = await readRecordRef(root, story.key);
  const tree = recordTreeId(root, story, ref?.sha.length === 64 ? "sha256" : "sha1");
  if (tree === null) return null;
  return { last_receipt: lastReceiptIn(base), on_ref: ref ? await pushedByMe(root, ref.sha, tree, holder) : false };
}

/** Whether a commit in the history of record commit `sha` has tree `tree` and was pushed by `holder`. */
async function pushedByMe(root: string, sha: string, tree: string, holder: string): Promise<boolean> {
  const r = await git(root, ["log", "--format=%T%x09%(trailers:key=Norn-Holder,valueonly,separator=%x2C)", sha, "--"]);
  if (r.code !== 0) return false;
  return r.stdout.split("\n").some((l) => {
    const [t, h] = l.split("\t");
    return t === tree && (h ?? "").trim() === holder;
  });
}

/**
 * D11 (S1): set the story's local record aside as `superseded/<name>/` — one rename of the whole folder,
 * then its `superseded.json`. A crash between the two leaves the copy without it: it is still listed
 * (holder unknown) and pruned the same way. Returns the folder.
 */
export function setAsideRecord(root: string, story: RunStory, name: string, meta: LocalSupersededFile): string {
  sweepDropped(root);
  const dest = join(supersededDir(root), name);
  mkdirSync(supersededDir(root), { recursive: true });
  renameSync(storyRunStateDir(root, story), dest);
  atomicWriteJson(join(dest, SUPERSEDED_FILE), meta);
  return dest;
}

/**
 * D11 (B27, S1): remove the story's local record quietly, its copy being on the ref already (a clean
 * release): renamed aside first (a dot-named folder is never read as a record), then deleted.
 */
export function dropLocalRecord(root: string, story: RunStory, tag: string): void {
  sweepDropped(root);
  const dir = storyRunStateDir(root, story);
  const aside = join(dirname(dir), `.${story.key}.drop-${tag}`);
  renameSync(dir, aside);
  rmSync(aside, { recursive: true, force: true });
}

const SUPERSEDED_FILE = "superseded.json";

/** D11: one record set aside here (`Facts.superseded`). */
export interface SupersededCopy {
  /** its folder's name under `superseded/`, `<story>-<ulid>` */
  name: string;
  story: string;
  /** null = its `superseded.json` is missing or unreadable */
  holder: string | null;
  last_receipt: string | null;
  /** ISO: from `superseded.json`, else the name's ulid */
  at: string;
  /** absolute folder */
  dir: string;
}

/** D11: every record set aside in this checkout's machine dir, by name. */
export function listSuperseded(root: string): SupersededCopy[] {
  let names: string[];
  try {
    names = readdirSync(supersededDir(root), { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("."))
      .map((d) => d.name)
      .sort();
  } catch (e) {
    if (isErrno(e, "ENOENT")) return [];
    throw e;
  }
  const out: SupersededCopy[] = [];
  for (const name of names) {
    const m = /^(.+)-([0-9A-HJKMNP-TV-Z]{26})$/.exec(name);
    if (!m) continue;
    const dir = join(supersededDir(root), name);
    const meta = readMeta(join(dir, SUPERSEDED_FILE));
    out.push({
      name,
      story: meta?.story ?? (m[1] as string),
      holder: meta?.holder ?? null,
      last_receipt: meta ? meta.last_receipt : lastReceiptIn(dir),
      at: meta?.superseded_at ?? new Date(ulidTime(m[2] as string)).toISOString(),
      dir,
    });
  }
  return out;
}

/** D11 (B27): delete the records set aside before `before` (ISO), as `norn tidy` ages the trace out; returns them (`dry`: only lists them). */
export function pruneSuperseded(root: string, before: string, dry: boolean): SupersededCopy[] {
  const old = listSuperseded(root).filter((c) => c.at < before);
  if (!dry) {
    sweepDropped(root);
    for (const c of old) dropFolder(c.dir);
  }
  return old;
}

/**
 * review#1 F6: a copy's `superseded.json`, validated (S2); null when it is missing or not one — the copy
 * is still listed, its holder unknown.
 */
function readMeta(file: string): LocalSupersededFile | null {
  let raw: string | null;
  try {
    raw = readText(file);
  } catch {
    return null;
  }
  if (raw === null) return null;
  const r = parseLocalJson("local-superseded", raw);
  return r.ok ? r.value : null;
}

/**
 * review#1 F6: what a crash between the rename aside and the delete left behind — `.<story>.drop-<tag>`
 * beside the stories' run state, `.<name>.drop` under `superseded/` — is deleted by the next set-aside,
 * quiet removal or tidy. Never read as a record (dot-named).
 */
export function sweepDropped(root: string): void {
  for (const [dir, re] of [
    [machineRunsDir(root), /^\..+\.drop-[^/]+$/],
    [supersededDir(root), /^\..+\.drop$/],
  ] as const) {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch (e) {
      if (isErrno(e, "ENOENT")) continue;
      throw e;
    }
    for (const n of names) if (re.test(n)) rmSync(join(dir, n), { recursive: true, force: true });
  }
}

/** Rename aside, then delete: a folder half deleted is never listed. */
function dropFolder(dir: string): void {
  const aside = join(dirname(dir), `.${basename(dir)}.drop`);
  renameSync(dir, aside);
  rmSync(aside, { recursive: true, force: true });
}
