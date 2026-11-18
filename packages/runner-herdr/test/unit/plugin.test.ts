import { describe, expect, test } from "bun:test";
import { memoryHost } from "@norn/conformance";
import { createRunner } from "@norn/plugin-api";
import { herdrBase, herdrRunnerFactory, herdrRunnerPlugin } from "../../src/index.ts";

describe("herdr runner plugin", () => {
  test("provides the herdr runner: attended, with pane input, on any host", () => {
    expect(herdrRunnerPlugin.provides.runners?.herdr).toBe(herdrRunnerFactory);
    const made = createRunner(herdrRunnerFactory, memoryHost(), {});
    expect(made.ok && made.value.capabilities).toEqual({ attended: true, headless: true, paneInput: true });
    expect(createRunner(herdrRunnerFactory, memoryHost(), { colour: "red" }).ok).toBe(false);
  });

  test("every herdr command starts with the binary and the configured session", () => {
    expect(herdrBase({})).toEqual(["herdr"]);
    expect(herdrBase({ bin: "/opt/herdr", session: "norn" })).toEqual(["/opt/herdr", "--session", "norn"]);
  });
});
