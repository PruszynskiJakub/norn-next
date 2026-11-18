import { describe, expect, test } from "bun:test";
import { memoryHost } from "@norn/conformance";
import { createRunner } from "@norn/plugin-api";
import { decodeHandle, encodeHandle, headlessRunnerFactory, headlessRunnerPlugin } from "../../src/index.ts";

const procs = { spawn: async () => ({ pid: 7, started: "Tue Nov 17 10:00:00 2026" }), alive: async () => true, kill: async () => {} };

describe("headless runner plugin", () => {
  test("provides the headless runner, which needs a host that starts processes", () => {
    expect(headlessRunnerPlugin.provides.runners?.headless).toBe(headlessRunnerFactory);
    const refused = createRunner(headlessRunnerFactory, memoryHost(), {});
    expect(!refused.ok && refused.failure.message).toBe("runner needs a host that starts processes; this host lacks spawn, alive, kill");
    const made = createRunner(headlessRunnerFactory, { ...memoryHost(), ...procs }, {});
    expect(made.ok && made.value.capabilities).toEqual({ attended: false, headless: true, paneInput: false });
  });

  test("send is refused: a headless run has no pane", async () => {
    const made = createRunner(headlessRunnerFactory, { ...memoryHost(), ...procs }, {});
    if (!made.ok) throw new Error(made.failure.message);
    expect(await made.value.send("7@x", "hi")).toEqual({ ok: false, failure: { code: "invalid", message: "a headless run has no pane to type into", retryable: false } });
  });
});

describe("headless handle", () => {
  test("round-trips a start marker holding spaces and @", () => {
    const h = { pid: 4242, started: "Tue Nov 17 10:00:00 2026 @x" };
    expect(decodeHandle(encodeHandle(h))).toEqual(h);
  });
  test("a string no headless start made decodes to null", () => {
    for (const s of ["", "@x", "0@x", "-1@x", "01@x", "12@", "abc@x", "12"]) expect({ s, h: decodeHandle(s) }).toEqual({ s, h: null });
  });
});
