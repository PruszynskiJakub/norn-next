/**
 * The port contract suites (packages/adapters/test/contract/, refactor plan 0.4) against the
 * harness fakes, so a scenario test never leans on a fake doing what no real port would. The
 * harness fakes only what leaves the machine: RunnerPort and RemotePort (ProcessPort and GitPort
 * are the real adapters there, covered by the adapters' own contract run).
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RemoteIssue } from "@norn/core";
import { remoteContract } from "../../../adapters/test/contract/remote.ts";
import { runnerContract } from "../../../adapters/test/contract/runner.ts";
import { FakeRemote, FakeRunner, T0 } from "../../../../test/support/harness.ts";

runnerContract("harness FakeRunner", () => ({ runner: new FakeRunner(), cwd: mkdtempSync(join(tmpdir(), "norn-fake-runner-")) }), {
  failing: {
    "kill ends the session, and killing it again is harmless":
      "FakeRunner.kill only records the session; isAlive/paneState keep answering `pane.alive`, which tests set by hand",
  },
});

remoteContract("harness FakeRemote", () => {
  const remote = new FakeRemote();
  return {
    port: remote,
    seed(issues) {
      remote.issues = issues.map(
        (i): RemoteIssue => ({ provider: "gh", url: `https://github.com/o/r/issues/${i.number}`, updated_at: new Date(T0).toISOString(), ...i }),
      );
    },
  };
});
