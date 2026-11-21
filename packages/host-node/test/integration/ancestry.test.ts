import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

let dir: string;

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "norn-host-ancestry-")));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const ANCESTRY = resolve(import.meta.dir, "../../src/ancestry.ts");

/**
 * Run a probe that prints its own env's mark and its ancestry, below a parent process started with
 * `env`, clearing the mark for itself as an agent's shell command would. The parent is bun, as an
 * agent's harness is a program of its own: macOS shows no start env for its own system binaries.
 */
async function readBelowMarkedParent(env: Record<string, string>): Promise<{ own: string | null; ancestors: { pid: number; env: Record<string, string> | null }[]; parent: number }> {
  const probe = join(dir, "probe.ts");
  const parent = join(dir, "parent.ts");
  writeFileSync(probe, `import { nodeAncestry } from ${JSON.stringify(ANCESTRY)};\nconsole.log(JSON.stringify({ own: process.env.NORN_RUN_ID ?? null, ancestors: await nodeAncestry(["NORN_UNIT", "NORN_RUN_ID"]) }));\n`);
  writeFileSync(
    parent,
    `const p = Bun.spawn(["env", "-u", "NORN_UNIT", "-u", "NORN_RUN_ID", process.execPath, ${JSON.stringify(probe)}], { stdout: "inherit", stderr: "inherit" });\nprocess.exit(await p.exited);\n`,
  );
  const child = Bun.spawn([process.execPath, parent], { cwd: dir, env, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code !== 0) throw new Error(`probe exited ${code}: ${err}`);
  return { ...JSON.parse(out), parent: child.pid };
}

const withoutMark = (): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== "NORN_UNIT" && k !== "NORN_RUN_ID") out[k] = v;
  return out;
};

describe("nodeAncestry", () => {
  test("a process that cleared the launch env still sees it on the process above it, and the climb reaches this test's own process", async () => {
    const got = await readBelowMarkedParent({ ...withoutMark(), NORN_UNIT: "gh-7/slice-1", NORN_RUN_ID: "01JTESTRUN" });
    expect(got.own).toBeNull();
    expect(got.ancestors[0]).toEqual({ pid: got.parent, env: { NORN_UNIT: "gh-7/slice-1", NORN_RUN_ID: "01JTESTRUN" } });
    expect(got.ancestors.map((a) => a.pid)).toContain(process.pid);
  });

  test("a parent started without the launch env shows none of it", async () => {
    const got = await readBelowMarkedParent(withoutMark());
    expect(got.ancestors[0]).toEqual({ pid: got.parent, env: {} });
  });
});
