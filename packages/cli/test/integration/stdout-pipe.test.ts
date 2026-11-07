/** Stdout carries the whole value through a pipe, past the 64 KiB pipe buffer. */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MAIN = join(import.meta.dir, "../../src/main.ts");

describe("P8: one whole JSON value on stdout when stdout is a pipe", () => {
  test("a refusal over 64 KiB reaches the reader complete and parses", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "norn-gh139-"));
    try {
      // an unknown command echoes its name in the CliError, so a 100 kB name makes a >64 KiB value
      const name = "a".repeat(100_000);
      // a shell pipe, as `norn … | jq` has: Bun.spawn's own stdout pipe does not show the cut
      const child = Bun.spawn(["sh", "-c", `bun "$0" "$1" --json | cat`, MAIN, name], {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
      });
      const out = await new Response(child.stdout).text();
      await child.exited;
      expect(out.length).toBeGreaterThan(65_536);
      const value = JSON.parse(out) as { error: string };
      expect(value.error).toContain(name);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
