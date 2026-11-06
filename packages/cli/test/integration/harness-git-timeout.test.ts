/**
 * gh-215: a child that never exits must not hang the tier. bun 1.3.13 cannot cut a test stuck in
 * `Bun.spawnSync` at its per-test timeout once the file has run another `spawnSync`, so one stuck
 * sync spawn blocked its worker and the whole `--parallel` run, with no test named. The harness bounds
 * its own git calls, and the spawning-tier preload bounds every other `Bun.spawnSync` (norn's
 * in-process `gitSync`, a test file's direct call); these run fixtures under `bun test` and want each
 * to end, naming the stuck tests.
 */
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT } from "../../../../test/support/repo-root.ts";

const dir = mkdtempSync(join(tmpdir(), "norn-gh215-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const OUTER_BOUND_MS = 15_000;
const TIMEOUT_MS = 1000;
const STUCK_ALIAS = "alias.stuck=!sleep 60";

/** Runs `body` as a test file under `bun test` with the spawning tiers' preloads, killed at the outer bound. */
async function runFixture(name: string, body: string): Promise<{ log: string; ms: number }> {
  const fixture = join(dir, `${name}.test.ts`);
  writeFileSync(
    fixture,
    `import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sh } from ${JSON.stringify(join(REPO_ROOT, "test", "support", "harness.ts"))};
import { gitSync } from ${JSON.stringify(join(REPO_ROOT, "packages", "store", "src", "git.ts"))};
const repo = mkdtempSync(join(tmpdir(), "norn-gh215-repo-"));
sh(repo, ["init", "-q"]);
${body}`,
  );
  const preloads = ["preload.ts", join("support", "spawning-tier-preload.ts")].flatMap((p) => ["--preload", join(REPO_ROOT, "test", p)]);
  const started = Date.now();
  const child = Bun.spawn(["bun", "test", ...preloads, "--timeout=5000", fixture], {
    cwd: dir,
    env: { ...process.env, NORN_TEST_SPAWN_SYNC_TIMEOUT_MS: String(TIMEOUT_MS) },
    stdout: "pipe",
    stderr: "pipe",
  });
  const bound = setTimeout(() => child.kill("SIGKILL"), OUTER_BOUND_MS);
  const [out, err] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  clearTimeout(bound);
  return { log: out + err, ms: Date.now() - started };
}

test("a harness git call that never exits fails its test, named, instead of hanging the run", async () => {
  const { log, ms } = await runFixture(
    "stuck-sh",
    `test("quick git call", () => { sh(repo, ["status", "--short"]); });
test("stuck git call", () => { sh(repo, ["-c", ${JSON.stringify(STUCK_ALIAS)}, "stuck"]); });
test("after", () => {});
`,
  );
  expect(ms).toBeLessThan(OUTER_BOUND_MS);
  expect(log).toContain("(fail) stuck git call");
  expect(log).toContain(`git -c ${STUCK_ALIAS} stuck (`);
  expect(log).toContain(`: timed out after ${TIMEOUT_MS} ms (killed)`);
  // the run went on past the stuck test: its neighbours ran and passed
  expect(log).toMatch(/\b2 pass\b/);
  expect(log).toMatch(/\b1 fail\b/);
}, 30_000);

test("norn's in-process git call or a test's own spawnSync that never exits fails its test, named", async () => {
  const { log, ms } = await runFixture(
    "stuck-in-process",
    `test("quick git call", () => { expect(gitSync(repo, ["status", "--short"]).code).toBe(0); });
test("stuck in-process git call", () => { expect(gitSync(repo, ["-c", ${JSON.stringify(STUCK_ALIAS)}, "stuck"]).code).toBe(0); });
test("stuck direct spawnSync", () => { expect(Bun.spawnSync(["git", "-c", ${JSON.stringify(STUCK_ALIAS)}, "stuck"], { cwd: repo }).exitCode).toBe(0); });
test("after", () => {});
`,
  );
  expect(ms).toBeLessThan(OUTER_BOUND_MS);
  expect(log).toContain("(fail) stuck in-process git call");
  expect(log).toContain("(fail) stuck direct spawnSync");
  expect(log).toMatch(/\b2 pass\b/);
  expect(log).toMatch(/\b2 fail\b/);
}, 30_000);
