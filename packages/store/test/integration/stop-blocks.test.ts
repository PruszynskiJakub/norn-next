import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { bindNornHome, stopBlocksDir } from "../../src/index.ts";
import { tmp } from "../helpers.ts";

const RUN = "01M5MA3PG0DB4G1MJNV0HKQYSA";

async function race(from: number): Promise<{ taken: number; root: string }> {
  const root = tmp();
  const home = tmp("norn-home-");
  bindNornHome(root, home);
  const script = join(import.meta.dir, "fixtures/claim-stop-block.ts");
  const procs = Array.from({ length: 8 }, () => Bun.spawn(["bun", script, root, home, RUN, "2", String(from)], { stdout: "pipe", stderr: "inherit" }));
  expect(await Promise.all(procs.map((p) => p.exited))).toEqual(Array(8).fill(0));
  const counts = await Promise.all(procs.map((p) => new Response(p.stdout).text()));
  return { taken: counts.reduce((n, c) => n + Number(c), 0), root };
}

describe("turn-end refusals across processes", () => {
  test("hooks racing from zero take exactly the cap between them", async () => {
    const { taken, root } = await race(0);
    expect(taken).toBe(3);
    expect(readdirSync(stopBlocksDir(root, RUN)).sort()).toEqual(["0", "1", "2"]);
  });

  test("hooks that all read two traced refusals let exactly one more through", async () => {
    const { taken, root } = await race(2);
    expect(taken).toBe(1);
    expect(readdirSync(stopBlocksDir(root, RUN))).toEqual(["2"]);
  });
});
