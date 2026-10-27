/**
 * RunnerPort contract (ports.ts; R4.1, R5.1, MO5, C2): what decide and act may assume of any
 * runner — the headless adapter, the harness's FakeRunner, and any third-party runner (X2).
 * `make` returns a fresh runner; `cwd` is a directory a session may run in.
 */
import { describe, expect } from "bun:test";
import type { LaunchSpec, RunnerPort } from "@norn/core";
import { type ContractOptions, contractTest, expectPortError } from "./suite.ts";

export type RunnerContractTest =
  | "name and capabilities are well-formed; openForPerson is present iff capabilities.open (MO5)"
  | "available() answers a boolean"
  | "launch returns a session of this runner that is alive, and its pane state says so"
  | "kill ends the session, and killing it again is harmless"
  | "send delivers when capabilities.send, else rejects with a PortError (R4.1)"
  | "reach and output, when present, answer a string (output: or null)"
  | "findSessions, when present, reports only sessions of this runner (R5.1)";

export interface RunnerSubject {
  runner: RunnerPort;
  /** directory a launched session runs in */
  cwd: string;
}

const PANE_STATES = ["working", "idle", "waiting_input", "done", "unknown"];

export function runnerContract(name: string, make: () => RunnerSubject, opts: ContractOptions<RunnerContractTest> = {}): void {
  describe(`RunnerPort contract: ${name}`, () => {
    const t = (n: RunnerContractTest, fn: () => Promise<void>) => contractTest(opts, n, fn);
    let n = 0;
    const spec = (cwd: string): LaunchSpec => {
      const run_id = `01CONTRACT${process.pid}X${++n}`;
      return { cwd, argv: ["sh", "-c", "exec sleep 30"], env: { NORN_RUN: run_id, NORN_STORY: "gh-1", NORN_SLICE: "01-contract" }, title: "gh-1/01 contract", run_id };
    };

    t("name and capabilities are well-formed; openForPerson is present iff capabilities.open (MO5)", async () => {
      const { runner } = make();
      expect(typeof runner.name).toBe("string");
      expect(runner.name.length).toBeGreaterThan(0);
      expect(typeof runner.capabilities.send).toBe("boolean");
      expect(typeof runner.capabilities.resume).toBe("boolean");
      expect(runner.openForPerson !== undefined).toBe(runner.capabilities.open === true);
    });

    t("available() answers a boolean", async () => {
      expect(typeof (await make().runner.available())).toBe("boolean");
    });

    t("launch returns a session of this runner that is alive, and its pane state says so", async () => {
      const { runner, cwd } = make();
      const s = await runner.launch(spec(cwd));
      try {
        expect(s.runner).toBe(runner.name);
        expect(typeof s.session_id).toBe("string");
        expect(s.session_id.length).toBeGreaterThan(0);
        expect(await runner.isAlive(s)).toBe(true);
        const pane = await runner.paneState(s);
        expect(pane.alive).toBe(true);
        expect(PANE_STATES).toContain(pane.state);
        expect(pane.since === null || typeof pane.since === "number").toBe(true);
      } finally {
        await runner.kill(s);
      }
    });

    t("kill ends the session, and killing it again is harmless", async () => {
      const { runner, cwd } = make();
      const s = await runner.launch(spec(cwd));
      await runner.kill(s);
      expect(await runner.isAlive(s)).toBe(false);
      expect((await runner.paneState(s)).alive).toBe(false);
      await runner.kill(s);
    });

    t("send delivers when capabilities.send, else rejects with a PortError (R4.1)", async () => {
      const { runner, cwd } = make();
      const s = await runner.launch(spec(cwd));
      try {
        const sent = runner.send(s, "hello", { submit: true });
        if (runner.capabilities.send) await sent;
        else expectPortError(await sent.then(() => null, (e: unknown) => e));
      } finally {
        await runner.kill(s);
      }
    });

    t("reach and output, when present, answer a string (output: or null)", async () => {
      const { runner, cwd } = make();
      const s = await runner.launch(spec(cwd));
      try {
        if (runner.reach) expect(typeof runner.reach(s)).toBe("string");
        if (runner.output) {
          const out = await runner.output(s);
          expect(out === null || typeof out === "string").toBe(true);
        }
      } finally {
        await runner.kill(s);
      }
    });

    t("findSessions, when present, reports only sessions of this runner (R5.1)", async () => {
      const { runner, cwd } = make();
      if (!runner.findSessions) return; // optional: a runner without it finds nothing
      const s = await runner.launch(spec(cwd));
      try {
        for (const q of [{ run_id: "01CONTRACTNOSUCHRUN", cwd: `${cwd}/nowhere` }, { run_id: s.session_id, cwd }]) {
          const found = await runner.findSessions(q);
          expect(Array.isArray(found)).toBe(true);
          for (const f of found) expect(f.session.runner).toBe(runner.name);
        }
        expect(await runner.findSessions({ run_id: "01CONTRACTNOSUCHRUN", cwd: `${cwd}/nowhere` })).toEqual([]);
      } finally {
        await runner.kill(s);
      }
    });
  });
}
