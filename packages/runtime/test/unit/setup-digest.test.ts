/**
 * The setup's digest: the command and the content of the files its inputs name, read through the
 * host's files, so a change to either runs the setup again and nothing else does.
 */
import { describe, expect, test } from "bun:test";
import { memoryFiles, memoryHost } from "@norn/conformance";
import { setupDigest } from "../../src/index.ts";

const WT = "/wt";

function host(seed: Record<string, string> = {}) {
  const files = memoryFiles(Object.fromEntries(Object.entries(seed).map(([p, d]) => [`${WT}/${p}`, d])));
  return { files, ctx: memoryHost({ files }) };
}

const REPO = {
  "bun.lock": "lock\n",
  "package.json": '{"name":"root"}\n',
  "packages/a/package.json": '{"name":"a"}\n',
  "packages/b/package.json": '{"name":"b"}\n',
  "packages/b/src/index.ts": "export {};\n",
  "packages/c/README.md": "no manifest\n",
};
const INPUTS = ["bun.lock", "package.json", "packages/*/package.json"];

describe("the setup digest", () => {
  test("a `*` segment takes every manifest it matches, so a change to any one of them, or a new one, changes the digest", async () => {
    const { files, ctx } = host(REPO);
    const before = await setupDigest(ctx, { command: "bun install", inputs: INPUTS }, WT);
    expect(await setupDigest(ctx, { command: "bun install", inputs: INPUTS }, WT)).toBe(before);
    await files.write(`${WT}/packages/b/package.json`, '{"name":"b","bin":"b"}\n');
    const changed = await setupDigest(ctx, { command: "bun install", inputs: INPUTS }, WT);
    expect(changed).not.toBe(before);
    await files.write(`${WT}/packages/c/package.json`, '{"name":"c"}\n');
    expect(await setupDigest(ctx, { command: "bun install", inputs: INPUTS }, WT)).not.toBe(changed);
  });

  test("a file the inputs do not name changes nothing", async () => {
    const { files, ctx } = host(REPO);
    const before = await setupDigest(ctx, { command: "bun install", inputs: INPUTS }, WT);
    await files.write(`${WT}/packages/b/src/index.ts`, "export const x = 1;\n");
    await files.write(`${WT}/packages/c/README.md`, "changed\n");
    expect(await setupDigest(ctx, { command: "bun install", inputs: INPUTS }, WT)).toBe(before);
  });

  test("a named file that is missing counts as missing, so making it changes the digest", async () => {
    const { files, ctx } = host({ "package.json": "{}\n" });
    const without = await setupDigest(ctx, { command: "bun install", inputs: ["bun.lock"] }, WT);
    expect(without).not.toBe(await setupDigest(ctx, { command: "bun install", inputs: [] }, WT));
    await files.write(`${WT}/bun.lock`, "lock\n");
    expect(await setupDigest(ctx, { command: "bun install", inputs: ["bun.lock"] }, WT)).not.toBe(without);
  });

  test("the command is part of the digest", async () => {
    const { ctx } = host(REPO);
    expect(await setupDigest(ctx, { command: "bun install", inputs: INPUTS }, WT)).not.toBe(await setupDigest(ctx, { command: "bun install --frozen-lockfile", inputs: INPUTS }, WT));
  });

  test("an input is read as bytes where the host can, so a binary lockfile is hashed whole", async () => {
    const { files, ctx } = host();
    await files.writeBytes(`${WT}/bun.lockb`, new Uint8Array([0xff, 0xfe, 0x00, 0x01]));
    const one = await setupDigest(ctx, { command: "bun install", inputs: ["bun.lockb"] }, WT);
    // both are invalid UTF-8 and decode to the same text; only their bytes tell them apart
    await files.writeBytes(`${WT}/bun.lockb`, new Uint8Array([0xff, 0xfd, 0x00, 0x01]));
    expect(await setupDigest(ctx, { command: "bun install", inputs: ["bun.lockb"] }, WT)).not.toBe(one);
  });

  test("with no inputs the digest is the command alone, whatever the worktree holds", async () => {
    const { files, ctx } = host(REPO);
    const before = await setupDigest(ctx, { command: "make deps", inputs: [] }, WT);
    await files.write(`${WT}/bun.lock`, "another\n");
    expect(await setupDigest(ctx, { command: "make deps", inputs: [] }, WT)).toBe(before);
    expect(await setupDigest(memoryHost(), { command: "make deps", inputs: [] }, WT)).toBe(before);
  });

  test("a `*` that meets a file where a folder is expected, or a folder where a file is, adds nothing, as the node host's errors say", async () => {
    const { files, ctx } = host(REPO);
    const clean = await setupDigest(ctx, { command: "bun install", inputs: INPUTS }, WT);
    // the node host lists a file with ENOTDIR and reads a folder with EISDIR; memoryFiles raises neither
    const err = (code: string) => Object.assign(new Error(code), { code });
    const isDir = (path: string) => Object.keys(files.snapshot()).some((p) => p.startsWith(`${path}/`));
    const strict = memoryHost({
      files: {
        ...files,
        list: async (dir) => {
          if ((await files.read(dir)) !== null) throw err("ENOTDIR");
          return files.list(dir);
        },
        readBytes: async (path) => {
          if (isDir(path)) throw err("EISDIR");
          if ((await files.read(path.slice(0, path.lastIndexOf("/")))) !== null) throw err("ENOTDIR");
          return files.readBytes(path);
        },
      },
    });
    // a stray file among the packages, and a linked worktree's `.git`, which is a file
    await files.write(`${WT}/packages/.DS_Store`, "finder\n");
    await files.write(`${WT}/.git`, "gitdir: /repo/.git/worktrees/wt\n");
    expect(await setupDigest(strict, { command: "bun install", inputs: INPUTS }, WT)).toBe(clean);
    expect(await setupDigest(strict, { command: "bun install", inputs: ["*/package.json"] }, WT)).toBe(await setupDigest(ctx, { command: "bun install", inputs: [] }, WT));
    expect(await setupDigest(strict, { command: "bun install", inputs: ["packages/*"] }, WT)).toBe(await setupDigest(strict, { command: "bun install", inputs: ["packages/.DS_Store"] }, WT));
    expect(await setupDigest(strict, { command: "bun install", inputs: ["*/*/package.json"] }, WT)).toBe(await setupDigest(ctx, { command: "bun install", inputs: ["packages/*/package.json"] }, WT));
    // a literal path that is a folder counts as missing
    expect(await setupDigest(strict, { command: "bun install", inputs: ["packages"] }, WT)).toBe(await setupDigest(ctx, { command: "bun install", inputs: ["packages"] }, "/nowhere"));
  });
});
