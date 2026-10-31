import { describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureExcluded } from "../../src/index.ts";
import { tmp } from "../helpers.ts";

function repo(): string {
  const root = tmp();
  const r = Bun.spawnSync(["git", "init", "-q", root]);
  if (r.exitCode !== 0) throw new Error(r.stderr.toString());
  return root;
}

describe("worktree files (A3, K4)", () => {
  test("ensureExcluded appends the missing entries once, keeping the user's lines", async () => {
    const root = repo();
    const info = join(root, ".git", "info");
    mkdirSync(info, { recursive: true });
    const path = join(info, "exclude");
    writeFileSync(path, "*.log\n.env.norn");
    await ensureExcluded(root);
    await ensureExcluded(root);
    expect(readFileSync(path, "utf8")).toBe("*.log\n.env.norn\n# norn (machine-local worktree files)\n.norn-unit\n");
    expect(readdirSync(info)).toEqual(["exclude"]);
  });

  test("ensureExcluded creates info/exclude when missing; outside a repo it does nothing", async () => {
    const root = repo();
    const info = join(root, ".git", "info");
    for (const f of readdirSync(info)) Bun.spawnSync(["rm", "-f", join(info, f)]);
    await ensureExcluded(root);
    expect(readFileSync(join(info, "exclude"), "utf8")).toBe("# norn (machine-local worktree files)\n.env.norn\n.norn-unit\n");
    const plain = tmp();
    await ensureExcluded(plain);
    expect(readdirSync(plain)).toEqual([]);
  });
});
