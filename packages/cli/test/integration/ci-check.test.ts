/** The `ci` check script of the repo workflows (#125), run through `sh` against a fake gh and sleep on PATH. */
import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  "run view") echo "failed log of run $3" ;;
  *) echo "unexpected gh $*" >&2; exit 9 ;;
esac
`;
  const run = (appear: number, watchExit: number) => {
    const fake = mkdtempSync(join(tmpdir(), "norn-ci-check-"));
    writeFileSync(join(fake, "gh"), FAKE_GH);
    writeFileSync(join(fake, "sleep"), `#!/bin/sh\necho "$1" >> "$FAKE/sleeps"\n`);
    chmodSync(join(fake, "gh"), 0o755);
    chmodSync(join(fake, "sleep"), 0o755);
    const proc = Bun.spawnSync(["sh", "-c", `exec 2>&1\n${ciScript("quick")}`], {
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

  test("fails on a red run with its failed log", () => {
    const r = run(1, 1);
    expect(r.exit).toBe(1);
    expect(r.out).toContain("failed log of run 42");
  });

  test("fails when no run appears within 5 minutes", () => {
    const r = run(0, 0);
    expect(r.exit).toBe(1);
    expect(r.sleeps.length).toBe(30);
    expect(r.out).toContain(`no ci.yml run for ${SHA} after 5m`);
    expect(r.calls.some((c) => c.startsWith("run watch"))).toBe(false);
  });
});
