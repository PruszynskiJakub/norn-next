/**
 * The host's files on the local disk: the host files contract over a fresh folder, and what only a
 * disk shows, that a byte write leaves no temp file behind and a relative path is taken from the root.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hostFilesContract, ODD_BYTES } from "@norn/conformance";
import { nodeFiles } from "../../src/index.ts";

const roots: string[] = [];
const fresh = (): string => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "norn-host-files-")));
  roots.push(root);
  return root;
};
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

hostFilesContract("node files", () => {
  const root = fresh();
  return { files: nodeFiles(root), dir: root };
});

describe("byte files on disk", () => {
  test("writeBytes puts exactly the bytes on disk through a temp file renamed into place, leaving none behind", async () => {
    const root = fresh();
    const files = nodeFiles(root);
    await files.writeBytes?.(join(root, "shots", "AC1.png"), ODD_BYTES);
    await files.writeBytes?.(join(root, "shots", "AC1.png"), ODD_BYTES.subarray(0, 8));
    expect([...readFileSync(join(root, "shots", "AC1.png"))]).toEqual([...ODD_BYTES.subarray(0, 8)]);
    expect(readdirSync(join(root, "shots"))).toEqual(["AC1.png"]);
  });

  test("a relative path is taken from the root, as for text", async () => {
    const root = fresh();
    const files = nodeFiles(root);
    await files.writeBytes?.("out/AC2.png", ODD_BYTES);
    expect([...((await files.readBytes?.(join(root, "out", "AC2.png"))) as Uint8Array)]).toEqual([...ODD_BYTES]);
    expect(await files.readBytes?.("out/missing.png")).toBeNull();
  });
});
