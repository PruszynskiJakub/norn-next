/**
 * Where everything lives: one ref per story and kind, and paths inside its tree. A slice unit's `/`
 * goes into tree paths only, never into a ref name, so a story's units always share one ref.
 */
import { isStoreId, parseUnitId } from "@norn/plugin-api";
import { filesIn, type Snapshot } from "./tree.ts";

// spelled out in full so a search for a ref name finds where it is made; each sits under REFS_NAMESPACE
export const RUNS_PREFIX = "refs/norn/v2/runs/";
/** what this clone last saw of the remote's run refs: the lease flush pushes against */
export const TRACKING_RUNS_PREFIX = "refs/norn/v2/tracking/runs/";
const CLAIMS_PREFIX = "refs/norn/v2/claims/";
const MAILBOX_PREFIX = "refs/norn/v2/mailbox/";
/** one ref for the whole store: the norn version floor */
export const FLOOR_REF = "refs/norn/v2/floor";

export const runRef = (story: string): string => `${RUNS_PREFIX}${story}`;
export const trackingRunRef = (story: string): string => `${TRACKING_RUNS_PREFIX}${story}`;
export const claimRef = (story: string): string => `${CLAIMS_PREFIX}${story}`;
export const mailboxRef = (story: string): string => `${MAILBOX_PREFIX}${story}`;

/** in a run tree: present once the story is archived */
export const ARCHIVED_FILE = "archived.json";
export const ARTIFACTS_DIR = "artifacts";
/** in a claim tree */
export const CLAIM_FILE = "claim.json";
/** in the floor's tree */
export const FLOOR_FILE = "floor.json";
/** in a mailbox tree: pending messages, and a marker per acknowledged id so a resend stays a replay */
export const MESSAGES_DIR = "messages";
export const ACKED_DIR = "acked";

const unitTree = (unit: string): string => `units/${unit}`;
export const statePath = (unit: string): string => `${unitTree(unit)}/state.json`;
export const receiptsDir = (unit: string): string => `${unitTree(unit)}/receipts`;
export const artifactPath = (path: string): string => `${ARTIFACTS_DIR}/${path}`;

/** `<seq>-<id>.json`, the name receipts and messages are filed under, so order and id read off the listing. */
export const seqName = (seq: number, id: string): string => `${seq}-${id}.json`;

export interface SeqFile {
  seq: number;
  id: string;
  path: string;
  sha: string;
}

const SEQ_NAME_RE = /^([1-9][0-9]*)-(.+)\.json$/;

/** The `<seq>-<id>.json` files in `dir`, ascending by seq; null when one is misnamed (the data is corrupt). */
export function seqFiles(snap: Snapshot, dir: string): SeqFile[] | null {
  const out: SeqFile[] = [];
  for (const f of filesIn(snap, dir)) {
    const m = SEQ_NAME_RE.exec(f.name);
    if (!m || !isStoreId(m[2])) return null;
    out.push({ seq: Number(m[1]), id: m[2] as string, path: f.path, sha: f.sha });
  }
  return out.sort((a, b) => a.seq - b.seq);
}

const SLICE_FILE_RE = /^([0-9]{2,3})\/(?:state\.json|receipts\/[^/]+)$/;

/** The units of `story` the tree holds data for: a state or at least one receipt. */
export function unitsIn(snap: Snapshot, story: string): string[] {
  const prefix = `${unitTree(story)}/`;
  const units = new Set<string>();
  for (const path of snap.files.keys()) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    if (rest === "state.json" || /^receipts\/[^/]+$/.test(rest)) units.add(story);
    const slice = SLICE_FILE_RE.exec(rest);
    if (slice && parseUnitId(`${story}/${slice[1]}`)) units.add(`${story}/${slice[1]}`);
  }
  return [...units].sort();
}
