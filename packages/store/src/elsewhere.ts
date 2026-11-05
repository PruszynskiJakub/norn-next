/**
 * gh-195 D6 (B10, B13, B17–B19, B30): stories another heartbeat holds that this checkout has no copy
 * of. The tick fetches, for each one, its story branch and its record ref `refs/norn/runs/<story>`
 * (`fetchElsewhere`), and nothing else under `refs/norn/runs/`. Views read what is local: the claim
 * ref, the remote-tracking story branch (its spec, its last commit and its last `Norn-Step` trailer)
 * and the local record ref, unpacked once per record commit into a cache in the machine dir
 * (`<machine dir>/record-cache/<story>/<commit>/`, through `unpackRecord`: S1, S2), the way the base
 * branch's specs are cached. No network here but in `fetchElsewhere`.
 */
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { ClaimState } from "@norn/core";
import { type ClaimBlob, claimRef, parseSpecDirName, recordRef, SPECS_DIR, SPEC_FILE, STORY_UNIT_DIR, type StoryFrontmatter, type UnitState, type Workflow } from "@norn/schema";
import { parseStoryFile } from "./frontmatter.ts";
import { git, gitOk, listLocalRefs, listRemoteRefs } from "./git.ts";
import { machineDir } from "./paths.ts";
import { unpackRecord } from "./record-ref.ts";
import { classifyClaim, readLocalClaim } from "./refs.ts";
import { runStateDirIn } from "./run-state.ts";
import { readPinnedWorkflow, readState } from "./unit.ts";

