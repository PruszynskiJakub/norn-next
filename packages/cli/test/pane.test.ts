/**
 * `norn pane` (O1 "a Herdr status pane"): renders the inbox via @norn/view, refreshing in a
 * loop, frames on the log stream (never stdout, P8), one JSON summary at exit, read only (X1).
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { runCli } from "../src/index.ts";
import { createHarness, type Harness } from "./harness.ts";

// whole flows over real git, several ticks each: 5 s is too tight on a loaded machine (full suite)
setDefaultTimeout(30_000);

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
  expect((await h.norn("init")).exit).toBe(0);
});
afterAll(() => h.cleanup());

describe("norn pane", () => {
  test("renders the inbox each interval, clears the screen, writes nothing", async () => {
    const before = h.git(["status", "--porcelain"]);
    const frames: string[] = [];
    const r = await runCli(["pane", "--interval", "1ms", "--max-frames", "2"], { ...h.deps, log: (l) => frames.push(l) });
    expect(r.exit).toBe(0);
    expect(r.value).toEqual({ frames: 2, interval: "1ms" });
    expect(frames).toHaveLength(2);
    for (const f of frames) {
      expect(f.startsWith("\x1b[H\x1b[2J")).toBe(true);
      expect(f).toContain("norn inbox");
      expect(f).toContain("Inbox empty");
    }
    expect(h.git(["status", "--porcelain"])).toBe(before);
  });

  test("bad --interval / --max-frames are usage errors", async () => {
    expect((await h.norn("pane", "--interval", "soon")).exit).toBe(2);
    expect((await h.norn("pane", "--max-frames", "0")).exit).toBe(2);
  });
});
