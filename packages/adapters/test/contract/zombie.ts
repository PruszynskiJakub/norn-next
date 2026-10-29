/**
 * A real zombie process for the ProcessPort contract (K3, refactor plan BUG-3): a background child
 * waits on its parent's stdin; the parent execs into `sleep`, which never reaps it. The child exits
 * only once the parent is `sleep` (stdin closed then), never before: a shell reaps a child that exits
 * before its exec, and under load that left no zombie. Some platforms (or sandboxes) cannot make
 * one; `zombieUnsupported` says so once, with the reason, so suites skip instead.
 */

export interface Zombie {
  pid: number;
  /** what `ps -o lstart=` prints for it: the start time a holder would have recorded */
  lstart: string;
  stop: () => void;
}

function ps(fields: string, pid: number): string {
  return Bun.spawnSync(["ps", "-o", fields, "-p", String(pid)], { env: { ...process.env, LC_ALL: "C", LANG: "C" } })
    .stdout.toString()
    .trim();
}

/** A zombie, or the reason this platform did not make one. */
export async function makeZombie(): Promise<Zombie | string> {
  // fd 3: a non-interactive shell gives a background job /dev/null as its stdin
  const p = Bun.spawn(["sh", "-c", "exec 3<&0; read _ <&3 & echo $!; exec sleep 10"], { stdin: "pipe", stdout: "pipe" });
  const { value } = await p.stdout.getReader().read();
  const pid = Number(new TextDecoder().decode(value).trim());
  for (let i = 0; i < 100 && !/(^|\/)sleep$/.test(ps("comm=", p.pid)); i++) await Bun.sleep(20);
  p.stdin.end();
  for (let i = 0; i < 100; i++) {
    if (ps("stat=", pid).startsWith("Z")) return { pid, lstart: ps("lstart=", pid).replace(/\s+/g, " "), stop: () => p.kill() };
    await Bun.sleep(50);
  }
  const stat = ps("stat=", pid);
  p.kill();
  return `pid ${pid} has ps stat "${stat}", not Z: this platform cannot make a zombie for the test`;
}

/** Probed once per test process: null = zombies can be made, else why not. */
export const zombieUnsupported: string | null = await (async () => {
  const z = await makeZombie();
  if (typeof z === "string") return z;
  z.stop();
  return null;
})();
