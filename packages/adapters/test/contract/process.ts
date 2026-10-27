/**
 * ProcessPort contract (ports.ts; K3, MO3, R5.1): liveness by pid + start time. Every
 * implementation — the process adapter, store's `localProcess` (leases, tick lock) — must agree.
 */
import { afterAll, describe, expect, test } from "bun:test";
import type { ProcessPort } from "@norn/core";
import { type ContractOptions, contractTest } from "./suite.ts";
import { makeZombie, zombieUnsupported } from "./zombie.ts";

export type ProcessContractTest =
  | "self() names this process, is alive and stable"
  | "identify refuses what is not a pid"
  | "a live child: identify gives its start time and isAlive matches only that start time"
  | "a process that exited is gone"
  | "a zombie is not alive (K3)"
  | "findByEnv finds a live process by one env entry, never this one (R5.1)";

/** Does `ps` show this pid's environment to us (BSD `-E`, procps `e`)? Hardened systems hide it. */
function envVisible(pid: number, token: string): boolean {
  const argv = process.platform === "linux" ? ["ps", "eww", "-o", "pid=,args=", "-p", String(pid)] : ["ps", "-E", "-ww", "-o", "pid=,command=", "-p", String(pid)];
  return Bun.spawnSync(argv).stdout.toString().split(/\s+/).includes(token);
}

export function processContract(name: string, make: () => ProcessPort, opts: ContractOptions<ProcessContractTest> = {}): void {
  describe(`ProcessPort contract: ${name}`, () => {
    const children: Array<{ kill: () => void }> = [];
    afterAll(() => {
      for (const c of children) c.kill();
    });
    const sleeper = (env: Record<string, string> = {}) => {
      const p = Bun.spawn(["sleep", "30"], { env: { ...process.env, ...env }, stdout: "ignore", stderr: "ignore" });
      children.push(p);
      return p;
    };
    const t = (n: ProcessContractTest, fn: () => Promise<void>) => contractTest(opts, n, fn);

    t("self() names this process, is alive and stable", async () => {
      const port = make();
      const self = port.self();
      expect(self.pid).toBe(process.pid);
      expect(typeof self.pid_start).toBe("string");
      expect(port.self()).toEqual(self);
      expect(await port.isAlive(self)).toBe(true);
      expect(await port.identify(process.pid)).toEqual(self);
    });

    t("identify refuses what is not a pid", async () => {
      const port = make();
      for (const pid of [0, -1, 1.5, Number.NaN]) expect(await port.identify(pid)).toBeNull();
    });

    t("a live child: identify gives its start time and isAlive matches only that start time", async () => {
      const port = make();
      const child = sleeper();
      const id = await port.identify(child.pid);
      expect(id).not.toBeNull();
      expect(id!.pid).toBe(child.pid);
      expect(id!.pid_start.length).toBeGreaterThan(0);
      expect(await port.isAlive(id!)).toBe(true);
      // a reused pid: same number, another start time — never the original process (K3)
      expect(await port.isAlive({ pid: child.pid, pid_start: "Thu Jan 1 00:00:00 1970" })).toBe(false);
    });

    t("a process that exited is gone", async () => {
      const port = make();
      const child = sleeper();
      const id = await port.identify(child.pid);
      expect(id).not.toBeNull();
      child.kill();
      await child.exited;
      expect(await port.identify(child.pid)).toBeNull();
      expect(await port.isAlive(id!)).toBe(false);
    });

    if (zombieUnsupported) {
      console.warn(`ProcessPort contract (${name}): zombie test skipped: ${zombieUnsupported}`);
      test.skip(`a zombie is not alive (K3) [skipped: ${zombieUnsupported}]`, () => {});
    } else {
      t("a zombie is not alive (K3)", async () => {
        const port = make();
        const z = await makeZombie();
        if (typeof z === "string") throw new Error(z);
        try {
          expect(await port.identify(z.pid)).toBeNull();
          expect(await port.isAlive({ pid: z.pid, pid_start: z.lstart })).toBe(false);
        } finally {
          z.stop();
        }
      });
    }

    t("findByEnv finds a live process by one env entry, never this one (R5.1)", async () => {
      const port = make();
      if (!port.findByEnv) return; // optional: a port without it never finds any
      const value = `contract-${process.pid}-${Math.random().toString(36).slice(2)}`;
      const child = sleeper({ NORN_CONTRACT_PROBE: value });
      await Bun.sleep(100);
      const found = await port.findByEnv("NORN_CONTRACT_PROBE", value);
      if (envVisible(child.pid, `NORN_CONTRACT_PROBE=${value}`)) {
        expect(found.map((p) => p.pid)).toEqual([child.pid]);
        expect(found[0]).toEqual((await port.identify(child.pid))!);
      } else {
        // the OS hides other processes' environment here (e.g. macOS with SIP): never a false match
        expect(found).toEqual([]);
      }
      expect(await port.findByEnv("NORN_CONTRACT_PROBE", `${value}-other`)).toEqual([]);
    });
  });
}
