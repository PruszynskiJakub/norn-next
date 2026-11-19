/** The plugin API this build of norn implements; a plugin states the range it was written against. */
export const PLUGIN_API_VERSION = "1.16.0";

type Triple = [major: number, minor: number, patch: number];

const CARET = /^\^(0|[1-9]\d*)(?:\.(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?)?$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function compare(a: Triple, b: Triple): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return (a[i] as number) - (b[i] as number);
  return 0;
}

/**
 * Whether `version` (default: the running API) satisfies a caret range such as `^1`, `^1.2` or `^0.3.1`.
 * Caret keeps the leftmost non-zero part fixed, as npm does, so a 0.x API never claims to satisfy
 * another 0.x minor. Anything that is not a caret range satisfies nothing: guessing would load a
 * plugin against an API it was never written for.
 */
export function apiSatisfies(range: string, version: string = PLUGIN_API_VERSION): boolean {
  const r = CARET.exec(range.trim());
  const v = VERSION.exec(version);
  if (!r || !v) return false;
  const given = [r[2], r[3]].filter((p) => p !== undefined).length;
  const low: Triple = [Number(r[1]), Number(r[2] ?? 0), Number(r[3] ?? 0)];
  const have: Triple = [Number(v[1]), Number(v[2]), Number(v[3])];
  if (compare(have, low) < 0) return false;
  // the first non-zero part the range names is the one that must match; `^0` and `^0.0` pin what they name
  const fixed = low[0] !== 0 ? 0 : given >= 1 && low[1] !== 0 ? 1 : given === 2 ? 2 : given;
  for (let i = 0; i <= fixed; i++) if (have[i] !== low[i]) return false;
  return true;
}
