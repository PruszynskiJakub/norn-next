/**
 * The host's files as a reusable suite: what a plugin may assume of `HostFiles` whichever host hands
 * it over. Text reads back as written, a write replaces a file whole, and the optional byte methods
 * (plugin API 1.28) carry every byte value through unchanged, for any host that offers them.
 */
import { describe, expect } from "bun:test";
import type { HostFiles } from "@norn/plugin-api";
import { type ContractOptions, contractTest } from "./contract.ts";

export interface HostFilesWorld {
  files: HostFiles;
  /** a folder the suite may write in; empty at the start of each test */
  dir: string;
}

export type HostFilesContractTest =
  | "text reads back as written, and a missing file reads as null"
  | "a write replaces the file whole and leaves no other name in its folder"
  | "bytes written with writeBytes read back identical with readBytes, every byte value"
  | "writeBytes replaces the file whole and leaves no other name in its folder"
  | "readBytes of a missing file is null"
  | "a host offers readBytes and writeBytes together or neither";

/** Every byte value, then a PNG's signature and a NUL run: what a text encoding would mangle. */
export const ODD_BYTES = new Uint8Array([...Array.from({ length: 256 }, (_, i) => i), 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0xff, 0xfe]);

export function hostFilesContract(name: string, makeWorld: () => HostFilesWorld | Promise<HostFilesWorld>, opts: ContractOptions<HostFilesContractTest> = {}): void {
  const tc = (n: HostFilesContractTest, fn: () => Promise<void>) => contractTest(opts, n, fn);

  describe(`host files contract: ${name}`, () => {
    tc("text reads back as written, and a missing file reads as null", async () => {
      const { files, dir } = await makeWorld();
      await files.write(`${dir}/a/notes.md`, "zażółć\nline 2\n");
      expect(await files.read(`${dir}/a/notes.md`)).toBe("zażółć\nline 2\n");
      expect(await files.read(`${dir}/a/missing.md`)).toBeNull();
    });

    tc("a write replaces the file whole and leaves no other name in its folder", async () => {
      const { files, dir } = await makeWorld();
      await files.write(`${dir}/b/notes.md`, "a longer first text\n");
      await files.write(`${dir}/b/notes.md`, "short\n");
      expect(await files.read(`${dir}/b/notes.md`)).toBe("short\n");
      expect(await files.list(`${dir}/b`)).toEqual(["notes.md"]);
    });

    tc("bytes written with writeBytes read back identical with readBytes, every byte value", async () => {
      const { files, dir } = await makeWorld();
      if (!files.writeBytes || !files.readBytes) return;
      await files.writeBytes(`${dir}/shots/AC1.png`, ODD_BYTES);
      const back = await files.readBytes(`${dir}/shots/AC1.png`);
      expect(back).toBeInstanceOf(Uint8Array);
      expect([...(back as Uint8Array)]).toEqual([...ODD_BYTES]);
    });

    tc("writeBytes replaces the file whole and leaves no other name in its folder", async () => {
      const { files, dir } = await makeWorld();
      if (!files.writeBytes || !files.readBytes) return;
      await files.writeBytes(`${dir}/c/AC1.png`, ODD_BYTES);
      await files.writeBytes(`${dir}/c/AC1.png`, new Uint8Array([1, 2, 3]));
      expect([...((await files.readBytes(`${dir}/c/AC1.png`)) as Uint8Array)]).toEqual([1, 2, 3]);
      expect(await files.list(`${dir}/c`)).toEqual(["AC1.png"]);
    });

    tc("readBytes of a missing file is null", async () => {
      const { files, dir } = await makeWorld();
      if (!files.readBytes) return;
      expect(await files.readBytes(`${dir}/d/missing.png`)).toBeNull();
    });

    tc("a host offers readBytes and writeBytes together or neither", async () => {
      const { files } = await makeWorld();
      expect(typeof files.readBytes).toBe(typeof files.writeBytes);
    });
  });
}
