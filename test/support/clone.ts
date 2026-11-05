/**
 * Seam S1 (gh-195): another machine on the harness's remote — its own clone, norn home, user@machine and
 * runner, sharing the harness's bare remote, fake issue provider and clock.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { RunnerPort } from "@norn/core";
import { bindNornHome } from "@norn/store";
import type { CliDeps, CliResult, TickReport } from "../../packages/cli/src/index.ts";
import { FakeRunner, type Harness, hostEnv, runChecked, sh } from "./harness.ts";

export interface Clone {
  root: string;
  home: string;
  runner: FakeRunner;
  norn(...argv: string[]): Promise<CliResult>;
  /** a command run from `cwd` (a worktree of this clone) */
  at(cwd: string, ...argv: string[]): Promise<CliResult>;
  /** one `norn tick`; throws unless it exits 0 */
  tick(...flags: string[]): Promise<TickReport>;
}

/** Clone `h.remoteDir` into `<h.dir>/<name>` as `<user>@<name>`, with its own norn home `<h.dir>/home-<name>`. */
export function cloneOf(h: Harness, name: string, user: string): Clone {
  const root = join(h.dir, name);
  sh(h.dir, ["clone", "-q", h.remoteDir, root]);
  sh(root, ["config", "user.email", `${user}@example.com`]);
  sh(root, ["config", "user.name", user]);
  const home = join(h.dir, `home-${name}`);
  mkdirSync(home);
  bindNornHome(root, home);
  const runner = new FakeRunner();
  (runner as { name: string }).name = `fake-${name}`;
  const deps: CliDeps = {
    cwd: root,
    env: { ...hostEnv(), NORN_HOME_DIR: home, USER: user, NORN_MACHINE: name, NORN_HOOK_COMMAND: "norn hook" },
    clock: h.clock,
    ports: { remote: h.remote, runner: runner as RunnerPort, notifiers: [] },
  };
  return {
    root,
    home,
    runner,
    norn: (...argv) => runChecked(argv, deps),
    at: (cwd, ...argv) => runChecked(argv, { ...deps, cwd }),
    async tick(...flags) {
      const r = await runChecked(["tick", ...flags], deps);
      if (r.exit !== 0) throw new Error(`tick failed: ${r.stdout}`);
      return r.value as TickReport;
    },
  };
}
