/** The detached check's wrapper as `sh` runs it: the exit file, then the wake stamp a pausing watch reads. */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHECK_WAKE_WRITER, checkWrapperArgv, wakeWriterOf } from "../../src/index.ts";

describe("the check wrapper", () => {
  test("a command's exit leaves the exit file, then a stamp under the check writer naming it", () => {
    const dir = mkdtempSync(join(tmpdir(), "norn-wrapper-"));
    const exitPath = join(dir, "exits", "run-1.json");
    const wake = join(dir, "runtime", "wake");
    const r = Bun.spawnSync(checkWrapperArgv("exit 3", exitPath, wake));
    expect(r.exitCode).toBe(0);
    expect(JSON.parse(readFileSync(exitPath, "utf8"))).toMatchObject({ exit: 3 });
    const stamp = readFileSync(wake, "utf8").trim();
    expect(wakeWriterOf(stamp)).toBe(CHECK_WAKE_WRITER);
    expect(stamp).toContain(exitPath);
  });
});
