import { describe, expect, test } from "bun:test";
import { ancestorPids, chainOf, envFromEnviron, parentFromStat, readParents, readPsEnvs } from "../../src/index.ts";

const NAMES = ["NORN_UNIT", "NORN_RUN_ID"] as const;

describe("reading a process's ancestry", () => {
  test("the chain climbs from the parent to the last process below init, whatever order ps lists them in", () => {
    const parents = readParents("    1     0\n  500   400\n  400   300\n  300     1\n  777   300\n");
    expect(chainOf(parents, 500)).toEqual([500, 400, 300]);
  });

  test("the chain stops at a pid ps no longer lists and never loops on a cycle", () => {
    expect(chainOf(readParents("500 400\n400 999\n"), 500)).toEqual([500, 400]);
    expect(chainOf(readParents("500 400\n400 500\n"), 500)).toEqual([500, 400]);
    expect(chainOf(readParents(""), 500)).toEqual([]);
  });

  test("a table that does not list a live parent is unreadable, never an empty chain", () => {
    expect(ancestorPids("500 400\n400 1\n", 500)).toEqual([500, 400]);
    // a ps that prints nothing would otherwise read as a process with no marked ancestor
    expect(() => ancestorPids("", 500)).toThrow(/does not list/);
    expect(() => ancestorPids("400 1\n", 500)).toThrow(/does not list/);
    // a parent of 1 is a process reparented to init: no ancestors to read, and no table needed
    expect(ancestorPids("", 1)).toEqual([]);
  });

  test("an ancestor's start env is read from ps -E, the env after the command, a blank value kept as blank", () => {
    const envs = readPsEnvs(
      [
        "  400 claude --resume abc HOME=/home/me NORN_UNIT=gh-7/slice-1 NORN_RUN_ID=01JABC PATH=/bin",
        "  300 -zsh",
        "  200 sh -c x NORN_RUN_ID= TERM=xterm",
      ].join("\n"),
      NAMES,
    );
    expect(envs.get(400)).toEqual({ NORN_UNIT: "gh-7/slice-1", NORN_RUN_ID: "01JABC" });
    // macOS shows no env at all for its own system binaries (sh, zsh): unknown, never an empty env
    expect(envs.get(300)).toBeNull();
    expect(envs.get(200)).toEqual({ NORN_RUN_ID: "" });
    expect(envs.has(100)).toBe(false);
  });

  test("a name only part of another variable's name is not that variable", () => {
    expect(readPsEnvs("400 node --flag=1 MY_NORN_UNIT=x XNORN_RUN_ID=y", NAMES).get(400)).toEqual({});
  });

  test("on Linux the start env and the parent are read from /proc", () => {
    expect(envFromEnviron("HOME=/home/me\0NORN_UNIT=gh-7\0NORN_RUN_ID=01JABC\0MY_NORN_UNIT=x\0", NAMES)).toEqual({ NORN_UNIT: "gh-7", NORN_RUN_ID: "01JABC" });
    // the command name may hold spaces and parentheses, so the fields are read after its last `)`
    expect(parentFromStat("4242 (my (odd) cmd) S 4100 4242 4242 0 -1")).toBe(4100);
    expect(parentFromStat("garbage")).toBeNull();
  });
});
