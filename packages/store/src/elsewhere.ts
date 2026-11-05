/**
 * gh-195 D6 (B10, B13, B17–B19, B30): stories another heartbeat holds that this checkout has no copy of.
 * A story with a claim is open: the claim goes when the story finishes (GR6, GR6b) or is handed over.
 * The tick fetches, for each one, its story branch and its record ref `refs/norn/runs/<story>`
 * (`fetchElsewhere`), and nothing else under `refs/norn/runs/`. Views read what is local and write
 * nothing (H2): the claim ref, the remote-tracking story branch (its spec, its last commit and its last
 * boundary commit) and the record ref, read from git objects into memory (`readRecordObjects`).
 */
import type { ClaimState, FileError } from "@norn/core";
import { type ClaimBlob, claimRef, parseSpecDirName, recordRef, SPECS_DIR, SPEC_FILE, type StoryFrontmatter } from "@norn/schema";
import { parseStoryFile } from "./frontmatter.ts";
import { git, gitOk, listLocalRefs, listRemoteRefs } from "./git.ts";
import { type RecordObjectUnit, readRecordObjects } from "./record-ref.ts";
import { classifyClaim, readLocalClaim } from "./refs.ts";

export type ElsewhereClaim = Extract<ClaimState, { blob: ClaimBlob }>;

/**
 * The story keys whose local claim another heartbeat holds (live or expired), other than `known` (the
 * stories this checkout has). Judged by heartbeat (ID2): another clone of the same `user@host` is
 * another checkout, its stories held elsewhere too.
 */
