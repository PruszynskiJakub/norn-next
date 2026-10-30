import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createProcessPort, parseEnvMatches, parseStart, psEnvArgv, psStartArgv } from "../../src/process/index.ts";
import { shellJoin } from "../../src/exec.ts";

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

describe("process port: find by env (R5.1)", () => {
  const ps = readFileSync(join(import.meta.dir, "fixtures/ps-env-darwin.txt"), "utf8");

  test("argv per platform: BSD `-E`, procps `e`", () => {
    expect(psEnvArgv("darwin")).toEqual(["ps", "-A", "-E", "-ww", "-o", "pid=,command="]);
    expect(psEnvArgv("linux")).toEqual(["ps", "axeww", "-o", "pid=,args="]);
  });

  test("matches the whole NAME=value token only", () => {
    expect(parseEnvMatches(ps, "NORN_RUN", "01JRUNAAAAAAAAAAAAAAAAAAAA")).toEqual([59610]);
    expect(parseEnvMatches(ps, "NORN_RUN", "01JRUNBBBBBBBBBBBBBBBBBBBB")).toEqual([59611]);
    expect(parseEnvMatches(ps, "NORN_RUN", "01JRUNCCCCCCCCCCCCCCCCCCCC")).toEqual([]);
  });

  test("findByEnv identifies each match; a failing ps finds nothing", async () => {
    const calls: string[][] = [];
    const port = createProcessPort({
      platform: "darwin",
      selfPid: 1,
      exec: async (argv) => {
        calls.push(argv);
        if (argv.includes("-E")) return { code: 0, stdout: ps, stderr: "" };
        return { code: 0, stdout: "S Fri Oct 23 10:00:00 2026\n", stderr: "" };
      },
    });
    expect(await port.findByEnv?.("NORN_RUN", "01JRUNAAAAAAAAAAAAAAAAAAAA")).toEqual([{ pid: 59610, pid_start: "Fri Oct 23 10:00:00 2026" }]);
    expect(calls[0]).toEqual(psEnvArgv("darwin"));
    const broken = createProcessPort({ exec: async () => ({ code: 1, stdout: "", stderr: "ps: not permitted" }) });
    expect(await broken.findByEnv?.("NORN_RUN", "x")).toEqual([]);
  });
});
