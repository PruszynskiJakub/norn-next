/**
 * A fresh agent session starts on free slot ports: what an earlier session left listening there
 * from the unit's worktree is stopped before the launch and recorded in the tick's trace.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SLOTS, type TickTrace } from "@norn/schema";
import { envNornPath, readTrace, workflowsDir } from "@norn/store";
import type { TickReport } from "../../src/index.ts";
import { createHarness, type Harness, installBundledSkills, issue } from "../../../../test/support/harness.ts";

setDefaultTimeout(30_000);

const hasLsof = Bun.spawnSync(["sh", "-c", "command -v lsof"]).exitCode === 0;

const SOLO = `name: solo
start: implement
steps:
  implement:
    type: agent
    skill: norn-implement
    outcomes: { done: { to: $done, means: "built" } }
`;

const acts = (r: TickReport) => r.decisions.map((d) => d.kind);

/** A server listening on `port`, started from `cwd` and left behind (as an agent's smoke server would be). */
async function serve(cwd: string, port: number): Promise<Bun.Subprocess> {
  const p = Bun.spawn(["bun", "-e", `Bun.serve({ port: ${port}, fetch: () => new Response("ok") }); setInterval(() => {}, 1e6);`], { cwd, stdout: "ignore", stderr: "ignore" });
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await fetch(`http://127.0.0.1:${port}/`).then(() => true, () => false)) return p;
    await Bun.sleep(20);
  }
  p.kill("SIGKILL");
  throw new Error(`server on ${port} never came up`);
}

function free(port: number): boolean {
  try {
    Bun.listen({ hostname: "0.0.0.0", port, socket: { data() {} } }).stop(true);
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!hasLsof)("an agent step's launch", () => {
  let h: Harness;
  let server: Bun.Subprocess | null = null;
  const wt = () => h.worktree("gh-9-left-a-server");

  beforeAll(async () => {
    h = await createHarness();
    h.config("provider: gh\nworkflow: solo\nmode: auto\n");
    h.write(join(workflowsDir(h.root), "solo.yaml"), SOLO);
    installBundledSkills(h.root);
    h.git(["add", "-A"]);
    h.git(["commit", "-q", "-m", "norn init"]);
    h.git(["push", "-q", "origin", "main"]);
    h.remote.issues = [issue(9, "Left a server")];
  });
  afterAll(() => {
    server?.kill("SIGKILL");
    h.cleanup();
  });

  test("stops a listener the worktree left on its slot ports, and the trace records it", async () => {
    for (let i = 0; i < 10 && !existsSync(wt()); i++) {
      h.clock.advance(10_000);
      expect(acts(await h.tick())).not.toContain("start_run");
    }
    expect(existsSync(wt())).toBe(true);
    // The slot's ports are fixed per slot and shared with real checkouts on this machine: take one free now
    const base = Number(/^PORT_BASE=(\d+)$/m.exec(readFileSync(envNornPath(wt()), "utf8"))?.[1]);
    const port = Array.from({ length: SLOTS.ports_per_slot }, (_, i) => base + i).find(free);
    if (!port) throw new Error(`no free port in ${base}..${base + SLOTS.ports_per_slot - 1}`);
    server = await serve(wt(), port);

    let launched = false;
    for (let i = 0; i < 10 && !launched; i++) {
      h.clock.advance(10_000);
      launched = acts(await h.tick()).includes("start_run");
    }
    expect(launched).toBe(true);
    expect(h.runner.launches).toHaveLength(1);
    const ticks = readTrace(h.root, { types: ["tick"] }).events as TickTrace[];
    const start = ticks.flatMap((t) => t.decisions).find((d) => d.action.kind === "start_run");
    expect(start?.result.detail).toMatchObject({ stopped_listeners: [{ pid: server.pid, port, command: expect.any(String) }] });
    expect(await server.exited).not.toBe(0);
  });
});
