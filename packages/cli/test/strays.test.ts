import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stopStrayListeners } from "../src/runtime/strays.ts";

const hasLsof = Bun.spawnSync(["sh", "-c", "command -v lsof"]).exitCode === 0;
const procs: Bun.Subprocess[] = [];
const dirs: string[] = [];

afterEach(() => {
  for (const p of procs.splice(0)) p.kill("SIGKILL");
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "norn-strays-"));
  dirs.push(d);
  return d;
}

/** A server listening on `port`, started from `cwd` and left behind (as an agent's smoke server would be). */
async function serve(cwd: string, port: number): Promise<Bun.Subprocess> {
  const p = Bun.spawn(["bun", "-e", `Bun.serve({ port: ${port}, fetch: () => new Response("ok") }); setInterval(() => {}, 1e6);`], { cwd, stdout: "ignore", stderr: "ignore" });
  procs.push(p);
  for (let i = 0; i < 100; i++) {
    if (await fetch(`http://127.0.0.1:${port}/`).then(() => true, () => false)) return p;
    await Bun.sleep(20);
  }
  throw new Error(`server on ${port} never came up`);
}

const freePort = () => 45_000 + Math.floor(Math.random() * 10_000);

describe.skipIf(!hasLsof)("stray listeners on a slot's ports (K4.1)", () => {
  test("a server started from the worktree, listening on its slot's ports, is stopped and reported", async () => {
    const wt = tempDir();
    const port = freePort();
    const p = await serve(wt, port);
    const stopped = await stopStrayListeners(wt, { from: port - 2, to: port + 2 });
    expect(stopped).toEqual([expect.objectContaining({ pid: p.pid, port })]);
    expect(await p.exited).not.toBe(0);
  });

  test("a listener started elsewhere is left alone", async () => {
    const wt = tempDir();
    const port = freePort();
    const p = await serve(tempDir(), port);
    expect(await stopStrayListeners(wt, { from: port, to: port })).toEqual([]);
    expect(p.exitCode).toBeNull();
  });
});
