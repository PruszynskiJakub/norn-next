/**
 * The harness's `h.config(...)` keeps the team file's recorded `norn_version` after `norn init`: a test
 * that rewrites config must not leave its repo looking like one norn was never set up in.
 */
import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { repoConfigPath } from "@norn/store";
import { parse as parseYaml } from "yaml";
import { createHarness, type Harness } from "../../../../test/support/harness.ts";

setDefaultTimeout(30_000);

let h: Harness;
const team = () => parseYaml(h.read(repoConfigPath(h.root))) as Record<string, unknown>;

beforeEach(async () => {
  h = await createHarness({ version: "0.31.2" });
  expect((await h.norn("init")).exit).toBe(0);
});
afterEach(() => h.cleanup());

describe("h.config after norn init", () => {
  test("config with no team keys keeps the team file and its norn_version", () => {
    h.config("mode: manual\nmax_agents: 2\n");
    expect(existsSync(repoConfigPath(h.root))).toBe(true);
    expect(team()).toEqual({ norn_version: "0.31.2" });
  });

  test("empty config keeps the team file and its norn_version", () => {
    h.config("");
    expect(team()).toEqual({ norn_version: "0.31.2" });
  });

  test("team keys are written with the norn_version, the version first", () => {
    h.config("provider: gh\nworkflow: ship\nmode: manual\n");
    expect(team()).toEqual({ norn_version: "0.31.2", provider: "gh", workflow: "ship" });
    expect(Object.keys(team())[0]).toBe("norn_version");
  });

  test("a norn_version the test sets wins over the recorded one", () => {
    h.config("norn_version: 0.19.0\nprovider: gh\n");
    expect(team()).toEqual({ norn_version: "0.19.0", provider: "gh" });
  });
});
