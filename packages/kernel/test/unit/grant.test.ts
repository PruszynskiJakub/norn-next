import { describe, expect, test } from "bun:test";
import { codeLevelOf, docsOnlyGrant, grantOf } from "../../src/index.ts";

const roles = {
  builder: ["code:write", "docs:write", "exec:any"],
  reviewer: ["code:read", "docs:write", "exec:checks", "out:findings"],
  qa: ["code:scratch", "exec:any", "out:criteria", "out:evidence", "out:findings"],
  writer: ["docs:write"],
} as const;

describe("the effective grant of an agent step", () => {
  test("is the role's capabilities when the step narrows nothing and the policy caps nothing", () => {
    expect(grantOf({ role: "builder" }, { roles })).toEqual(["code:write", "docs:write", "exec:any"]);
  });

  test("is narrowed by the step's allow: and never widened by it", () => {
    expect(grantOf({ role: "builder", allow: ["docs:write"] }, { roles })).toEqual(["docs:write"]);
    expect(grantOf({ role: "writer", allow: ["docs:write", "code:write"] }, { roles })).toEqual(["docs:write"]);
  });

  test("is capped by the person's policy", () => {
    expect(grantOf({ role: "builder" }, { roles, capabilities: ["docs:write", "exec:any"] })).toEqual(["docs:write", "exec:any"]);
  });

  test("is empty for a role the registry does not hold, so the step keeps the least", () => {
    expect(grantOf({ role: "stranger" }, { roles })).toEqual([]);
  });

  test("is null for a step in the older form or a host with no role registry: nothing is narrowed", () => {
    expect(grantOf({}, { roles })).toBeNull();
    expect(grantOf({ role: "builder" }, {})).toBeNull();
  });
});

describe("the code level a grant leaves", () => {
  test("is write, scratch or read by the strongest code capability, and read when it names none", () => {
    expect(codeLevelOf(["code:write", "code:scratch"])).toBe("write");
    expect(codeLevelOf(["code:scratch", "exec:any"])).toBe("scratch");
    expect(codeLevelOf(["code:read"])).toBe("read");
    expect(codeLevelOf(["docs:write"])).toBe("read");
    expect(codeLevelOf(null)).toBe("write");
  });

  test("a grant that may change no code file is held by the docs-only guard; scratch is not, as it is reset", () => {
    expect(docsOnlyGrant(["code:read", "docs:write"])).toBe(true);
    expect(docsOnlyGrant(["docs:write"])).toBe(true);
    expect(docsOnlyGrant(["code:scratch"])).toBe(false);
    expect(docsOnlyGrant(["code:write"])).toBe(false);
    expect(docsOnlyGrant(null)).toBe(false);
  });
});
