import { expect, test } from "bun:test";
import { join } from "node:path";
import { nodeExec } from "@norn/host-node";

const WORLD = join(import.meta.dir, "world.ts");

/**
 * Below an agent's session every person-only call the tier makes is refused, so `world` must stop
 * the test at once with why, not let it run into one refused assertion after another.
 */
test("a world set up below a process an agent launch marked fails at once, saying the tier cannot run there", async () => {
  const probe = `import { world } from ${JSON.stringify(WORLD)};\ntry { await world(); console.log("built"); } catch (e) { console.log(e instanceof Error ? e.message : String(e)); }\n`;
  const argv = ["env", "-u", "NORN_UNIT", "-u", "NORN_RUN_ID", "bun", "-e", probe];
  const parent = `const p = Bun.spawn(${JSON.stringify(argv)}, { stdout: "inherit", stderr: "inherit" });\nprocess.exit(await p.exited);\n`;
  const r = await nodeExec(["bun", "-e", parent], { cwd: import.meta.dir, env: { NORN_UNIT: "gh-7", NORN_RUN_ID: "01ARZ3NDEKTSV4RRFFQ69G5FAV" }, timeoutMs: 30_000 });
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("the cli integration tier cannot run below an agent's session");
  expect(r.stdout).toContain("person_only");
});
