/**
 * DEBUG loop for gh-77 (throwaway, not a regression test yet): a check step blocks the tick that
 * starts it. Goes red today; green once a check no longer runs inside the tick.
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import type { TickReport } from "../src/index.ts";
import { createHarness, type Harness, installBundledSkills, issue } from "./harness.ts";

const CHECK_MS = Number(process.env.GH77_CHECK_MS ?? 3000);
const SLOW = `name: slow
start: test
steps:
  test:
    type: check
    run: sleep ${CHECK_MS / 1000} && echo checked
    timeout: 1m
    outcomes: { pass: $done, fail: $stuck }
`;
const CONFIG = `agents:
  claude: { adapter: claude }
runner: { adapter: headless }
remote: { provider: gh, label: norn }
default_workflow: slow
default_mode: auto
notifiers: []
watch_interval: 30s
`;

let h: Harness;
const acts = (r: TickReport) => r.decisions.filter((d) => d.kind !== "noop").map((d) => d.kind);

beforeAll(async () => {
  h = await createHarness();
  h.write(join(h.root, ".agents/norn/config.yaml"), CONFIG);
  h.write(join(h.root, ".agents/norn/workflows/slow.yaml"), SLOW);
  installBundledSkills(h.root);
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn init"]);
  h.git(["push", "-q", "origin", "main"]);
  h.remote.issues = [issue(9, "Slow check")];
  for (let i = 0; i < 5; i++) {
    h.clock.advance(10_000);
    const r = await h.tick();
    if (acts(r).includes("start_unit")) return;
  }
  throw new Error("story did not start");
});
afterAll(() => h.cleanup());

test("gh-77: the tick that starts a check returns at once, and the heartbeat stays up while the check runs", async () => {
  h.clock.advance(10_000);
  const pending = h.tick();
  // the watch loop's next ticks come due while the check runs: 3 × 30s later the heartbeat counts as down
  await Bun.sleep(1500); // past a normal tick (~1.1 s here), well inside the check
  h.clock.advance(100_000);
  const during = await h.norn("tick").catch((e) => e);
  const inbox = (await h.norn("inbox", "--json")).value as { groups: { unblock: Array<{ title: string }> } };
  const r = await pending;
  console.log(`[gh77] run_check tick: ${Math.round(r.duration_ms)} ms (check ${CHECK_MS} ms); acts=${acts(r)}; unblock during check=${JSON.stringify(inbox.groups.unblock.map((i) => i.title))}; concurrent tick exit=${during.exit} ${JSON.stringify(during.value).slice(0, 120)}`);
  expect(acts(r)).toContain("run_check");
  expect(inbox.groups.unblock.map((i) => i.title)).not.toContainEqual(expect.stringContaining("no heartbeat"));
  expect(during.exit).toBe(0); // a tick can run while the check does
  expect(r.duration_ms).toBeLessThan(2500); // H6 wants < 1 s; the harness tick alone is ~0.6–1.1 s, the check 3 s
});
