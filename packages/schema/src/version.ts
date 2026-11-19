/**
 * norn versions as a store's floor records them, and the one order they compare by. Pure.
 */

/** `X.Y.Z`, the form a recorded norn version takes. */
export const VERSION_PATTERN = "^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)$";

const VERSION_RE = new RegExp(VERSION_PATTERN);
const CORE_RE = /^((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))(?:[-+].*)?$/;

export function isVersion(v: unknown): v is string {
  return typeof v === "string" && VERSION_RE.test(v);
}

/**
 * The `X.Y.Z` a running build compares by: a pre-release or dev build (`0.37.0-dev.3`) by its core,
 * so it stands where its release will. Null for anything that names no version at all.
 */
export function versionCore(v: string): string | null {
  return CORE_RE.exec(v)?.[1] ?? null;
}

/** Negative when `a` is older than `b`, zero when equal, positive when newer; both must be `X.Y.Z`. */
export function compareVersions(a: string, b: string): number {
  if (!isVersion(a) || !isVersion(b)) throw new RangeError(`not a version: ${isVersion(a) ? b : a}`);
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return (pa[i] as number) - (pb[i] as number);
  return 0;
}
