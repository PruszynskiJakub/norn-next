import { describe, expect, test } from "bun:test";
import { createProcessPort } from "../../../src/process/index.ts";

describe("process port", () => {
  test("real: self is alive, a bogus pid is not", async () => {
    const port = createProcessPort();
    const me = port.self();
    expect(me.pid).toBe(process.pid);
    expect(await port.isAlive(me)).toBe(true);
    expect(await port.identify(99_999_999)).toBeNull();
  });
});
