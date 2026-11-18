import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNodeHost, NOT_STARTED_CODE, TEMP_SUFFIX, TIMEOUT_CODE } from "../../src/index.ts";

let root: string;
const host = () => createNodeHost({ root, dataDir: join(root, "machine") });

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "norn-host-node-")));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("exec", () => {
  test("reports exit code, stdout and stderr; a non-zero exit is data, not a throw", async () => {
    const r = await host().exec(["sh", "-c", "echo out; echo err >&2; exit 3"]);
    expect(r).toEqual({ code: 3, stdout: "out\n", stderr: "err\n", timedOut: false });
  });

  test("runs in cwd and writes input to stdin", async () => {
    expect((await host().exec(["pwd"], { cwd: root })).stdout.trim()).toBe(root);
    expect(await host().exec(["cat"], { input: "zażółć\nline 2" })).toEqual({ code: 0, stdout: "zażółć\nline 2", stderr: "", timedOut: false });
  });

  test("env is merged over the host's environment, never replacing it", async () => {
    const r = await host().exec(["sh", "-c", 'printf "%s|%s" "$NORN_HOST_TEST" "$PATH"'], { env: { NORN_HOST_TEST: "v" } });
    expect(r.stdout).toBe(`v|${process.env.PATH}`);
  });

  test("a timeout kills the process group and sets timedOut", async () => {
    const started = performance.now();
    const r = await host().exec(["sh", "-c", "echo before; sleep 30 & sleep 30; echo after"], { timeoutMs: 300 });
    expect(performance.now() - started).toBeLessThan(5_000);
    expect(r).toMatchObject({ code: TIMEOUT_CODE, stdout: "before\n", timedOut: true });
  });

  test("a process that ends before its timeout is not timed out", async () => {
    expect(await host().exec(["true"], { timeoutMs: 5_000 })).toEqual({ code: 0, stdout: "", stderr: "", timedOut: false });
  });

  test("a missing binary is a 127 exit with the reason in stderr, never a throw", async () => {
    const r = await host().exec(["norn-host-node-no-such-binary"]);
    expect(r.code).toBe(NOT_STARTED_CODE);
    expect(r.timedOut).toBe(false);
    expect(r.stderr).not.toBe("");
  });
});

