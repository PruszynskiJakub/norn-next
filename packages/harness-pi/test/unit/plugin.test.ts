import { describe, expect, test } from "bun:test";
import { RUN_ENV } from "@norn/plugin-api";
import { piHarness, piPlugin } from "../../src/index.ts";

const REQ = { cwd: "/repo/.worktrees/gh-12", prompt: "Use the norn skill, then run `norn brief`.", run_id: "run-1", env: { PATH: "/usr/bin", [RUN_ENV.unit]: "gh-12" } };

describe("pi launch", () => {
  test("pi --approve -- <prompt>, with the run in the env and the unit passed through", () => {
    expect(piHarness.launch(REQ)).toEqual({ argv: ["pi", "--approve", "--", REQ.prompt], env: { PATH: "/usr/bin", [RUN_ENV.unit]: "gh-12", [RUN_ENV.run]: "run-1" } });
  });
  test("model, resume and extra args come before --, so a variadic flag cannot take the prompt", () => {
    const spec = piHarness.launch({ ...REQ, model: "sonnet:high", resume: "0199-pi", args: ["--tools", "read,bash"] });
    expect(spec.argv).toEqual(["pi", "--approve", "--model", "sonnet:high", "--session-id", "0199-pi", "--tools", "read,bash", "--", REQ.prompt]);
  });
  test("a resume with no prompt passes none", () => {
    expect(piHarness.launch({ ...REQ, prompt: "", resume: "0199-pi" }).argv).toEqual(["pi", "--approve", "--session-id", "0199-pi"]);
  });
  test("headless launches print mode, still before --", () => {
    expect(piHarness.launch({ ...REQ, headless: true }).argv).toEqual(["pi", "--approve", "-p", "--", REQ.prompt]);
  });
  test("the caller's env cannot override the run id", () => {
    expect(piHarness.launch({ ...REQ, env: { [RUN_ENV.run]: "other" } }).env[RUN_ENV.run]).toBe("run-1");
  });
});

describe("pi plugin", () => {
  test("provides the pi harness under its name, frozen", () => {
    expect(piPlugin.name).toBe("norn-harness-pi");
    expect(piPlugin.api).toBe("^1");
    expect(piPlugin.provides.harness?.pi).toBe(piHarness);
    expect(Object.isFrozen(piPlugin)).toBe(true);
    expect(Object.isFrozen(piHarness.capabilities)).toBe(true);
  });
  test("declares what pi's extension events can do: no subagents and no limits reported", () => {
    expect(piHarness.name).toBe("pi");
    expect(piHarness.capabilities).toEqual({ blockStop: true, denyTool: true, injectContext: true, subagents: false, limits: false, paneInput: true, promptMarks: true, resume: true });
  });
});
