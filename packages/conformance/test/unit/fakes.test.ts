import { describe, expect, test } from "bun:test";
import { manualClock, memoryFiles, memoryHost, scriptedExec, steppingClock, UNSCRIPTED_CODE } from "@norn/conformance";

describe("memoryFiles", () => {
  test("read gives null for a missing file and the text of a written one", async () => {
    const f = memoryFiles({ "/d/a.json": "{}" });
    expect(await f.read("/d/a.json")).toBe("{}");
    expect(await f.read("/d/b.json")).toBeNull();
    await f.write("/d/b.json", "x");
    await f.write("/d/b.json", "y");
    expect(await f.read("/d/b.json")).toBe("y");
  });

  test("create is exclusive: false, and the old text kept, when the file exists", async () => {
    const f = memoryFiles();
    expect(await f.create("/d/lock", "first")).toBe(true);
    expect(await f.create("/d/lock", "second")).toBe(false);
    expect(await f.read("/d/lock")).toBe("first");
  });

  test("list names a folder's direct entries, sorted, folders included once; empty when missing", async () => {
    const f = memoryFiles({ "/d/b.md": "", "/d/a.md": "", "/d/sub/x.md": "", "/d/sub/y.md": "", "/dd/z.md": "" });
    expect(await f.list("/d")).toEqual(["a.md", "b.md", "sub"]);
    expect(await f.list("/d/")).toEqual(["a.md", "b.md", "sub"]);
    expect(await f.list("/nowhere")).toEqual([]);
  });

  test("remove deletes, and removing a missing file is not an error", async () => {
    const f = memoryFiles({ "/d/a": "1" });
    await f.remove("/d/a");
    await f.remove("/d/a");
    expect(f.snapshot()).toEqual({});
  });

  test("a path through a link to a folder reaches the link's target, as on a disk; removing the link itself removes only the link", async () => {
    const f = memoryFiles({ "/keep/a.txt": "kept", "/keep/sub/b.txt": "too" });
    await f.symlink("../../keep", "/w/out/evidence");
    expect(await f.list("/w/out")).toEqual(["evidence"]);
    expect(await f.list("/w/out/evidence")).toEqual(["a.txt", "sub"]);
    expect(await f.read("/w/out/evidence/sub/b.txt")).toBe("too");
    await f.write("/w/out/evidence/c.txt", "new");
    expect(await f.read("/keep/c.txt")).toBe("new");
    await f.remove("/w/out/evidence/c.txt");
    expect(await f.read("/keep/c.txt")).toBeNull();
    await f.remove("/w/out/evidence");
    expect(f.links()).toEqual({});
    expect(f.snapshot()).toEqual({ "/keep/a.txt": "kept", "/keep/sub/b.txt": "too" });
  });

  test("while writes fail, write, create and remove reject and change nothing; reads still work", async () => {
    const f = memoryFiles({ "/d/a": "1" });
    f.failWrites(true);
    await expect(f.write("/d/a", "2")).rejects.toThrow("injected");
    await expect(f.create("/d/b", "2")).rejects.toThrow("injected");
    await expect(f.remove("/d/a")).rejects.toThrow("injected");
    expect(await f.read("/d/a")).toBe("1");
    f.failWrites(false);
    await f.write("/d/a", "2");
    expect(f.snapshot()).toEqual({ "/d/a": "2" });
  });
});

describe("scriptedExec", () => {
  test("answers from the script, filling a clean exit, and records argv and options", async () => {
    const exec = scriptedExec((argv) => (argv[0] === "gh" ? { stdout: '{"login":"octo"}' } : undefined));
    expect(await exec(["gh", "api", "user"], { cwd: "/repo", input: "x" })).toEqual({ code: 0, stdout: '{"login":"octo"}', stderr: "", timedOut: false });
    expect(exec.calls).toEqual([{ argv: ["gh", "api", "user"], opts: { cwd: "/repo", input: "x" } }]);
  });

  test("an unscripted call exits 127 naming the argv, never an empty success", async () => {
    const exec = scriptedExec(() => undefined);
    expect(await exec(["glab", "mr", "list"])).toEqual({ code: UNSCRIPTED_CODE, stdout: "", stderr: "unscripted: glab mr list", timedOut: false });
  });

  test("a script may answer asynchronously, with a failure or a timeout", async () => {
    const exec = scriptedExec(async (argv) => (argv[1] === "slow" ? { code: 143, timedOut: true } : { code: 1, stderr: "HTTP 401" }));
    expect(await exec(["gh", "slow"])).toEqual({ code: 143, stdout: "", stderr: "", timedOut: true });
    expect(await exec(["gh", "auth"])).toEqual({ code: 1, stdout: "", stderr: "HTTP 401", timedOut: false });
  });

  test("a script changing its argv copy does not change the recorded call", async () => {
    const exec = scriptedExec((argv) => {
      argv.push("tampered");
      return {};
    });
    await exec(["git", "status"]);
    expect(exec.calls[0]?.argv).toEqual(["git", "status"]);
  });
});

describe("clock and host", () => {
  test("steppingClock starts at the given time and moves on every read", () => {
    const now = steppingClock("2026-11-17T10:00:00Z", 500);
    expect([now(), now(), now()]).toEqual(["2026-11-17T10:00:00.000Z", "2026-11-17T10:00:00.500Z", "2026-11-17T10:00:01.000Z"]);
    expect(() => steppingClock("later")).toThrow(RangeError);
  });

  test("memoryHost fills what it is not given and keeps what it is", async () => {
    const files = memoryFiles({ "/r/x": "1" });
    const host = memoryHost({ files, repo: { root: "/r", dataDir: "/m" } });
    expect(await host.files.read("/r/x")).toBe("1");
    expect(host.repo).toEqual({ root: "/r", dataDir: "/m" });
    expect((await host.exec(["anything"])).code).toBe(UNSCRIPTED_CODE);
    expect(Number.isNaN(Date.parse(host.now()))).toBe(false);
  });
});

describe("manualClock", () => {
  test("stands still until advanced, and refuses to move back", () => {
    const c = manualClock("2026-11-17T10:00:00Z");
    expect(c.now()).toBe("2026-11-17T10:00:00.000Z");
    expect(c.now()).toBe("2026-11-17T10:00:00.000Z");
    c.advance(1500);
    expect(c.now()).toBe("2026-11-17T10:00:01.500Z");
    expect(() => c.advance(-1)).toThrow("cannot move");
    expect(() => manualClock("soon")).toThrow("not a time");
  });
});
