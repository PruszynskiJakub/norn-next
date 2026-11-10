/** The `ci` check script of the repo workflows (#125), run through `sh` against a fake gh and sleep on PATH. */
import { describe, expect, test } from "bun:test";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSyncCaptured } from "@norn/store";
import { REPO_ROOT as ROOT } from "../../../../test/support/repo-root.ts";

/** The `ci` check script of a repo workflow, as norn runs it (`sh -c`, packages/cli/src/runtime/shell.ts). */
function ciScript(wf: string): string {
  const { steps } = Bun.YAML.parse(readFileSync(join(ROOT, ".agents", "workflows", `${wf}.yaml`), "utf8")) as { steps: Record<string, { run?: string }> };
  return steps.ci?.run ?? "";
}

describe("the ci check waits for the ci.yml run of the PR's head commit (#125)", () => {
  const SHA = "0123456789abcdef0123456789abcdef01234567";
  // A fake gh and sleep on PATH: `gh run list` finds run 42 for SHA from its APPEAR-th call on (never when 0).
  const FAKE_GH = `#!/bin/sh
echo "$*" >> "$FAKE/calls"
case "$1 $2" in
  "pr view") echo "${SHA}" ;;
  "run list")
    n=$(($(cat "$FAKE/lists" 2>/dev/null || echo 0) + 1)); echo $n > "$FAKE/lists"
    case "$*" in *"--workflow ci.yml"*"--commit ${SHA}"*"--event pull_request"*) ;; *) echo ""; exit 0 ;; esac
    if [ "$APPEAR" -gt 0 ] && [ $n -ge "$APPEAR" ]; then echo 42; else echo ""; fi ;;
  "run watch") exit "$WATCH_EXIT" ;;
  "run view")
    case "$*" in
      *"--json url"*) echo "https://example.test/run/$3" ;;
      # applies the script's own -q filter to the run's jobs, as gh does
      *"--json jobs"*) shift 6; jq -r "$1" "$FAKE/jobs.json" ;;
      *) echo "unexpected gh $*" >&2; exit 9 ;;
    esac ;;
  *) echo "unexpected gh $*" >&2; exit 9 ;;
esac
`;
  // a red run: one shard failed, one was cancelled, one passed, and a job after them was skipped
  const JOBS = [
    { databaseId: 6, name: "unit", conclusion: "success" },
    { databaseId: 7, name: "integration (shard 1/4)", conclusion: "failure" },
    { databaseId: 8, name: "integration (shard 2/4)", conclusion: "cancelled" },
    { databaseId: 9, name: "integration (shard 3/4)", conclusion: "success" },
    { databaseId: 10, name: "package", conclusion: "skipped" },
  ];
  const run = (appear: number, watchExit: number) => {
    const fake = mkdtempSync(join(tmpdir(), "norn-ci-check-"));
    writeFileSync(join(fake, "gh"), FAKE_GH);
    writeFileSync(join(fake, "sleep"), `#!/bin/sh\necho "$1" >> "$FAKE/sleeps"\n`);
    chmodSync(join(fake, "gh"), 0o755);
    chmodSync(join(fake, "sleep"), 0o755);
    // the script calls the repo's .agents/scripts/ci-failures.sh relative to the checkout it runs in
    mkdirSync(join(fake, ".agents", "scripts"), { recursive: true });
    copyFileSync(join(ROOT, ".agents", "scripts", "ci-failures.sh"), join(fake, ".agents", "scripts", "ci-failures.sh"));
    writeFileSync(join(fake, "jobs.json"), JSON.stringify({ jobs: JOBS }));
    const proc = spawnSyncCaptured(["sh", "-c", `exec 2>&1\n${ciScript("quick")}`], {
      cwd: fake,
      env: { ...process.env, PATH: `${fake}:${process.env.PATH}`, FAKE: fake, APPEAR: String(appear), WATCH_EXIT: String(watchExit) },
    });
    const read = (f: string) => (existsSync(join(fake, f)) ? readFileSync(join(fake, f), "utf8").trim().split("\n") : []);
    return { exit: proc.exitCode, out: proc.stdout.toString(), calls: read("calls"), sleeps: read("sleeps") };
  };

  test("waits for a run that appears late and passes on a green one", () => {
    const r = run(4, 0);
    expect(r.exit).toBe(0);
    expect(r.sleeps).toEqual(["10", "10", "10"]);
    expect(r.calls.filter((c) => c.startsWith("run watch"))).toEqual([expect.stringMatching(/^run watch 42 --exit-status/)]);
  });

  test("fails on a red run with where its failures are, never its log", () => {
    const r = run(1, 1);
    expect(r.exit).toBe(1);
    expect(r.out).toContain("CI run 42 failed: https://example.test/run/42");
    expect(r.out.split("\n").filter((l) => l.startsWith("- job "))).toEqual([
      "- job 7: integration (shard 1/4)",
      "- job 8: integration (shard 2/4) (cancelled: unknown, not run to the end)",
      "- job 10: package (skipped: unknown, not run to the end)",
    ]);
    expect(r.out).toContain('gh api "repos/{owner}/{repo}/check-runs/<job>/annotations"');
    expect(r.calls.some((c) => c.includes("--log-failed"))).toBe(false);
  });

  test("fails when no run appears within 5 minutes", () => {
    const r = run(0, 0);
    expect(r.exit).toBe(1);
    expect(r.sleeps.length).toBe(30);
    expect(r.out).toContain(`no ci.yml run for ${SHA} after 5m`);
    expect(r.calls.some((c) => c.startsWith("run watch"))).toBe(false);
  });
});