/** The story keys whose local claim another heartbeat holds (live or expired), other than `known`. */
export async function heldElsewhereKeys(root: string, me: { heartbeat_id: string | null; holder: string }, now: number, known: ReadonlySet<string>): Promise<Array<{ key: string; claim: Extract<ClaimState, { blob: ClaimBlob }> }>> {
  const prefix = claimRef("");
  const refs = await listLocalRefs(root, prefix).catch(() => []);
  const out: Array<{ key: string; claim: Extract<ClaimState, { blob: ClaimBlob }> }> = [];
  for (const { ref } of refs) {
    const key = ref.slice(prefix.length);
    if (!key || key.includes("/") || known.has(key)) continue;
    const c = classifyClaim(await readLocalClaim(root, key).catch(() => ({ state: "none" }) as const), me, now);
    if ((c.state === "other" || c.state === "expired") && c.blob.holder !== me.holder && c.blob.heartbeat_id !== me.heartbeat_id) out.push({ key, claim: c });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
}

/**
 * B30 (D6): fetch what a non-holder needs of `stories`: each one's story and slice branches
 * (`<story>-*`) into the remote-tracking refs, and its record ref when the remote has one. One
 * `ls-remote` of the record names, then one fetch; never all of `refs/norn/runs/*`.
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

/** A unit's standing as its record has it. */
export interface RecordUnit {
  key: string;
  slice: string | null;
  state: UnitState;
  workflow: Workflow | null;
}

/** The record ref as this checkout has it: its commit, time, holder trailer and units. */
export interface RecordRead {
  sha: string;
  /** ISO commit time: what "record as of" shows (B13) */
  at: string;
  /** `Norn-Holder` trailer; null = none */
  holder: string | null;
  /** the story unit first, then slices by folder; [] = the record failed to unpack */
  units: RecordUnit[];
  /** why the record could not be read; absent = read */
  error?: string;
}

export interface ElsewhereStory {
  key: string;
  claim: Extract<ClaimState, { blob: ClaimBlob }>;
  /** the story branch as the remote-tracking refs name it; null = not fetched here */
  branch: string | null;
  frontmatter: StoryFrontmatter | null;
  /** the remote-tracking story branch's head */
  head: { sha: string; subject: string; at: string } | null;
  /** B18, B19: the step of the story unit's last boundary commit (`Norn-Step`); null = none pushed yet */
  last_boundary: string | null;
  /** the local record ref; null = none here */
  record: RecordRead | null;
}

/** The cache folder of one record commit. */
export const recordCacheDir = (root: string, story: string, sha: string) => join(machineDir(root), "record-cache", story, sha);

/** The story branch's name among the remote-tracking refs of `remote`; null = not fetched here. */
export async function remoteStoryBranch(root: string, remote: string, key: string): Promise<string | null> {
  const prefix = `refs/remotes/${remote}/`;
  const refs = await listLocalRefs(root, `${prefix}${key}-*`).catch(() => []);
  const r = refs.find((x) => !x.ref.slice(prefix.length).includes("/") && parseSpecDirName(x.ref.slice(prefix.length))?.story === key);
  return r ? r.ref.slice(prefix.length) : null;
}

/**
 * B18, B19: the step the story unit's last boundary commit ended, its last `Norn-Step` trailer. The
 * oldest such commit is the story's start, which enters its first step and ends none: a branch with
 * only that one has no boundary yet.
 */
async function lastBoundary(root: string, ref: string, key: string): Promise<string | null> {
  const r = await git(root, ["log", "--format=%x1e%(trailers:only,unfold)", ref]);
  if (r.code !== 0) return null;
  const steps: string[] = [];
  for (const block of r.stdout.split("\x1e")) {
    const t = Object.fromEntries(
      block
        .split("\n")
        .map((l) => l.split(": "))
        .filter((p) => p.length >= 2)
        .map(([k, ...v]) => [k, v.join(": ")]),
    );
    if (t["Norn-Story"] === key && !t["Norn-Slice"] && t["Norn-Step"] && t["Norn-Step"] !== "take") steps.push(t["Norn-Step"] as string);
  }
  return steps.length > 1 ? (steps[0] as string) : null;
}

/** The record at `sha`, unpacked into its cache folder unless it already is (S1, S2 by `unpackRecord`). */
async function readRecord(root: string, key: string, sha: string): Promise<RecordRead> {
  const meta = await git(root, ["log", "-1", "--format=%cI%n%(trailers:key=Norn-Holder,valueonly,separator=)", sha]);
  const [at = "", holder = ""] = meta.stdout.split("\n");
  const base = recordCacheDir(root, key, sha);
  const read: RecordRead = { sha, at: at ? new Date(at).toISOString() : "", holder: holder.trim() || null, units: [] };
  if (!existsSync(base)) {
    mkdirSync(join(base, ".."), { recursive: true });
    const r = await unpackRecord(root, sha, base).catch((e: Error) => ({ ok: false as const, errors: [{ file: base, errors: [{ path: "", message: e.message }] }] }));
    if (!r.ok) return { ...read, error: r.errors.map((e) => `${e.file}: ${e.errors.map((x) => x.message).join("; ")}`).join("; ") };
    // a newer record replaces the cached older one (best effort)
    try {
      for (const n of readdirSync(join(base, ".."))) if (n !== sha && !n.startsWith(".")) rmSync(join(base, "..", n), { recursive: true, force: true });
    } catch {
      /* another view may be cleaning up too */
    }
  }
  const dirs = (() => {
    try {
      return readdirSync(base, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith("."))
        .map((d) => d.name)
        .sort();
    } catch {
      return [];
    }
  })();
  for (const d of [STORY_UNIT_DIR, ...dirs.filter((x) => x !== STORY_UNIT_DIR)]) {
    const nn = d === STORY_UNIT_DIR ? null : /^([0-9]{2,3})-/.exec(d)?.[1];
    if (nn === undefined) continue;
    const dir = runStateDirIn(base, d);
    const st = readState(dir);
    if (!st.ok) continue;
    const wf = readPinnedWorkflow(dir);
    read.units.push({ key: nn === null ? key : `${key}/${nn}`, slice: nn === null ? null : `${key}/${nn}`, state: st.value, workflow: wf.ok ? wf.value.workflow : null });
  }
  return read;
}

/** One story held elsewhere, as this checkout's local refs have it (no network). */
export async function loadElsewhereStory(root: string, remote: string | null, key: string, claim: ElsewhereStory["claim"]): Promise<ElsewhereStory> {
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
    last = await lastBoundary(root, ref, key);
  }
  return { key, claim, branch, frontmatter, head, last_boundary: last, record: await readStoryRecord(root, key) };
}

/** The story's record as the local ref `refs/norn/runs/<story>` has it (cached per commit); null = no ref here. */
export async function readStoryRecord(root: string, key: string): Promise<RecordRead | null> {
  const rec = await git(root, ["rev-parse", "--verify", "--quiet", `${recordRef(key)}^{commit}`]);
  return rec.code === 0 ? readRecord(root, key, rec.stdout.trim()) : null;
}
