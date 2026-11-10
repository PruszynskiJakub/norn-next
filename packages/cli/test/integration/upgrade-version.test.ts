/**
 * `norn upgrade` on a repo from norn 0.30 on: it rewrites and relinks the bundled skills and moves
 * the repo's `norn_version` to the running binary's, last, all staged and nothing committed, printing
 * the commit to make; a rerun finishes an interrupted run; with nothing to do it changes nothing;
 * it never moves the version back.
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

describe("norn upgrade moves the skills and the version in one staged diff", () => {
  test("0.30.0 with a drifted skill and a missing link → both fixed, norn_version 0.31.0, staged, not committed, the commit printed", async () => {
    const h = await setUpAt("0.30.0", "0.31.0");
    try {
      const bundled = readFileSync(skill(h, "norn-plan"), "utf8");
      h.write(skill(h, "norn-plan"), "# 0.30.0's protocol\n");
      expect(lstatSync(link(h, "norn-plan")).isSymbolicLink()).toBe(true);
      rmSync(link(h, "norn-plan"));
      h.write(repoConfigPath(h.root), teamFile(h).replace("norn_version: 0.30.0", "norn_version: 0.30.0 # the team's norn"));
      sh(h.root, ["add", "-A"]);
      sh(h.root, ["commit", "-q", "-m", "a 0.30 repo"]);
      const before = head(h);

      const r = await upgradeAs(h, "0.31.0");
      expect(r.exit).toBe(0);
      const team = teamFile(h);
      expect(team).toContain("norn_version: 0.31.0 # the team's norn");
      expect(team).toContain("# norn team config");
      expect(readFileSync(skill(h, "norn-plan"), "utf8")).toBe(bundled);
      expect(lstatSync(link(h, "norn-plan")).isSymbolicLink()).toBe(true);
      expectAllStaged(h);
      expect(porcelain(h)).toContain(`M  ${REPO_CONFIG_FILE}`);
      expect(porcelain(h)).toContain("M  .agents/skills/norn-plan/SKILL.md");
      expect(head(h)).toBe(before);
      expect(r.stdout).toContain("norn version 0.30.0 → 0.31.0; skills updated: norn-plan; skills relinked: norn-plan");
      expect(r.stdout.trimEnd().split("\n").at(-1)).toContain('`git commit -m "Upgrade norn to 0.31.0 (norn upgrade)"`');
    } finally {
      h.cleanup();
    }
  });

  test("an agent folder the repo ignores → the link is recreated and not staged, the rest staged", async () => {
    const h = await setUpAt("0.30.0", "0.31.0");
    try {
      appendFileSync(join(h.root, ".gitignore"), ".claude/\n");
      sh(h.root, ["rm", "-r", "-q", "--cached", ".claude"]);
      sh(h.root, ["add", "-A"]);
      sh(h.root, ["commit", "-q", "-m", "ignore the agent folder"]);
      const bundled = readFileSync(skill(h, "norn-plan"), "utf8");
      rmSync(link(h, "norn-plan"));
      h.write(skill(h, "norn-plan"), "# 0.30.0's protocol\n");
      sh(h.root, ["commit", "-q", "-am", "drift"]);

      const r = await upgradeAs(h, "0.31.0", "--json");
      expect(r.exit).toBe(0);
      expect(lstatSync(link(h, "norn-plan")).isSymbolicLink()).toBe(true);
      expect(readFileSync(skill(h, "norn-plan"), "utf8")).toBe(bundled);
      expect(teamFile(h)).toMatch(/^norn_version: 0\.31\.0$/m);
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

  test("interrupted after the skills, before the version → a rerun records the new version", async () => {
    const h = await setUpAt("0.30.0", "0.31.0");
    try {
      const bundled = readFileSync(skill(h, "norn-plan"), "utf8");
      h.write(skill(h, "norn-plan"), "# 0.30.0's protocol\n");
      sh(h.root, ["commit", "-q", "-am", "0.30.0's skill"]);
      // what a run cut short before `norn_version` leaves: the skill rewritten, the version still 0.30.0
      h.write(skill(h, "norn-plan"), bundled);
      expect(teamFile(h)).toMatch(/^norn_version: 0\.30\.0$/m);

      const r = await upgradeAs(h, "0.31.0", "--json");
      expect(r.exit).toBe(0);
      expect(teamFile(h)).toMatch(/^norn_version: 0\.31\.0$/m);
      expect(r.value).toMatchObject({ norn_version: { from: "0.30.0", to: "0.31.0", changed: true }, commit: 'git commit -m "Upgrade norn to 0.31.0 (norn upgrade)"' });
      expect(porcelain(h)).toContain(`M  ${REPO_CONFIG_FILE}`);
    } finally {
      h.cleanup();
    }
  });
});

describe("norn upgrade with nothing to do changes nothing", () => {
  test("binary 0.31.0, repo at 0.31.0, skills and links matching → already on norn 0.31.0, nothing staged, commit null", async () => {
    const h = await setUpAt("0.31.0", "0.31.0");
    try {
      const before = snapshot(h, true);
      const r = await upgradeAs(h, "0.31.0");
      expect(r.exit).toBe(0);
      expect(r.stdout).toContain("already on norn 0.31.0: nothing to upgrade");
      expect(porcelain(h)).toBe("");
      expect(snapshot(h, true)).toEqual(before);
      const json = await upgradeAs(h, "0.31.0", "--json");
      expect(json.value).toEqual({ norn_version: { from: "0.31.0", to: "0.31.0", changed: false }, skills: { updated: [], linked: [] }, staged: [], commit: null, labels: expect.objectContaining({ checked: true, created: [] }) });
      expect(porcelain(h)).toBe("");
    } finally {
      h.cleanup();
    }
  });

  test("only a skill differs → the skill is rewritten and staged, the commit is Refresh norn's skills", async () => {
    const h = await setUpAt("0.31.0", "0.31.0");
    try {
      h.write(skill(h, "norn-plan"), "# edited\n");
      sh(h.root, ["commit", "-q", "-am", "drift"]);
      const r = await upgradeAs(h, "0.31.0", "--json");
      expect(r.exit).toBe(0);
      expect(r.value).toMatchObject({ norn_version: { from: "0.31.0", to: "0.31.0", changed: false }, skills: { updated: ["norn-plan"] }, staged: [".agents/skills/norn-plan"], commit: `git commit -m "Refresh norn's skills (norn upgrade)"` });
      expect(teamFile(h)).toMatch(/^norn_version: 0\.31\.0$/m);
      expectAllStaged(h);
    } finally {
      h.cleanup();
    }
  });
});

describe("norn upgrade records a newer patch", () => {
  test("binary 0.30.2, repo at 0.30.0 → norn_version 0.30.2 and the skills refreshed; once committed, 0.30.1 is refused by tick", async () => {
    const h = await setUpAt("0.30.0", "0.30.2");
    try {
      const bundled = readFileSync(skill(h, "norn"), "utf8");
      h.write(skill(h, "norn"), "# 0.30.0's protocol\n");
      sh(h.root, ["commit", "-q", "-am", "0.30.0's skill"]);
      const r = await upgradeAs(h, "0.30.2", "--json");
      expect(r.exit).toBe(0);
      expect(teamFile(h)).toMatch(/^norn_version: 0\.30\.2$/m);
      expect(readFileSync(skill(h, "norn"), "utf8")).toBe(bundled);
      expect(r.value).toMatchObject({ norn_version: { from: "0.30.0", to: "0.30.2" }, skills: { updated: ["norn"] } });
      expectAllStaged(h);
      sh(h.root, ["commit", "-q", "-m", "Upgrade norn"]);
      const tick = await runChecked(["tick"], { ...h.deps, version: "0.30.1" });
      expect(tick.exit).toBe(3);
      expect(tick.value).toMatchObject({ code: "version_mismatch" });
    } finally {
      h.cleanup();
    }
  });
});

describe("norn upgrade never moves the version back", () => {
  test("binary 0.30.5, repo at 0.31.0 → refused, exit 3, version_backward, no file changed", async () => {
    const h = await setUpAt("0.31.0", "0.30.5");
    try {
      // something upgrade would otherwise rewrite: a drifted skill
      h.write(skill(h, "norn-plan"), "# edited\n");
      sh(h.root, ["commit", "-q", "-am", "drift"]);
      const before = snapshot(h);
      const r = await upgradeAs(h, "0.30.5", "--json");
      expect(r.exit).toBe(3);
      expect(validate("cli-error", r.value).ok).toBe(true);
      expect(r.value).toMatchObject({ error: "this repo is set up for norn 0.31.0; upgrade will not move it back", do_instead: "install norn 0.31.x", code: "version_backward" });
      expect(snapshot(h)).toEqual(before);
    } finally {
      h.cleanup();
    }
  });
});
