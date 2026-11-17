/**
 * Against a real herdr, which opens a workspace and a tab in it: only with NORN_TEST_HERDR=1, never
 * in a run that did not ask, since it would act in the person's own herdr. NORN_TEST_HERDR_SESSION
 * names a herdr session to use instead of the default one.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNodeHost } from "@norn/host-node";
import { createRunner, type Runner } from "@norn/plugin-api";
import { herdrRunnerFactory } from "../../src/index.ts";

const enabled = process.env.NORN_TEST_HERDR === "1";
const session = process.env.NORN_TEST_HERDR_SESSION;

let root: string;
let runner: Runner;
let workspaceId: string | null = null;
const host = () => createNodeHost({ root, dataDir: join(root, "machine") });

async function until(cond: () => Promise<boolean>, ms = 10_000): Promise<boolean> {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    if (await cond()) return true;
    await Bun.sleep(100);
  }
  return cond();
}

beforeAll(() => {
  if (!enabled) return;
  root = realpathSync(mkdtempSync(join(tmpdir(), "norn-runner-herdr-")));
  const made = createRunner(herdrRunnerFactory, host(), session ? { session } : {});
  if (!made.ok) throw new Error(made.failure.message);
  runner = made.value;
});
afterAll(async () => {
  if (!enabled) return;
  if (workspaceId) await host().exec(["herdr", ...(session ? ["--session", session] : []), "workspace", "close", workspaceId]);
  rmSync(root, { recursive: true, force: true });
});

describe.skipIf(!enabled)("herdr runner against a real herdr", () => {
  test("starts a titled tab once per key, reads it alive, types into it, and stops it", async () => {
    const key = `01JHERDRTEST${Date.now()}`;
    const marker = join(root, "typed.txt");
    const req = { key, argv: ["sh", "-c", `read line; echo "$line $NORN_RUN_ID" > ${marker}; sleep 30`], env: { NORN_RUN_ID: key }, cwd: root, title: "norn runner test", workspace: `norn-test-${key}`, logPath: join(root, "log") };
    const started = await runner.start(req);
    if (!started.ok) throw new Error(started.failure.message);
    const pane = started.value.handle;
    const rec = JSON.parse((await host().files.read(join(root, "machine", "runners", "herdr", `${key}.json`))) as string) as { workspace: string };
    workspaceId = rec.workspace;
    expect(await runner.start(req)).toEqual({ ok: true, value: { handle: pane } });
    expect(await runner.alive(pane)).toEqual({ ok: true, value: true });

    expect(await runner.send(pane, "hello")).toEqual({ ok: true, value: undefined });
    expect(await until(async () => (await Bun.file(marker).exists()) && (await Bun.file(marker).text()) === `hello ${key}\n`)).toBe(true);

    expect(await runner.stop(pane)).toEqual({ ok: true, value: undefined });
    expect(await runner.alive(pane)).toEqual({ ok: true, value: false });
    expect(await runner.stop(pane)).toEqual({ ok: true, value: undefined });
  });
});
