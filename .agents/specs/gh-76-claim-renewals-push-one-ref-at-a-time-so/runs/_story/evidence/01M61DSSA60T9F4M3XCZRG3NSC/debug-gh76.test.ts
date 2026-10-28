// [DEBUG-gh76] throwaway loop: one renewal tick with N claimed stories should push claims once (gh-76)
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { setSpawnObserver } from "@norn/store";
import { createHarness, type Harness, issue } from "./harness.ts";
import type { TickReport } from "../src/index.ts";

setDefaultTimeout(60_000);
const N = Number(process.env.GH76_N ?? 3);
const SOLO = `name: solo
start: implement
steps:
  implement:
    type: agent
    skill: norn-implement
    outcomes: { done: { to: $done, means: "implemented" } }
`;
const CONFIG = `agents:
  claude: { adapter: claude }
runner: { adapter: headless }
remote: { provider: gh, label: norn }
default_workflow: solo
default_mode: auto
notifiers: []
`;
let h: Harness;
beforeAll(async () => {
  h = await createHarness();
  expect((await h.norn("init")).exit).toBe(0);
  h.write(join(h.root, ".agents/norn/config.yaml"), CONFIG);
  h.write(join(h.root, ".agents/norn/workflows/solo.yaml"), SOLO);
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn init"]);
  h.git(["push", "-q", "origin", "main"]);
  h.remote.issues = Array.from({ length: N }, (_, i) => issue(i + 1, `Story ${i + 1}`));
  for (let i = 0; i < 6 * N; i++) {
    await h.norn("tick");
    h.clock.advance(5_000);
  }
});
afterAll(() => h.cleanup());

test(`one renewal tick with ${N} claimed stories pushes claims in one git push`, async () => {
  const claims = h.git(["ls-remote", "origin", "refs/norn/claims/*"]).split("\n").filter(Boolean);
  expect(claims.length).toBe(N);
  h.clock.advance(4 * 60_000);
  const pushes: string[][] = [];
  setSpawnObserver(({ argv }) => {
    if (argv.includes("push") && argv.some((a) => a.includes("refs/norn/claims/"))) pushes.push(argv); if (["push","fetch","ls-remote"].some((k) => argv.includes(k))) console.log(`[DEBUG-gh76] net: ${argv.slice(argv.findIndex((a) => ["push","fetch","ls-remote"].includes(a))).join(" ").replace(/[0-9a-f]{40}/g, "<sha>")}`);
  });
  const t0 = performance.now();
  const r = (await h.norn("tick", "--offline")).value as TickReport;
  const ms = performance.now() - t0;
  setSpawnObserver(null);
  const renewed = r.decisions.filter((d) => d.rule === "claim.renew");
  console.log(`[DEBUG-gh76] renewals=${renewed.length} ok=${renewed.filter((d) => d.ok).length} claim pushes=${pushes.length} tick_ms=${ms.toFixed(0)}`);
  for (const p of pushes) console.log(`[DEBUG-gh76]   ${p.slice(p.indexOf("push")).join(" ").replace(/[0-9a-f]{40}/g, "<sha>")}`);
  expect(renewed.length).toBe(N);
  expect(pushes.length).toBe(1);
});