/** The `ci` check script of a workflow `norn init` ships (packages/cli/assets/workflows/). */
function bundledCiScript(wf: string): string {
  const { steps } = Bun.YAML.parse(readFileSync(join(ROOT, "packages", "cli", "assets", "workflows", `${wf}.yaml`), "utf8")) as { steps: Record<string, { run?: string }> };
  return steps.ci?.run ?? "";
}

describe("the shipped ci check waits for the checks on the PR (#136)", () => {
  const SHA = "0123456789abcdef0123456789abcdef01234567";
  // A fake gh and sleep: PR 7 has checks from the APPEAR-th rollup call on (never when 0).
  const FAKE_GH = `#!/bin/sh
echo "$*" >> "$FAKE/calls"
case "$*" in
  "pr view --json number -q .number") echo 7 ;;
  "pr view --json headRefOid -q .headRefOid") echo "${SHA}" ;;
  "pr view 7 --json statusCheckRollup"*)
    n=$(($(cat "$FAKE/rollups" 2>/dev/null || echo 0) + 1)); echo $n > "$FAKE/rollups"
    if [ "$APPEAR" -gt 0 ] && [ $n -ge "$APPEAR" ]; then echo 2; else echo 0; fi ;;
  "pr checks 7 --watch"*) exit "$WATCH_EXIT" ;;
  "pr checks 7") echo "build	fail	1m	https://example.test/run/42"; exit 1 ;;
  "api repos/{owner}/{repo}/commits/${SHA}/check-runs?per_page=100 "*) echo "- build (id 42): https://example.test/run/42" ;;
  *) echo "unexpected gh $*" >&2; exit 9 ;;
esac
`;
  const run = (appear: number, watchExit: number, withGh = true) => {
    const fake = mkdtempSync(join(tmpdir(), "norn-ci-check-"));
    if (withGh) writeFileSync(join(fake, "gh"), FAKE_GH);
    writeFileSync(join(fake, "sleep"), `#!/bin/sh\necho "$1" >> "$FAKE/sleeps"\n`);
    if (withGh) chmodSync(join(fake, "gh"), 0o755);
    chmodSync(join(fake, "sleep"), 0o755);
    // without gh, PATH is the fake dir alone: CI runners ship gh in /usr/bin
    const proc = spawnSyncCaptured(["/bin/sh", "-c", `exec 2>&1\n${bundledCiScript("quick")}`], {
      cwd: fake,
      env: { PATH: withGh ? `${fake}:/usr/bin:/bin` : fake, FAKE: fake, APPEAR: String(appear), WATCH_EXIT: String(watchExit) },
    });
    const read = (f: string) => (existsSync(join(fake, f)) ? readFileSync(join(fake, f), "utf8").trim().split("\n") : []);
    return { exit: proc.exitCode, out: proc.stdout.toString(), calls: read("calls"), sleeps: read("sleeps") };
  };

  test("waits for checks that appear late and passes when they go green", () => {
    const r = run(4, 0);
    expect(r.exit).toBe(0);
    expect(r.sleeps).toEqual(["10", "10", "10"]);
    expect(r.calls.filter((c) => c.startsWith("pr checks"))).toEqual(["pr checks 7 --watch --interval 30"]);
  });

  test("fails on a red check with the checks and where the failures are, never the log", () => {
    const r = run(1, 1);
    expect(r.exit).toBe(1);
    expect(r.out).toContain("build\tfail\t1m\thttps://example.test/run/42");
    expect(r.out).toContain("- build (id 42): https://example.test/run/42");
    expect(r.out).toContain('  gh api "repos/{owner}/{repo}/check-runs/<id>/annotations" -q \'.[] | select(.annotation_level=="failure" and .path!=".github") | "\\(.path):\\(.start_line) \\(.message)"\'');
    expect(r.calls.some((c) => c.startsWith("run "))).toBe(false);
  });

  test("passes when no check appears within 5 minutes: the repo has no CI", () => {
    const r = run(0, 0);
    expect(r.exit).toBe(0);
    expect(r.sleeps.length).toBe(30);
    expect(r.out).toContain("no checks on PR #7 after 5m");
    expect(r.calls.some((c) => c.startsWith("pr checks"))).toBe(false);
  });

  test("passes without gh, saying there is no CI to wait for", () => {
    const r = run(1, 0, false);
    expect(r.exit).toBe(0);
    expect(r.out).toContain("gh not found");
  });

  test("story runs the same script as quick", () => {
    expect(bundledCiScript("story")).toBe(bundledCiScript("quick"));
  });
});
