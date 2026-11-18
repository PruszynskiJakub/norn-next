/**
 * Real git for the refs store: a bare repo stands in for the team's remote, and each clone is a
 * machine. `failing` makes every git call fail, as an unreachable remote and a broken disk would.
 */
import { afterAll } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { manualClock, type StoreWorld } from "@norn/conformance";
import { createNodeHost } from "@norn/host-node";
import type { HostContext, Store } from "@norn/plugin-api";
import { createRefsStore, type RefsStoreConfig } from "../../src/index.ts";

export const START = "2026-11-17T10:00:00.000Z";

const made: string[] = [];
afterAll(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

export async function git(cwd: string, ...args: string[]): Promise<string> {
  const host = createNodeHost({ root: cwd, dataDir: cwd });
  const out = await host.exec(["git", ...args], { cwd });
  if (out.code !== 0) throw new Error(`git ${args.join(" ")} in ${cwd}: ${out.stderr}`);
  return out.stdout;
}

export interface Team {
  dir: string;
  remote: string;
  /** a new clone of the remote, as one more machine; `name` is its folder */
  clone(name: string): Promise<string>;
}

export async function team(): Promise<Team> {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "norn-store-refs-")));
  made.push(dir);
  const remote = join(dir, "remote.git");
  await git(dir, "init", "-q", "--bare", remote);
  return {
    dir,
    remote,
    clone: async (name) => {
      const path = join(dir, name);
      await git(dir, "init", "-q", path);
      await git(path, "remote", "add", "origin", remote);
      return path;
    },
  };
}

export interface Machine {
  path: string;
  ctx: HostContext;
  store: Store;
  now(): string;
  advance(ms: number): void;
  failing(on: boolean): void;
}

export function machine(path: string, config: RefsStoreConfig = {}): Machine {
  let down = false;
  const clock = manualClock(START);
  const host = createNodeHost({ root: path, dataDir: `${path}-machine` });
  const ctx: HostContext = {
    ...host,
    now: clock.now,
    exec: async (argv, opts) => (down ? { code: 128, stdout: "", stderr: "fatal: unreachable (injected)", timedOut: false } : host.exec(argv, opts)),
  };
  return {
    path,
    ctx,
    store: createRefsStore(ctx, config),
    now: clock.now,
    advance: clock.advance,
    failing: (on) => {
      down = on;
    },
  };
}

export async function refsWorld(): Promise<StoreWorld & { machine: Machine; team: Team }> {
  const t = await team();
  const m = machine(await t.clone("a"));
  return {
    store: m.store,
    twin: () => createRefsStore(m.ctx),
    now: m.now,
    advance: m.advance,
    failing: m.failing,
    machine: m,
    team: t,
  };
}
