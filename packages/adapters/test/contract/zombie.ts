/**
 * A real zombie process for the ProcessPort contract (K3, refactor plan BUG-3): a short `sleep`
 * runs in the background and exits after its parent has exec'd into `sleep`, which never reaps it.
 * (A child that exits at once can be reaped by `sh` itself before the exec on a loaded machine.)
 * Some platforms (or sandboxes) cannot make one; `zombieSupport` says so once, with the reason, so suites skip instead.
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
  const p = Bun.spawn(["sh", "-c", "sleep 0.3 & echo $!; exec sleep 10"], { stdout: "pipe" });
  const { value } = await p.stdout.getReader().read();
  const pid = Number(new TextDecoder().decode(value).trim());
  for (let i = 0; i < 40; i++) {
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
