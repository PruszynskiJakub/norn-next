/** Bounded child processes (H11): a hung network call is killed with its whole process group. */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git, gitSync } from "../src/git.ts";
import { NETWORK_TIMEOUT_MS, gitTimeoutMs, type SpawnRecord, setSpawnObserver, spawnBounded } from "../src/index.ts";

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const tmps: string[] = [];
afterAll(() => {
  for (const d of tmps) rmSync(d, { recursive: true, force: true });
});

describe("spawnBounded", () => {
  test("collects stdout, stderr, the exit code and stdin", async () => {
    const r = await spawnBounded(["sh", "-c", "cat; echo err >&2; exit 3"], { stdin: "in" });
    expect(r).toEqual({ code: 3, stdout: "in", stderr: "err\n", timed_out: false });
  });

  test("a missing binary is exit 127, never a throw", async () => {
    const r = await spawnBounded(["norn-no-such-binary-xyz"], {});
    expect(r.code).toBe(127);
    expect(r.timed_out).toBe(false);
  });

  test("on timeout kills the process group, a grandchild holding the pipes included", async () => {
    // like git → ssh: the grandchild keeps stdout/stderr open after its parent is gone
    const t0 = Date.now();
    const r = await spawnBounded(["sh", "-c", "sleep 30 & echo $!; sleep 30"], { timeoutMs: 300 });
    expect(Date.now() - t0).toBeLessThan(5_000);
    expect(r.timed_out).toBe(true);
    expect(r.code).toBe(124);
    expect(r.stderr).toContain("timed out after 0.3s");
    const grandchild = Number(r.stdout.trim());
    expect(grandchild).toBeGreaterThan(0);
    await Bun.sleep(100);
    expect(alive(grandchild)).toBe(false);
  });
});

describe("git network timeouts", () => {
  test("only subcommands that reach a remote get a timeout", () => {
    for (const sub of ["fetch", "push", "ls-remote", "pull", "clone"]) expect(gitTimeoutMs([sub, "origin"])).toBe(NETWORK_TIMEOUT_MS);
    expect(gitTimeoutMs(["-c", "core.quotePath=false", "fetch", "origin"])).toBe(NETWORK_TIMEOUT_MS);
    // local commands run hooks (commit) or can be slow on big repos: never killed
    for (const args of [["commit", "-m", "x"], ["rev-parse", "HEAD"], ["--version"], ["-c", "a=b", "log"]]) expect(gitTimeoutMs(args)).toBeUndefined();
  });

  test("a fetch from a remote that never answers fails as a network error instead of hanging", async () => {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), "norn-spawn-")));
    tmps.push(repo);
    await git(repo, ["init", "-q"]);
    const t0 = Date.now();
    const r = await git(repo, ["-c", "protocol.ext.allow=always", "fetch", "--quiet", "ext::sleep 30"], undefined, { timeoutMs: 500 });
    expect(Date.now() - t0).toBeLessThan(5_000);
    expect(r.code).toBe(124);
    expect(r.stderr).toMatch(/timed out/);
  });
});

describe("gitSync", () => {
  test("binary-safe stdout, stdin bytes, and a missing cwd is exit 127, never a throw", () => {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), "norn-spawn-")));
    tmps.push(repo);
    expect(gitSync(repo, ["init", "-q"]).code).toBe(0);
    const sha = gitSync(repo, ["hash-object", "-w", "--stdin"], new Uint8Array([0, 255, 10])).stdout.toString().trim();
    expect([...gitSync(repo, ["cat-file", "blob", sha]).stdout]).toEqual([0, 255, 10]);
    expect(gitSync(join(repo, "no-such-dir"), ["status"]).code).toBe(127);
  });

  test("a fetch from a remote that never answers is killed at the timeout (exit 124)", () => {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), "norn-spawn-")));
    tmps.push(repo);
    gitSync(repo, ["init", "-q"]);
    const t0 = Date.now();
    const r = gitSync(repo, ["-c", "protocol.ext.allow=always", "fetch", "--quiet", "ext::sleep 30"], undefined, { timeoutMs: 500 });
    expect(Date.now() - t0).toBeLessThan(5_000);
    expect(r.code).toBe(124);
    expect(r.stderr).toMatch(/timed out after 0.5s/);
  });

  test("tells the spawn observer", () => {
    const seen: SpawnRecord[] = [];
    setSpawnObserver((r) => seen.push(r));
    try {
      gitSync("/", ["--version"]);
    } finally {
      setSpawnObserver(null);
    }
    expect(seen).toEqual([{ argv: ["git", "--version"], cwd: "/" }]);
  });
});

describe("spawn observer (refactor Phase 0.2: effect transcripts)", () => {
  test("off by default; when set, sees argv + cwd of every spawn in order; a throwing observer changes nothing", async () => {
    const seen: SpawnRecord[] = [];
    expect(setSpawnObserver((r) => seen.push(r))).toBeNull();
    try {
      await spawnBounded(["sh", "-c", "exit 0"], { cwd: "/" });
      await git("/", ["--version"]);
      expect(seen).toEqual([
        { argv: ["sh", "-c", "exit 0"], cwd: "/" },
        { argv: ["git", "--version"], cwd: "/" },
      ]);
      setSpawnObserver(() => {
        throw new Error("boom");
      });
      expect((await spawnBounded(["sh", "-c", "echo ok"], {})).stdout).toBe("ok\n");
    } finally {
      setSpawnObserver(null);
    }
    await spawnBounded(["sh", "-c", "exit 0"], {});
    expect(seen).toHaveLength(2);
  });
});
