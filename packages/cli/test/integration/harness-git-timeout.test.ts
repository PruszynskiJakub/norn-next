/**
 * gh-215: a git child that never exits must not hang the tier. bun 1.3.13 cannot cut a test stuck in
 * `Bun.spawnSync` at its per-test timeout once the file has run another `spawnSync`, so one stuck
 * harness `sh()` blocked its worker and the whole `--parallel` run, with no test named. The harness
 * bounds its own git calls instead; this runs a fixture under `bun test` and wants it to end, naming
 * the stuck test.
 */
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT } from "../../../../test/support/repo-root.ts";

const dir = mkdtempSync(join(tmpdir(), "norn-gh215-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const OUTER_BOUND_MS = 15_000;

test("a harness git call that never exits fails its test, named, instead of hanging the run", async () => {
  const fixture = join(dir, "stuck-git.test.ts");
  writeFileSync(
    fixture,
    `import { test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sh } from ${JSON.stringify(join(REPO_ROOT, "test", "support", "harness.ts"))};
const repo = mkdtempSync(join(tmpdir(), "norn-gh215-repo-"));
sh(repo, ["init", "-q"]);
test("quick git call", () => { sh(repo, ["status", "--short"]); });
test("stuck git call", () => { sh(repo, ["-c", "alias.stuck=!sleep 60", "stuck"]); });
test("after", () => {});
`,
  );
  const started = Date.now();
  const child = Bun.spawn(["bun", "test", "--timeout=5000", fixture], {
    cwd: dir,
    env: { ...process.env, NORN_HARNESS_GIT_TIMEOUT_MS: "1000" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const bound = setTimeout(() => child.kill("SIGKILL"), OUTER_BOUND_MS);
  const [out, err] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  clearTimeout(bound);
  const log = out + err;
  expect(Date.now() - started).toBeLessThan(OUTER_BOUND_MS);
  expect(log).toContain("(fail) stuck git call");
  expect(log).toMatch(/git -c alias\.stuck=!sleep 60 stuck \(.*\): timed out after 1000 ms \(killed\)/);
  // the run went on past the stuck test: its neighbours ran and passed
  expect(log).toMatch(/\b2 pass\b/);
  expect(log).toMatch(/\b1 fail\b/);
}, 30_000);
