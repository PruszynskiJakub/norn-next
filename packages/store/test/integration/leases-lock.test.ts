import { describe, expect, test } from "bun:test";
import { localProcess } from "../../src/index.ts";

describe("process liveness", () => {
  test("self is alive; wrong start time is not", async () => {
    const me = localProcess.self();
    expect(await localProcess.isAlive(me)).toBe(true);
    expect(await localProcess.isAlive({ ...me, pid_start: "nope" })).toBe(false);
    expect(await localProcess.identify(999_999)).toBeNull();
  });
});
