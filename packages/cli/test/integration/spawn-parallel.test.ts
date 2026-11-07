/**
 * Regression for a flaky hang: under `bun test --parallel` (bun 1.3.13), a child started
 * with node's `child_process.spawn` in a freshly isolated test file sometimes never emits `exit`, `close`
 * or `error`, so a call that waits for it hangs until the test times out (1–4 % of files). store's
 * `spawnBounded` and cli's `runShell` start children with `Bun.spawn`, which always reports the exit.
 * The test runs a `--parallel` bun over many tiny files, each making its first spawn, and wants every
 * file to pass: on the old code, at least one of 200 files hung in each of 6 runs.
 */
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnBounded } from "@norn/store";

const FILES = 200;
const STORE_SPAWN = resolve(import.meta.dir, "../../../store/src/spawn.ts");
const CLI_SHELL = resolve(import.meta.dir, "../../src/runtime/shell.ts");

const dir = realpathSync(mkdtempSync(join(tmpdir(), "norn-spawn-parallel-")));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("the first spawn in each isolated test file always reports its exit", async () => {
  for (let i = 0; i < FILES; i++) {
    const body =
      i % 2 === 0
        ? `import { spawnBounded } from ${JSON.stringify(STORE_SPAWN)};\n` +
          `test("spawnBounded", async () => { expect((await spawnBounded(["true"], { unobserved: true })).code).toBe(0); }, 5000);\n`
        : `import { runShell } from ${JSON.stringify(CLI_SHELL)};\n` +
          `test("runShell", async () => { expect((await runShell("true", { cwd: "/", env: process.env, timeoutMs: 60000 })).exit_code).toBe(0); }, 5000);\n`;
    writeFileSync(join(dir, `s${i}.test.ts`), `import { expect, test } from "bun:test";\n${body}`);
  }
  const r = await spawnBounded([process.execPath, "test", "--parallel", dir], { cwd: dir, timeoutMs: 120_000 });
  const summary = `${r.stdout}\n${r.stderr}`;
  expect(summary).toContain(` ${FILES} pass`);
  expect(summary).not.toContain("timed out");
  expect(r.code).toBe(0);
}, 150_000);
