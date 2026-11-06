/**
 * gh-226 at the CLI seam: `norn init` writes a starter `REVIEW.md` at the repo root, which the
 * `norn-review` skill reads, only when the repo has none; a repo's own file is never touched.
 */
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHarness } from "../../../../test/support/harness.ts";

setDefaultTimeout(60_000);

const starter = readFileSync(join(import.meta.dir, "..", "..", "assets", "REVIEW.md"), "utf8");

describe("norn init writes a starter REVIEW.md (gh-226)", () => {
  test("a repo without one gets the starter, and init says so", async () => {
    const h = await createHarness();
    try {
      const r = await h.norn("init");
      expect(r.exit).toBe(0);
      expect(readFileSync(join(h.root, "REVIEW.md"), "utf8")).toBe(starter);
      expect(r.stdout).toContain("REVIEW.md created");
      expect(r.stdout).toMatch(/git add [^`]*REVIEW\.md/);
      const again = (await h.norn("init", "--json")).value as { review: unknown };
      expect(again.review).toBe("exists");
    } finally {
      h.cleanup();
    }
  });

  test("a repo's own REVIEW.md is kept as it is", async () => {
    const h = await createHarness();
    try {
      h.write(join(h.root, "REVIEW.md"), "# ours\n");
      const r = await h.norn("init", "--json");
      expect(r.exit).toBe(0);
      expect((r.value as { review: unknown }).review).toBe("exists");
      expect(readFileSync(join(h.root, "REVIEW.md"), "utf8")).toBe("# ours\n");
    } finally {
      h.cleanup();
    }
  });
});
