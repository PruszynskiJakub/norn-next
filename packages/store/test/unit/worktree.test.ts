import { describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "@norn/schema";
import { machineHolder, readEnvNorn, readUnitMarker, scanWorktrees, slotEnv, writeEnvNorn, writeUnitMarker } from "../../src/index.ts";
import { tmp } from "../helpers.ts";

describe("worktree files (A3, K4)", () => {
  test(".env.norn and .norn-unit", () => {
    const wt = tmp();
    const env = slotEnv(2, { ...DEFAULT_CONFIG.slots, env: { DB_NAME: "app_{slot}", API: "http://localhost:{port_base}" } });
    expect(env).toEqual({ NORN_SLOT: "2", PORT_BASE: "4020", DB_NAME: "app_2", API: "http://localhost:4020" });
    writeEnvNorn(wt, { ...env, ODD: 'a "b" c' });
    expect(readEnvNorn(wt)).toEqual({ ...env, ODD: 'a "b" c' });
    writeUnitMarker(wt, { repo: "/r", story: "gh-12", slice: null, unit: "_story", spec_dir: ".agents/specs/gh-12-x" });
    expect(readUnitMarker(wt)).toEqual({ exists: true, marker: { repo: "/r", story: "gh-12", slice: null, unit: "_story", spec_dir: ".agents/specs/gh-12-x" } });
    expect(readUnitMarker(tmp())).toEqual({ exists: false, marker: null });
  });
});

describe("scanWorktrees (GR3, A3; refactor 5.2)", () => {
  test("story and slice worktrees by folder shape and marker; anything else is skipped", () => {
    const parent = tmp();
    const root = join(parent, "app");
    const base = `${root}-worktrees`;
    const mark = (name: string, story: string, slice: string | null) => {
      mkdirSync(join(base, name), { recursive: true });
      writeUnitMarker(join(base, name), { repo: root, story, slice, unit: slice ? "01-form" : "_story", spec_dir: ".agents/specs/gh-7-login" });
    };
    mark("gh-7-login", "gh-7", null);
    // a slice folder named for its slice number; the slug may differ from the slice file's
    mark("gh-7-login--01-old-name", "gh-7", "gh-7/01");
    // marker names another story / another slice / a slice in a story-shaped folder
    mark("gh-8-other", "gh-9", null);
    mark("gh-7-login--02-api", "gh-7", "gh-7/03");
    mark("gh-10-misc", "gh-10", "gh-10/01");
    // not norn's shape, or no marker
    mark("scratch", "gh-11", null);
    mark("gh-7-login--01-x--y", "gh-7", "gh-7/01");
    mkdirSync(join(base, "gh-12-bare"), { recursive: true });
    const found = scanWorktrees(`${root}/`);
    expect(Object.fromEntries(found.stories)).toEqual({ "gh-7": join(base, "gh-7-login") });
    expect(Object.fromEntries(found.slices)).toEqual({ "gh-7/01": join(base, "gh-7-login--01-old-name") });
    expect(scanWorktrees(join(parent, "none"))).toEqual({ stories: new Map(), slices: new Map() });
  });
});

describe("machineHolder (R7.2)", () => {
  test("user@host from the environment, NORN_MACHINE overriding the host, one token", () => {
    expect(machineHolder({ USER: "ann", NORN_MACHINE: "box" })).toBe("ann@box");
    expect(machineHolder({ LOGNAME: "a b", NORN_MACHINE: "my@mac" })).toBe("a_b@my_mac");
    expect(machineHolder({ NORN_MACHINE: "box" })).toEndWith("@box");
  });
});
