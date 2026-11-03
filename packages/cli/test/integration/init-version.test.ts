/**
 * gh-61 B1, B28 (D10) at the CLI seam (S1): `norn init` records the running norn's version in a
 * repo that has none, and on a repo set up for another version sets up the machine, copies in a
 * missing bundled skill, and leaves the version and a differing skill alone, pointing at
 * `norn upgrade`. With the binary on the repo's version it repairs the skills as before.
 */
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { REPO_CONFIG_FILE, repoConfigPath, userConfigPath } from "@norn/store";
import { createHarness, type Harness, runChecked, sh } from "../../../../test/support/harness.ts";

setDefaultTimeout(60_000);

const skill = (h: Harness, name: string) => join(h.root, ".agents", "skills", name, "SKILL.md");
const teamFile = (h: Harness) => readFileSync(repoConfigPath(h.root), "utf8");

/** A repo set up and committed by norn `version`, then run by a binary of `running` on a machine with no norn files yet. */
async function setUpAt(version: string, running: string): Promise<Harness> {
  const h = await createHarness({ version: running });
  expect((await runChecked(["init"], { ...h.deps, version })).exit).toBe(0);
  sh(h.root, ["add", "-A"]);
  sh(h.root, ["commit", "-q", "-m", "Set up norn"]);
  rmSync(userConfigPath(h.home));
  return h;
}

describe("norn init records the version once and never moves it (B1, B28)", () => {
  test("AC1 B1: a repo with no norn_version gets the binary's, uncommitted, and init says so", async () => {
    const h = await createHarness({ version: "0.19.0" });
    try {
      const r = await h.norn("init");
      expect(r.exit).toBe(0);
      expect(teamFile(h)).toMatch(/^norn_version: 0\.19\.0$/m);
      expect(r.stdout).toContain("norn version: 0.19.0 (recorded)");
      // in the working tree with the rest of init's changes, not committed
      expect(sh(h.root, ["status", "--porcelain", "--untracked-files=all"])).toContain(REPO_CONFIG_FILE);
      expect(sh(h.root, ["log", "--oneline"]).trim().split("\n")).toHaveLength(1);
      const json = (await h.norn("init", "--json")).value as { norn_version: unknown };
      expect(json.norn_version).toEqual({ repo: "0.19.0", running: "0.19.0", recorded: false, skills_kept: [] });
    } finally {
      h.cleanup();
    }
  });

  test("B1: an existing team file keeps its comments when the key is added", async () => {
    const h = await createHarness({ version: "0.19.0" });
    try {
      h.write(repoConfigPath(h.root), "# the team's settings\nprovider: gh # where issues live\n");
      expect((await h.norn("init")).exit).toBe(0);
      expect(teamFile(h)).toBe("# the team's settings\nprovider: gh # where issues live\nnorn_version: 0.19.0\n");
    } finally {
      h.cleanup();
    }
  });

  test("AC2 B28: a newer binary sets up the machine, copies a missing skill, keeps the version and an edited skill", async () => {
    const h = await setUpAt("0.19.0", "0.19.2");
    try {
      const before = teamFile(h);
      h.write(skill(h, "norn-plan"), "# my edit\n");
      rmSync(join(h.root, ".agents", "skills", "norn-merge"), { recursive: true });
      const r = await h.norn("init");
      expect(r.exit).toBe(0);
      expect(existsSync(userConfigPath(h.home))).toBe(true);
      expect(existsSync(skill(h, "norn-merge"))).toBe(true);
      expect(readFileSync(skill(h, "norn-plan"), "utf8")).toBe("# my edit\n");
      expect(teamFile(h)).toBe(before);
      expect(r.stdout).toContain("this repo is on norn 0.19.0, you run 0.19.2: `norn upgrade` moves it");
      expect(r.stdout).toContain("norn-plan");
      const json = (await h.norn("init", "--json")).value as { norn_version: unknown };
      expect(json.norn_version).toEqual({ repo: "0.19.0", running: "0.19.2", recorded: false, skills_kept: ["norn-plan"] });
    } finally {
      h.cleanup();
    }
  });

  test("AC3 B28: with the binary on the repo's version, init repairs a drifted skill as before", async () => {
    const h = await setUpAt("0.19.0", "0.19.0");
    try {
      const bundled = readFileSync(skill(h, "norn-plan"), "utf8");
      h.write(skill(h, "norn-plan"), "# my edit\n");
      const r = await h.norn("init");
      expect(r.exit).toBe(0);
      expect(readFileSync(skill(h, "norn-plan"), "utf8")).toBe(bundled);
      expect(r.stdout).not.toContain("norn upgrade");
      expect(r.stdout).toContain("norn version: 0.19.0");
    } finally {
      h.cleanup();
    }
  });
});
