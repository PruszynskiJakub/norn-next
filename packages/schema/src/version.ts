/**
 * The repo's norn version: the `X.Y.Z` the team file records as `norn_version`, and
 * the one rule that says whether a running binary fits it. Pure.
 */

/** `X.Y.Z`, the form `norn_version` takes. */
export const VERSION_PATTERN = "^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)$";

/** How a running binary stands to the repo's version: it fits, or it is older or newer. */
export type VersionMatch = "match" | "older" | "newer";

const parts = (v: string): [number, number, number] => {
  const m = new RegExp(VERSION_PATTERN).exec(v);
  if (!m) throw new Error(`not a version: ${v}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
};

/**
 * `running` matches `repo` when it is the same minor (before 1.0; the same major from 1.0 on)
 * and at least that patch (from 1.0 on: at least that minor and patch). Anything below is older,
 * anything past the line is newer.
 */
export function versionMatch(repo: string, running: string): VersionMatch {
  const [rMaj, rMin, rPat] = parts(repo);
  const [maj, min, pat] = parts(running);
  const cmp = maj - rMaj || min - rMin || pat - rPat;
  if (cmp < 0) return "older";
  const sameLine = rMaj === 0 ? maj === 0 && min === rMin : maj === rMaj;
  return sameLine ? "match" : "newer";
}
