import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { claimStopBlock, listRunTraces, machineDir, stopBlockPath, stopBlocksDir } from "../../src/index.ts";
import { tmp } from "../helpers.ts";

const RUN = "01M5MA3PG0DB4G1MJNV0HKQYSA";
const OTHER = "01M5MA3PG0DB4G1MJNV0HKQYSB";

describe("claimStopBlock", () => {
  test("two hooks that both read two traced refusals: only one of them takes the third", () => {
    const repo = tmp();
    expect([claimStopBlock(repo, RUN, 2, 3), claimStopBlock(repo, RUN, 2, 3)]).toEqual([true, false]);
  });

  test("from zero a run takes exactly max refusals", () => {
    const repo = tmp();
    expect(Array.from({ length: 4 }, () => claimStopBlock(repo, RUN, 0, 3))).toEqual([true, true, true, false]);
  });

  test("a refusal taken but not yet traced is skipped by a caller that reads the same count", () => {
    const repo = tmp();
    expect(claimStopBlock(repo, RUN, 1, 3)).toBe(true);
    expect(existsSync(stopBlockPath(repo, RUN, 1))).toBe(true);
    expect(claimStopBlock(repo, RUN, 1, 3)).toBe(true);
    expect(existsSync(stopBlockPath(repo, RUN, 2))).toBe(true);
    expect(claimStopBlock(repo, RUN, 1, 3)).toBe(false);
    // the refusal traced before these files existed is never taken again
    expect(existsSync(stopBlockPath(repo, RUN, 0))).toBe(false);
  });

  test("a count already at the cap takes nothing and writes nothing", () => {
    const repo = tmp();
    expect(claimStopBlock(repo, RUN, 3, 3)).toBe(false);
    expect(claimStopBlock(repo, RUN, 5, 3)).toBe(false);
    expect(existsSync(stopBlocksDir(repo, RUN))).toBe(false);
  });

  test("runs are counted apart", () => {
    const repo = tmp();
    for (let i = 0; i < 3; i++) claimStopBlock(repo, RUN, 0, 3);
    expect(claimStopBlock(repo, RUN, 0, 3)).toBe(false);
    expect(claimStopBlock(repo, OTHER, 0, 3)).toBe(true);
  });

  test("the files live under the machine dir's stop-blocks/<run>/ and tidy sees them as the run's side files", () => {
    const repo = tmp();
    claimStopBlock(repo, RUN, 0, 3);
    expect(stopBlockPath(repo, RUN, 0)).toBe(join(machineDir(repo), "stop-blocks", RUN, "0"));
    expect(listRunTraces(repo).map((r) => ({ run_id: r.run_id, files: r.files }))).toEqual([{ run_id: RUN, files: [`stop-blocks/${RUN}`] }]);
  });
});
