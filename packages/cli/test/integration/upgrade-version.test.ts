/**
 * gh-61 B13, B15, B16, B17 (D9) at the CLI seam (S1): `norn upgrade` moves the repo's `norn_version`
 * to the running binary's, rewrites and relinks the bundled skills and runs the config moves, all
 * staged and nothing committed; with nothing to do it changes nothing; it never moves the version
 * back, and refuses before any write (`norn migrate` too).
 */
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { appendFileSync, lstatSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { validate } from "@norn/schema";
import { REPO_CONFIG_FILE, repoConfigPath } from "@norn/store";
import { createHarness, type Harness, runChecked, sh } from "../../../../test/support/harness.ts";

setDefaultTimeout(60_000);

const skill = (h: Harness, name: string) => join(h.root, ".agents", "skills", name, "SKILL.md");
const link = (h: Harness, name: string) => join(h.root, ".claude", "skills", name);
const teamFile = (h: Harness) => readFileSync(repoConfigPath(h.root), "utf8");
const porcelain = (h: Harness) => sh(h.root, ["status", "--porcelain", "--untracked-files=all"]).trimEnd();
const head = (h: Harness) => sh(h.root, ["rev-parse", "HEAD"]).trim();
const upgradeAs = (h: Harness, version: string, ...args: string[]) => runChecked(["upgrade", ...args], { ...h.deps, version });

/** A repo set up by norn `version` and committed; the binary under test is `running`. */
async function setUpAt(version: string, running: string): Promise<Harness> {
  const h = await createHarness({ version: running });
  expect((await runChecked(["init"], { ...h.deps, version })).exit).toBe(0);
  sh(h.root, ["add", "-A"]);
  sh(h.root, ["commit", "-q", "-m", "Set up norn"]);
  return h;
}

/** Every file under the checkout (outside `.git`) and, unless `repoOnly`, the norn home, with its bytes, and the git status. */
function snapshot(h: Harness, repoOnly = false): string[] {
  const list = (dir: string) =>
    (readdirSync(dir, { recursive: true }) as string[])
      .filter((p) => !p.startsWith(".git/") && p !== ".git")
      .map((p) => join(dir, p))
      .map((p) => (lstatSync(p).isFile() ? `${p}:${readFileSync(p, "utf8")}` : p));
  return [...list(h.root), ...(repoOnly ? [] : list(h.home)), porcelain(h)].sort();
}

/** Every change in the working tree is staged: no unstaged edit, nothing untracked. */
function expectAllStaged(h: Harness) {
  const lines = porcelain(h).split("\n").filter(Boolean);
  expect(lines.length).toBeGreaterThan(0);
  for (const l of lines) {
    expect(l.startsWith("??")).toBe(false);
    expect(l[1]).toBe(" ");
  }
}

describe("norn upgrade moves the version, the skills and the config in one staged diff (B13)", () => {
  test("AC1: 0.17.0 with a drifted skill, a missing link and a moved key → all moved to 0.19.0, staged, not committed", async () => {
    const h = await setUpAt("0.17.0", "0.19.0");
    try {
      const bundled = readFileSync(skill(h, "norn-plan"), "utf8");
      h.write(skill(h, "norn-plan"), "# 0.17.0's protocol\n");
      expect(lstatSync(link(h, "norn-plan")).isSymbolicLink()).toBe(true);
      rmSync(link(h, "norn-plan"));
      h.write(repoConfigPath(h.root), `${teamFile(h).replace("norn_version: 0.17.0", "norn_version: 0.17.0 # the team's norn")}remote: { provider: gh }\n`);
      sh(h.root, ["add", "-A"]);
      sh(h.root, ["commit", "-q", "-m", "an older norn's repo"]);
      const before = head(h);

      const r = await upgradeAs(h, "0.19.0");
      expect(r.exit).toBe(0);
      const team = teamFile(h);
      expect(team).toContain("norn_version: 0.19.0 # the team's norn");
      expect(team).toContain("# norn team config");
      expect(team).toMatch(/^provider: gh$/m);
      expect(team).not.toMatch(/^remote:/m);
      expect(readFileSync(skill(h, "norn-plan"), "utf8")).toBe(bundled);
      expect(lstatSync(link(h, "norn-plan")).isSymbolicLink()).toBe(true);
      expectAllStaged(h);
      expect(porcelain(h)).toContain(`M  ${REPO_CONFIG_FILE}`);
      expect(porcelain(h)).toContain("M  .agents/skills/norn-plan/SKILL.md");
      expect(head(h)).toBe(before);
      expect(r.stdout).toContain("norn version 0.17.0 → 0.19.0; skills updated: norn-plan; skills relinked: norn-plan; config: `remote.provider` → `provider`");
    } finally {
      h.cleanup();
    }
  });

  test("AC1: an agent folder the repo ignores → the link is recreated and not staged, the rest staged", async () => {
    const h = await setUpAt("0.17.0", "0.19.0");
    try {
      appendFileSync(join(h.root, ".gitignore"), ".claude/\n");
      sh(h.root, ["rm", "-r", "-q", "--cached", ".claude"]);
      sh(h.root, ["add", "-A"]);
      sh(h.root, ["commit", "-q", "-m", "ignore the agent folder"]);
      const bundled = readFileSync(skill(h, "norn-plan"), "utf8");
      rmSync(link(h, "norn-plan"));
      h.write(skill(h, "norn-plan"), "# 0.17.0's protocol\n");
      sh(h.root, ["commit", "-q", "-am", "drift"]);

      const r = await upgradeAs(h, "0.19.0", "--json");
      expect(r.exit).toBe(0);
      expect(lstatSync(link(h, "norn-plan")).isSymbolicLink()).toBe(true);
      expect(readFileSync(skill(h, "norn-plan"), "utf8")).toBe(bundled);
      expect(teamFile(h)).toMatch(/^norn_version: 0\.19\.0$/m);
      expectAllStaged(h);
      expect(porcelain(h)).toContain("M  .agents/skills/norn-plan/SKILL.md");
      expect(porcelain(h)).toContain(`M  ${REPO_CONFIG_FILE}`);
      expect(porcelain(h)).not.toContain(".claude/");
      expect(r.value).toMatchObject({ skills: { updated: ["norn-plan"], linked: ["norn-plan"] } });
      expect((r.value as { staged: string[] }).staged.some((p) => p.startsWith(".claude/"))).toBe(false);
    } finally {
      h.cleanup();
    }
  });

  test("AC1: a repo without the key gets it written and staged", async () => {
    const h = await setUpAt("0.19.0", "0.19.0");
    try {
      h.write(repoConfigPath(h.root), teamFile(h).replace(/^norn_version: .*\n/m, ""));
      sh(h.root, ["commit", "-q", "-am", "no version yet"]);
      const r = await upgradeAs(h, "0.19.0");
      expect(r.exit).toBe(0);
      expect(r.stdout).toContain("norn version (none) → 0.19.0");
      expect(teamFile(h)).toMatch(/^norn_version: 0\.19\.0$/m);
      expect(porcelain(h)).toBe(`M  ${REPO_CONFIG_FILE}`);
      sh(h.root, ["reset", "-q", "--hard"]);
      const json = await upgradeAs(h, "0.19.0", "--json");
      expect(json.value).toMatchObject({ norn_version: { from: null, to: "0.19.0", changed: true }, skills: { updated: [] }, staged: [REPO_CONFIG_FILE] });
    } finally {
      h.cleanup();
    }
  });
});

describe("norn upgrade with nothing to do changes nothing (B15)", () => {
  test("AC2: binary 0.19.0, repo at 0.19.0, skills matching → already on norn 0.19.0, git status clean", async () => {
    const h = await setUpAt("0.19.0", "0.19.0");
    try {
      const before = snapshot(h, true);
      const r = await upgradeAs(h, "0.19.0");
      expect(r.exit).toBe(0);
      expect(r.stdout).toContain("already on norn 0.19.0: nothing to upgrade");
      expect(porcelain(h)).toBe("");
      expect(snapshot(h, true)).toEqual(before);
      const json = await upgradeAs(h, "0.19.0", "--json");
      expect(json.value).toEqual({ moves: [], config: { changed: [], renamed: [], removed: [] }, norn_version: { from: "0.19.0", to: "0.19.0", changed: false }, skills: { updated: [], linked: [] }, staged: [], commit: null });
    } finally {
      h.cleanup();
    }
  });
});

describe("norn upgrade records a newer patch (B16)", () => {
  test("AC3: binary 0.19.2, repo at 0.19.0 → norn_version 0.19.2 and the skills refreshed; once committed, 0.19.1 is refused by tick", async () => {
    const h = await setUpAt("0.19.0", "0.19.2");
    try {
      const bundled = readFileSync(skill(h, "norn"), "utf8");
      h.write(skill(h, "norn"), "# 0.19.0's protocol\n");
      sh(h.root, ["commit", "-q", "-am", "0.19.0's skill"]);
      const r = await upgradeAs(h, "0.19.2", "--json");
      expect(r.exit).toBe(0);
      expect(teamFile(h)).toMatch(/^norn_version: 0\.19\.2$/m);
      expect(readFileSync(skill(h, "norn"), "utf8")).toBe(bundled);
      expect(r.value).toMatchObject({ norn_version: { from: "0.19.0", to: "0.19.2" }, skills: { updated: ["norn"] } });
      expectAllStaged(h);
      sh(h.root, ["commit", "-q", "-m", "Upgrade norn"]);
      const tick = await runChecked(["tick"], { ...h.deps, version: "0.19.1" });
      expect(tick.exit).toBe(3);
      expect(tick.value).toMatchObject({ code: "version_mismatch" });
    } finally {
      h.cleanup();
    }
  });
});

describe("norn upgrade never moves the version back (B17)", () => {
  for (const command of ["upgrade", "migrate"]) {
    test(`AC4: binary 0.18.1, repo at 0.19.0 → norn ${command} refused, exit 3, no file changed`, async () => {
      const h = await setUpAt("0.19.0", "0.18.1");
      try {
        // something upgrade would otherwise rewrite: a drifted skill and an old key
        h.write(skill(h, "norn-plan"), "# edited\n");
        h.write(repoConfigPath(h.root), `${teamFile(h)}remote: { provider: gh }\n`);
        sh(h.root, ["commit", "-q", "-am", "drift"]);
        const before = snapshot(h);
        const r = await runChecked([command, "--json"], { ...h.deps, version: "0.18.1" });
        expect(r.exit).toBe(3);
        expect(validate("cli-error", r.value).ok).toBe(true);
        expect(r.value).toMatchObject({ error: "this repo is set up for norn 0.19.0; upgrade will not move it back", do_instead: "install norn 0.19.x", code: "version_backward" });
        expect(snapshot(h)).toEqual(before);
      } finally {
        h.cleanup();
      }
    });
  }
});
