import { describe, expect, test } from "bun:test";
import { LAB_AGENT_COMMAND, labHarness } from "@norn/harness-lab";
import { shellQuote } from "@norn/runtime";
import { selfCommand } from "../../src/self.ts";

describe("the command a launched agent's hooks run to reach this norn", () => {
  test("run from source, it is bun and the entry script", () => {
    expect(selfCommand("/usr/local/bin/bun", "/src/norn/packages/cli/src/main.ts")).toEqual(["/usr/local/bin/bun", "/src/norn/packages/cli/src/main.ts"]);
  });

  test("installed from npm, it is bun and the bundled norn.js, never bun alone", () => {
    const script = "/home/u/.bun/install/global/node_modules/@pruszynskijakub/norn/norn.js";
    expect(selfCommand("/home/u/.bun/bin/bun", script)).toEqual(["/home/u/.bun/bin/bun", script]);
    expect(selfCommand("C:\\Users\\u\\.bun\\bin\\bun.exe", "C:\\norn\\norn.js")).toEqual(["C:\\Users\\u\\.bun\\bin\\bun.exe", "C:\\norn\\norn.js"]);
  });

  test("a compiled binary is its own program", () => {
    expect(selfCommand("/usr/local/bin/norn", "/$bunfs/root/norn")).toEqual(["/usr/local/bin/norn"]);
  });
});

describe("the lab harness runs its stand-in agent on this same norn", () => {
  // the hook command as the launcher installs it: this norn, `hook`, the harness's name
  const launched = async (self: string[], worktree: string, resume?: string) => {
    await labHarness.install({ worktree, hookCommand: shellQuote([...self, "hook", labHarness.name]) });
    return labHarness.launch({ cwd: worktree, prompt: "go", run_id: "01JAAAAAAAAAAAAAAAAAAAAAAA", env: { NORN_UNIT: "lt-1" }, headless: true, ...(resume !== undefined && { resume }) });
  };

  test("a compiled binary runs lab-agent itself, with no bun anywhere in the command", async () => {
    const spec = await launched(selfCommand("/usr/local/bin/norn", "/$bunfs/root/norn"), "/w/compiled");
    expect(spec.argv).toEqual(["/usr/local/bin/norn", LAB_AGENT_COMMAND, "--", "go"]);
    expect(spec.env).toEqual({ NORN_UNIT: "lt-1", NORN_RUN_ID: "01JAAAAAAAAAAAAAAAAAAAAAAA" });
  });

  test("run by bun, it is the same bun by its path and the same script, so no bun need be on PATH", async () => {
    const script = "/home/u/my norn/packages/cli/src/main.ts";
    const spec = await launched(selfCommand("/home/u/.bun/bin/bun", script), "/w/script");
    expect(spec.argv).toEqual(["/home/u/.bun/bin/bun", script, LAB_AGENT_COMMAND, "--", "go"]);
  });

  test("a resumed launch names the session it continues", async () => {
    const spec = await launched(["/usr/local/bin/norn"], "/w/resumed", "lab-01JAAAAAAAAAAAAAAAAAAAAAAA");
    expect(spec.argv).toEqual(["/usr/local/bin/norn", LAB_AGENT_COMMAND, "--resume", "lab-01JAAAAAAAAAAAAAAAAAAAAAAA", "--", "go"]);
  });

  test("a launch in a worktree it was never installed in is refused, as it knows no norn to run", () => {
    expect(() => labHarness.launch({ cwd: "/w/never", prompt: "go", run_id: "01JAAAAAAAAAAAAAAAAAAAAAAA", env: {} })).toThrow("not installed in /w/never");
  });
});