export async function heldElsewhereKeys(root: string, me: { heartbeat_id: string | null }, now: number, known: ReadonlySet<string>): Promise<Array<{ key: string; claim: ElsewhereClaim }>> {
  const prefix = claimRef("");
  const out: Array<{ key: string; claim: ElsewhereClaim }> = [];
  for (const { ref } of await listLocalRefs(root, prefix)) {
    const key = ref.slice(prefix.length);
    if (!key || key.includes("/") || known.has(key)) continue;
    const c = classifyClaim(await readLocalClaim(root, key), me, now);
    if ((c.state === "other" || c.state === "expired") && c.blob.heartbeat_id !== me.heartbeat_id) out.push({ key, claim: c });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
}

/**
 * B30 (D6): fetch what a non-holder needs of `stories`: each one's story branch (`<story>-<slug>`)
 * into the remote-tracking refs, and its record ref when the remote has one. One `ls-remote` of the
 * record names, then one fetch; never all of `refs/norn/runs/*`. Throws on a failed `ls-remote` or fetch.
 */
export async function fetchElsewhere(root: string, remote: string, stories: readonly string[]): Promise<void> {
  if (!stories.length) return;
  const records = new Set((await listRemoteRefs(root, remote, `${recordRef("")}*`)).map((r) => r.ref));
  const specs: string[] = [];
  for (const key of stories) {
    specs.push(`+refs/heads/${key}-*:refs/remotes/${remote}/${key}-*`);
    if (records.has(recordRef(key))) specs.push(`+${recordRef(key)}:${recordRef(key)}`);
  }
  await gitOk(root, ["fetch", "--quiet", "--no-tags", remote, ...specs]);
}

/** The record ref as this checkout has it: its commit, time, holder trailer and units. */
export interface RecordRead {
  sha: string;
  /** ISO commit time: what "record as of" shows (B13) */
  at: string;
  /** `Norn-Holder` trailer; null = none */
  holder: string | null;
  /** the story unit first, then slices by folder */
  units: RecordObjectUnit[];
  /** files of the record that failed its checks (S2); their units are left out of `units` */
  errors: FileError[];
}

export interface ElsewhereStory {
  key: string;
  claim: ElsewhereClaim;
  /** the story branch as the remote-tracking refs name it; null = not fetched here */
  branch: string | null;
  frontmatter: StoryFrontmatter | null;
  /** the remote-tracking story branch's head */
  head: { sha: string; subject: string; at: string } | null;
  /** B18, B19: the step the story's last boundary commit ended (`Norn-Step` of a commit with `Norn-Outcome`); null = none pushed yet */
  last_boundary: string | null;
  /** the local record ref; null = none here */
  record: RecordRead | null;
}

/** The story branch's name among the remote-tracking refs of `remote`; null = not fetched here. */
export async function remoteStoryBranch(root: string, remote: string, key: string): Promise<string | null> {
  const prefix = `refs/remotes/${remote}/`;
  const refs = await listLocalRefs(root, `${prefix}${key}-*`);
  const r = refs.find((x) => !x.ref.slice(prefix.length).includes("/") && parseSpecDirName(x.ref.slice(prefix.length))?.story === key);
  return r ? r.ref.slice(prefix.length) : null;
}

/** Every trailer of one commit's trailer block, repeated keys kept in order. */
function trailers(block: string): Array<[string, string]> {
  return block
    .split("\n")
    .map((l) => /^([A-Za-z0-9-]+): (.*)$/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => [m[1] as string, m[2] as string]);
}

/** A story unit's last boundary commit: the step it ended and, from its `Norn-Next` (gh-195 B20), the step it led to (null = a commit an older norn made). */
export interface LastBoundary {
  ended: string;
  next: string | null;
}

/**
 * B18–B20 (S4): the story unit's last boundary commit — the newest commit on `ref` (past `base`, when
 * given) with `Norn-Story: <key>`, no `Norn-Slice` and a `Norn-Outcome`, which only a commit that ends a
 * step carries (not a start, a session start, a mirror, a wait for input or a round start). Null = no
 * boundary pushed yet. `strict`: a failing `git log` throws instead of reading as no boundary
 * (gh-195/11 review#1 S4: a takeover with the record lost must not restart at the first step on a guess).
 */
export async function lastBoundary(root: string, ref: string, key: string, base: string | null, opts: { strict?: boolean } = {}): Promise<LastBoundary | null> {
  const r = await git(root, ["log", "--format=%x1e%(trailers:only,unfold)", "--grep=^Norn-Outcome: ", ref, ...(base ? ["--not", base] : [])]);
  if (r.code !== 0) {
    if (opts.strict) throw new Error(`git log ${ref} failed: ${r.stderr.trim() || `exit ${r.code}`}`);
    return null;
  }
  for (const block of r.stdout.split("\x1e")) {
    const t = trailers(block);
    const one = (k: string) => t.find(([n]) => n === k)?.[1];
    const ended = one("Norn-Step");
    if (one("Norn-Story") === key && one("Norn-Slice") === undefined && one("Norn-Outcome") !== undefined && ended) return { ended, next: one("Norn-Next") ?? null };
  }
  return null;
}

/** The story's record as the local ref `refs/norn/runs/<story>` has it, read into memory; null = no ref here. */
export async function readStoryRecord(root: string, key: string): Promise<RecordRead | null> {
  const rec = await git(root, ["rev-parse", "--verify", "--quiet", `${recordRef(key)}^{commit}`]);
  if (rec.code !== 0) return null;
  const sha = rec.stdout.trim();
  const meta = await git(root, ["log", "-1", "--format=%cI%n%(trailers:key=Norn-Holder,valueonly,separator=)", sha]);
  const [at = "", holder = ""] = meta.stdout.split("\n");
  const { units, errors } = await readRecordObjects(root, key, sha);
  return { sha, at: at ? new Date(at).toISOString() : "", holder: holder.trim() || null, units, errors };
}

/** One story held elsewhere, as this checkout's local refs have it (no network, no write). `base`: the fetched base branch, bounding the history walked. */
export async function loadElsewhereStory(root: string, remote: string | null, key: string, claim: ElsewhereClaim, base: string | null = null): Promise<ElsewhereStory> {
  const branch = remote ? await remoteStoryBranch(root, remote, key) : null;
  const ref = branch && remote ? `refs/remotes/${remote}/${branch}` : null;
  let frontmatter: StoryFrontmatter | null = null;
  let head: ElsewhereStory["head"] = null;
  let last: string | null = null;
  if (ref && branch) {
    const file = `${SPECS_DIR}/${branch}/${SPEC_FILE}`;
    const raw = await git(root, ["show", `${ref}:${file}`]);
    if (raw.code === 0) {
      const p = parseStoryFile(raw.stdout, file);
      if (p.ok) frontmatter = p.value.frontmatter;
    }
    const h = await git(root, ["log", "-1", "--format=%H%n%cI%n%s", ref]);
    const [sha = "", at = "", subject = ""] = h.stdout.split("\n");
    if (h.code === 0 && sha) head = { sha, subject, at: new Date(at).toISOString() };
    last = (await lastBoundary(root, ref, key, base))?.ended ?? null;
  }
  return { key, claim, branch, frontmatter, head, last_boundary: last, record: await readStoryRecord(root, key) };
}
