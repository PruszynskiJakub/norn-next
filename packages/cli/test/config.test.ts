/** `norn config` (K2): the resolved config with the layer each value came from. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { ConfigEntry } from "@norn/schema";
import { createHarness, type Harness } from "./harness.ts";

describe("norn config", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
    h.write(join(h.home, "config.yaml"), "runner: { adapter: herdr }\ndefault_mode: auto\nmax_agents: 3\n");
    h.write(join(h.root, ".agents/norn/config.yaml"), "runner: null\nmax_agents: 5\nlimits: { deadline: 30m }\n");
  });
  afterAll(() => h.cleanup());

  test("--json lists every setting with its source, and notes what the layering hides", async () => {
    const r = await h.norn("config", "--json");
    expect(r.exit).toBe(0);
    const v = r.value as { files: { user: { exists: boolean }; repo: { exists: boolean } }; entries: Array<ConfigEntry & { meaning: string }>; notes: string[] };
    expect(v.files.user.exists).toBe(true);
    expect(v.files.repo.exists).toBe(true);
    const by = (k: string) => v.entries.find((e) => e.key === k);
    expect(by("runner")).toMatchObject({ value: null, source: "repo", group: "machine" });
    expect(by("default_mode")).toMatchObject({ value: "auto", source: "user", meaning: expect.stringContaining("who starts") });
    expect(by("max_agents")).toMatchObject({ value: 3, source: "user", repo_ignored: 5 });
    expect(by("limits.deadline")).toMatchObject({ value: "30m", source: "repo" });
    expect(v.notes).toEqual(
      expect.arrayContaining([
        expect.stringContaining("no `runner`"),
        expect.stringContaining("`runner` is set by the repo"),
        expect.stringContaining("`max_agents`: the repo's `5` does not apply"),
        expect.stringContaining("`--permission-mode`"),
      ]),
    );
  });

  test("prints markdown grouped by who a setting belongs to", async () => {
    const r = await h.norn("config");
    expect(r.exit).toBe(0);
    expect(r.stdout).toContain("## This machine (usually in the user file)");
    expect(r.stdout).toContain("| `runner` | none | repo |");
    expect(r.stdout).toContain("| `base_branch` | the remote's default branch | built-in |");
  });

  test("a key narrows to that setting or everything under it; an unknown key is a usage error", async () => {
    const one = await h.norn("config", "limits", "--json");
    expect((one.value as { entries: ConfigEntry[] }).entries.map((e) => e.key)).toEqual(["limits.deadline", "limits.nudges", "limits.retries", "limits.stalled", "limits.attended_wait"]);
    const bad = await h.norn("config", "nope", "--json");
    expect(bad.exit).toBe(2);
    expect(bad.value).toMatchObject({ code: "unknown_key", do_instead: "norn config" });
  });
});
