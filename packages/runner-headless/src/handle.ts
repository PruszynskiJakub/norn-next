/**
 * A headless run's handle: the pid and the start marker the host gave it, so a pid the OS hands out
 * again later is never taken for the run's process. `<pid>@<started>`; the marker is opaque and may
 * hold spaces or `@`, so only the first `@` splits.
 */
export interface HeadlessHandle {
  pid: number;
  started: string;
}

export function encodeHandle(h: HeadlessHandle): string {
  return `${h.pid}@${h.started}`;
}

/** The handle's parts, or null for a string no headless start made. */
export function decodeHandle(handle: string): HeadlessHandle | null {
  const at = handle.indexOf("@");
  if (at < 1) return null;
  const pid = Number(handle.slice(0, at));
  const started = handle.slice(at + 1);
  if (!Number.isInteger(pid) || pid < 1 || String(pid) !== handle.slice(0, at) || started === "") return null;
  return { pid, started };
}
