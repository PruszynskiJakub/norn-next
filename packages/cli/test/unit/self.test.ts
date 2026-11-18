import { describe, expect, test } from "bun:test";
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
