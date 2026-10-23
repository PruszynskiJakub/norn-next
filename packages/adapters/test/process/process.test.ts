import { describe, expect, test } from "bun:test";
import { createProcessPort, parseStart, psStartArgv } from "../../src/process/index.ts";
import { shellJoin } from "../../src/process/exec.ts";

describe("process port", () => {
  test("parses `ps -o stat= -o lstart=`; gone or zombie → null", () => {
    expect(psStartArgv(42)).toEqual(["ps", "-o", "stat=", "-o", "lstart=", "-p", "42"]);
    expect(parseStart("Ss   Fri Oct 23 16:21:19 2026   \n", 0)).toBe("Fri Oct 23 16:21:19 2026");
    expect(parseStart("", 1)).toBeNull();
    expect(parseStart("Z+   Fri Oct 23 16:21:19 2026\n", 0)).toBeNull();
  });

  test("isAlive needs the same start time (pid reuse is dead)", async () => {
    const port = createProcessPort({ exec: async () => ({ code: 0, stdout: "S Fri Oct 23 10:00:00 2026\n", stderr: "" }) });
    expect(await port.isAlive({ pid: 9, pid_start: "Fri Oct 23 10:00:00 2026" })).toBe(true);
    expect(await port.isAlive({ pid: 9, pid_start: "Thu Oct 22 10:00:00 2026" })).toBe(false);
  });

  test("real: self is alive, a bogus pid is not", async () => {
    const port = createProcessPort();
    const me = port.self();
    expect(me.pid).toBe(process.pid);
    expect(await port.isAlive(me)).toBe(true);
    expect(await port.identify(99_999_999)).toBeNull();
  });

  test("shellJoin quotes only what needs it", () => {
    expect(shellJoin(["claude", "-p", "it's `x`", "a=b"])).toBe(`claude -p 'it'\\''s \`x\`' a=b`);
  });
});
