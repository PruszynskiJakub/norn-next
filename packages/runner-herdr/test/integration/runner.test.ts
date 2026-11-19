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
/** the workspaces the tests opened, closed after them */
const opened: string[] = [];
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
  for (const w of opened) await host().exec(["herdr", ...(session ? ["--session", session] : []), "workspace", "close", w]);
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
    opened.push(rec.workspace);
    expect(await runner.start(req)).toEqual({ ok: true, value: { handle: pane } });
    expect(await runner.alive(pane)).toEqual({ ok: true, value: true });

    expect(await runner.send(pane, "hello")).toEqual({ ok: true, value: undefined });
    expect(await until(async () => (await Bun.file(marker).exists()) && (await Bun.file(marker).text()) === `hello ${key}\n`)).toBe(true);

    expect(await runner.stop(pane)).toEqual({ ok: true, value: undefined });
    expect(await runner.alive(pane)).toEqual({ ok: true, value: false });
    expect(await runner.stop(pane)).toEqual({ ok: true, value: undefined });
  });

  test("brings a run's pane in front, opens a pane below it, and sets the story workspace's sidebar token", async () => {
    const key = `01JHERDRFOCUS${Date.now()}`;
    const workspace = `norn-test-${key}`;
    const started = await runner.start({ key, argv: ["sh", "-c", "sleep 30"], env: {}, cwd: root, title: "norn focus test", workspace, logPath: join(root, "log") });
    if (!started.ok) throw new Error(started.failure.message);
    const pane = started.value.handle;
    const rec = JSON.parse((await host().files.read(join(root, "machine", "runners", "herdr", `${key}.json`))) as string) as { workspace: string };
    opened.push(rec.workspace);
    const herdr = (...args: string[]) => host().exec(["herdr", ...(session ? ["--session", session] : []), ...args]);

    expect(await runner.focus?.(pane)).toEqual({ ok: true, value: true });
    const tabs = JSON.parse((await herdr("tab", "list", "--workspace", rec.workspace)).stdout) as { result: { tabs: Array<{ label: string; focused: boolean }> } };
    expect(tabs.result.tabs.find((t) => t.focused)?.label).toBe("norn focus test");
    expect(await runner.focus?.(`${rec.workspace}:p999`)).toEqual({ ok: true, value: false });

    const split = await runner.split?.({ argv: ["sh", "-c", "sleep 30"], cwd: root, title: "norn", beside: pane });
    if (!split?.ok) throw new Error(split ? split.failure.message : "no split");
    const panes = JSON.parse((await herdr("pane", "list", "--workspace", rec.workspace)).stdout) as { result: { panes: Array<{ pane_id: string; label?: string; focused: boolean }> } };
    expect(panes.result.panes.find((p) => p.pane_id === split.value.handle)).toMatchObject({ label: "norn", focused: false });

    expect(await runner.label?.(workspace, "● approve", 30_000)).toEqual({ ok: true, value: true });
    const listed = JSON.parse((await herdr("workspace", "list")).stdout) as { result: { workspaces: Array<{ workspace_id: string; tokens?: Record<string, string> }> } };
    expect(listed.result.workspaces.find((w) => w.workspace_id === rec.workspace)?.tokens).toEqual({ norn: "● approve" });
    expect(await runner.label?.(`${workspace}-none`, "x", 1000)).toEqual({ ok: true, value: false });
    await runner.stop(pane);
  });
});