describe("files", () => {
  test("writeExecutable replaces the file atomically with its owner's exec bit set", async () => {
    const { files } = host();
    const path = join(root, "bin", "tool");
    await files.writeExecutable?.(path, "#!/bin/sh\necho one\n");
    await files.writeExecutable?.(path, "#!/bin/sh\necho two\n");
    expect(statSync(path).mode & 0o777).toBe(0o755);
    expect(readdirSync(join(root, "bin"))).toEqual(["tool"]);
    expect((await host().exec([path])).stdout).toBe("two\n");
  });

  test("symlink makes a relative link, replaces a link, never a file or folder; readLink reads it back", async () => {
    const { files } = host();
    await files.write(join(root, ".agents", "skills", "a", "SKILL.md"), "# a");
    const link = join(root, ".claude", "skills", "a");
    expect(await files.readLink?.(link)).toBeNull();
    await files.symlink?.("../../.agents/skills/b", link);
    await files.symlink?.("../../.agents/skills/a", link);
    expect(await files.readLink?.(link)).toBe("../../.agents/skills/a");
    expect(readFileSync(join(link, "SKILL.md"), "utf8")).toBe("# a");
    expect(readdirSync(join(root, ".claude", "skills"))).toEqual(["a"]);
    expect(await files.list(join(root, ".claude", "skills"))).toEqual(["a"]);
    // a real file or folder at the name is someone's, never replaced
    expect(await files.readLink?.(join(root, ".agents", "skills", "a"))).toBeNull();
    await expect(files.symlink?.("x", join(root, ".agents", "skills", "a"))).rejects.toThrow("not a link");
    await expect(files.symlink?.("x", join(root, ".agents", "skills", "a", "SKILL.md"))).rejects.toThrow("not a link");
  });

  test("write creates nested folders, replaces atomically and leaves no temp file", async () => {
    const { files } = host();
    const path = join(root, "a", "b", "c.json");
    await files.write(path, "one");
    await files.write(path, "two");
    expect(readFileSync(path, "utf8")).toBe("two");
    expect(readdirSync(join(root, "a", "b"))).toEqual(["c.json"]);
  });

  test("concurrent writes to one file leave one whole version and no temp file", async () => {
    const { files } = host();
    const path = join(root, "race.txt");
    const versions = Array.from({ length: 20 }, (_, i) => `v${i}-${"x".repeat(10_000)}`);
    await Promise.all(versions.map((v) => files.write(path, v)));
    expect(versions).toContain(readFileSync(path, "utf8"));
    expect(readdirSync(root)).toEqual(["race.txt"]);
  });

  test("a relative path is taken from root", async () => {
    const { files } = host();
    await files.write("rel/x.txt", "r");
    expect(readFileSync(join(root, "rel", "x.txt"), "utf8")).toBe("r");
    expect(await files.read("rel/x.txt")).toBe("r");
  });

  test("read gives the text, or null when the file is missing", async () => {
    const { files } = host();
    writeFileSync(join(root, "here.txt"), "ünïcode ✓");
    expect(await files.read(join(root, "here.txt"))).toBe("ünïcode ✓");
    expect(await files.read(join(root, "missing.txt"))).toBeNull();
    expect(await files.read(join(root, "no", "dir", "missing.txt"))).toBeNull();
  });

  test("create makes the file once and refuses an existing one without changing it", async () => {
    const { files } = host();
    const path = join(root, "locks", "x.lock");
    expect(await files.create(path, "first")).toBe(true);
    expect(await files.create(path, "second")).toBe(false);
    expect(readFileSync(path, "utf8")).toBe("first");
    expect(readdirSync(join(root, "locks"))).toEqual(["x.lock"]);
  });

  test("create under a Promise.all race lets exactly one writer win, and the file is the winner's whole text", async () => {
    const { files } = host();
    const path = join(root, "race.lock");
    const results = await Promise.all(Array.from({ length: 25 }, (_, i) => files.create(path, `holder-${i}`)));
    const winners = results.flatMap((won, i) => (won ? [i] : []));
    expect(winners).toHaveLength(1);
    expect(readFileSync(path, "utf8")).toBe(`holder-${winners[0]}`);
    expect(readdirSync(root)).toEqual(["race.lock"]);
  });

  test("create races between two hosts on one folder still let exactly one win", async () => {
    const a = host().files;
    const b = host().files;
    const path = join(root, "two.lock");
    const results = await Promise.all([a.create(path, "a"), b.create(path, "b"), a.create(path, "a2"), b.create(path, "b2")]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  test("list gives sorted names of files and folders, empty for a missing folder, never a temp file", async () => {
    const { files } = host();
    await files.write(join(root, "d", "b.txt"), "b");
    await files.write(join(root, "d", "a.txt"), "a");
    await files.write(join(root, "d", "sub", "c.txt"), "c");
    writeFileSync(join(root, "d", `.a.txt.1.2.3${TEMP_SUFFIX}`), "half");
    expect(await files.list(join(root, "d"))).toEqual(["a.txt", "b.txt", "sub"]);
    expect(await files.list(join(root, "nope"))).toEqual([]);
  });

  test("remove deletes the file; removing a missing file is not an error", async () => {
    const { files } = host();
    const path = join(root, "gone.txt");
    await files.write(path, "x");
    await files.remove(path);
    expect(existsSync(path)).toBe(false);
    await files.remove(path);
    await files.remove(join(root, "no", "such", "file"));
  });

  test("an IO failure rejects rather than reporting a missing file", async () => {
    const { files } = host();
    await files.write(join(root, "plain"), "x");
    expect(statSync(join(root, "plain")).isFile()).toBe(true);
    // a file where a folder must be: the plugin turns the rejection into a PluginFailure
    await expect(files.write(join(root, "plain", "child.txt"), "y")).rejects.toThrow();
    await expect(files.read(join(root, "plain", "child.txt"))).rejects.toThrow();
  });
});

describe("host", () => {
  test("now is ISO-8601 UTC and repo carries the options", () => {
    const h = host();
    expect(h.now()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(h.repo).toEqual({ root, dataDir: join(root, "machine") });
  });
});
