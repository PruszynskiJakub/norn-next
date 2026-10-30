/**
 * K4.1: a process an agent left behind (a dev or smoke server started from inside the worktree)
 * keeps listening on the worktree's slot ports after its run ended, and the next check fails with
 * "address in use". Before a check, norn stops every listener on the slot's ports whose working
 * directory is inside the worktree; a listener started anywhere else is left alone. Best effort:
 * without `lsof` nothing is stopped.
 */
import { realpathSync } from "node:fs";
import { sep } from "node:path";

export interface StoppedListener {
  pid: number;
  port: number;
  command: string;
}

async function lsof(args: string[]): Promise<string> {
  try {
    const p = Bun.spawn(["lsof", ...args], { stdout: "pipe", stderr: "ignore" });
    const out = await new Response(p.stdout).text();
    await p.exited;
    return out;
  } catch {
    return "";
  }
}

/** `lsof -F` output: one field per line, `p<pid>` opens a process, then `c<command>`, `n<name>`, … */
function fields(out: string): Array<Record<string, string[]>> {
  const procs: Array<Record<string, string[]>> = [];
  for (const line of out.split("\n")) {
    if (!line) continue;
    const tag = line[0] as string;
    const value = line.slice(1);
    if (tag === "p") {
      procs.push({ p: [value] });
      continue;
    }
    const cur = procs.at(-1);
    if (cur) (cur[tag] ??= []).push(value);
  }
  return procs;
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export async function stopStrayListeners(worktree: string, ports: { from: number; to: number }, graceMs = 2_000): Promise<StoppedListener[]> {
  let root: string;
  try {
    root = realpathSync(worktree);
  } catch {
    return [];
  }
  const listeners = fields(await lsof(["-nP", `-iTCP:${ports.from}-${ports.to}`, "-sTCP:LISTEN", "-Fpcn"]));
  const strays: StoppedListener[] = [];
  for (const l of listeners) {
    const pid = Number(l.p?.[0]);
    if (!pid || pid === process.pid) continue;
    const cwd = fields(await lsof(["-a", "-p", String(pid), "-d", "cwd", "-Fn"]))[0]?.n?.[0];
    if (!cwd || (cwd !== root && !cwd.startsWith(root + sep))) continue;
    const port = Number(l.n?.map((n) => n.slice(n.lastIndexOf(":") + 1)).find((p) => Number(p) >= ports.from && Number(p) <= ports.to));
    strays.push({ pid, port, command: l.c?.[0] ?? "?" });
  }
  for (const s of strays) {
    try {
      process.kill(s.pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
  const deadline = Date.now() + graceMs;
  while (strays.some((s) => alive(s.pid)) && Date.now() < deadline) await Bun.sleep(50);
  for (const s of strays) {
    try {
      if (alive(s.pid)) process.kill(s.pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
  return strays;
}
