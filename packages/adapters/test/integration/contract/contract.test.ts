/**
 * Port contract suites (refactor plan 0.4) against the real adapters, offline: real processes,
 * real git repos, the headless runner on real processes, and gh/glab over scripted CLIs. The
 * harness fakes run the same suites in packages/cli/test/contract-fakes.test.ts (the fakes live in
 * @norn/cli's tests, so the dependency stays cli → adapters). Herdr is not here: its contract
 * needs a herdr server.
 */
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localProcess } from "@norn/store";
import { createGh } from "../../../src/gh/index.ts";
import { createGit } from "../../../src/git/index.ts";
import { createGlab } from "../../../src/glab/index.ts";
import { createHeadlessRunner } from "../../../src/headless/index.ts";
import { createProcessPort } from "../../../src/process/index.ts";
import { GIT_ENV, gitContract } from "../../contract/git.ts";
import { processContract } from "../../contract/process.ts";
import { remoteContract } from "../../contract/remote.ts";
import { scriptedGh, scriptedGlab } from "../../contract/remote-cli.ts";
import { runnerContract } from "../../contract/runner.ts";
import { makeZombie, zombieUnsupported } from "../../contract/zombie.ts";

processContract("process adapter (createProcessPort)", () => createProcessPort());
// store's own ProcessPort guards leases and the tick lock (K3, H1)
processContract("store localProcess", () => localProcess);

// the zombie the K3 test needs is made even under load: the shell must not reap it before its exec
test.skipIf(zombieUnsupported !== null)("makeZombie: 60 at once are all zombies", async () => {
  const made = await Promise.all(Array.from({ length: 60 }, () => makeZombie()));
  for (const z of made) if (typeof z !== "string") z.stop();
  expect(made.filter((z) => typeof z === "string")).toEqual([]);
});

gitContract("git adapter (createGit)", () => createGit({ env: GIT_ENV }));

runnerContract("headless runner", () => {
  const dir = mkdtempSync(join(tmpdir(), "norn-runner-contract-"));
  return { runner: createHeadlessRunner({ logDir: join(dir, "trace"), killGraceMs: 2000 }), cwd: dir };
});

remoteContract("gh adapter over a scripted gh", () => {
  const cli = scriptedGh();
  return { port: createGh({ cwd: "/repo", exec: cli.exec }), seed: cli.seed, failLabelEdits: cli.failLabelEdits };
});
remoteContract("glab adapter over a scripted glab", () => {
  const cli = scriptedGlab();
  return { port: createGlab({ cwd: "/repo", exec: cli.exec }), seed: cli.seed, failLabelEdits: cli.failLabelEdits };
});
