/**
 * `norn upgrade` moves a repo from norn 0.30 on: before any write it refuses a run outside the main
 * checkout, a repo below the 0.30 baseline or recording no version (the baseline rule's text), and a
 * running tick; its `--json` holds only what it still does; it never touches old config keys,
 * criteria `needs` or `.gitattributes`. `norn migrate` is gone.
 */
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { lstatSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { versionBaseline } from "@norn/core";
import { validate } from "@norn/schema";
import { acquireTickLock, REPO_CONFIG_FILE, repoConfigPath } from "@norn/store";
import type { CliResult } from "../../src/index.ts";
import { createHarness, type Harness, PRE_013_NORN_DIR, runChecked, sh } from "../../../../test/support/harness.ts";

setDefaultTimeout(60_000);

const RUNNING = "0.31.0";
/** where a pre-0.13 norn kept the team config */
const OLD_CONFIG = `${PRE_013_NORN_DIR}/config.yaml`;
const skill = (h: Harness, name: string) => join(h.root, ".agents", "skills", name, "SKILL.md");
const link = (h: Harness, name: string) => join(h.root, ".claude", "skills", name);
const teamFile = (h: Harness) => readFileSync(repoConfigPath(h.root), "utf8");
const porcelain = (h: Harness) => sh(h.root, ["status", "--porcelain", "--untracked-files=all"]).trimEnd();

/** A repo set up by norn 0.30.0 and committed, with a drifted skill and a missing link upgrade would otherwise fix; the binary under test is 0.31.0. */
async function repoAt030(): Promise<Harness> {
  const h = await createHarness({ version: RUNNING });
  expect((await runChecked(["init"], { ...h.deps, version: "0.30.0" })).exit).toBe(0);
  h.write(skill(h, "norn-plan"), "# 0.30.0's protocol\n");
  rmSync(link(h, "norn-plan"));
  sh(h.root, ["add", "-A"]);
  sh(h.root, ["commit", "-q", "-m", "Set up norn 0.30.0"]);
  return h;
}

/** Set (or, with null, remove) the team file's `norn_version`, committed. */
function recordVersion(h: Harness, v: string | null): void {
  const kept = teamFile(h).replace(/^norn_version:.*\n?/m, "");
  h.write(repoConfigPath(h.root), v === null ? kept : `${kept}norn_version: ${v}\n`);
  sh(h.root, ["commit", "-q", "-am", `norn_version ${v ?? "(none)"}`]);
}

/** Every file under the checkout (outside `.git`) and the norn home, with its bytes, and the git status. */
function snapshot(h: Harness): string[] {
  const list = (dir: string) =>
    (readdirSync(dir, { recursive: true }) as string[])
      .filter((p) => !p.startsWith(".git/") && p !== ".git")
      .map((p) => join(dir, p))
      .map((p) => (lstatSync(p).isFile() ? `${p}:${readFileSync(p, "utf8")}` : p));
  return [...list(h.root), ...list(h.home), porcelain(h)].sort();
}

function expectRefused(r: CliResult, code: string) {
  expect(r.exit).toBe(3);
  expect(r.value).toMatchObject({ code });
  expect(validate("cli-error", r.value).ok).toBe(true);
}

describe("norn upgrade refuses before any write", () => {
  test("a repo recording 0.29.4: version_too_old with the baseline rule's 0.30.x path, nothing staged or rewritten", async () => {
    const h = await repoAt030();
    try {
      recordVersion(h, "0.29.4");
      const before = snapshot(h);
      const r = await h.norn("upgrade", "--json");
      expectRefused(r, "version_too_old");
      const rule = versionBaseline("0.29.4", RUNNING);
      expect(r.value).toMatchObject({ error: rule?.error, do_instead: rule?.do_instead });
      expect((r.value as { do_instead: string }).do_instead).toBe("install norn 0.30.x, run `norn upgrade`, commit, then run `norn upgrade` again with norn 0.31.0");
      expect(snapshot(h)).toEqual(before);
    } finally {
      h.cleanup();
    }
  });

  test("a repo recording no norn_version: version_missing, its do_instead naming norn init, nothing staged or rewritten", async () => {
    const h = await repoAt030();
    try {
      recordVersion(h, null);
      const before = snapshot(h);
      const r = await h.norn("upgrade", "--json");
      expectRefused(r, "version_missing");
      const rule = versionBaseline(null, RUNNING);
      expect(r.value).toMatchObject({ error: rule?.error, do_instead: rule?.do_instead });
      expect((r.value as { do_instead: string }).do_instead).toContain("`norn init`");
      expect(snapshot(h)).toEqual(before);
    } finally {
      h.cleanup();
    }
  });

  test("a repo with only the pre-0.13 config file is a repo with no version: version_missing, the old file untouched", async () => {
    const h = await repoAt030();
    try {
      mkdirSync(dirname(join(h.root, OLD_CONFIG)));
      sh(h.root, ["mv", REPO_CONFIG_FILE, OLD_CONFIG]);
      sh(h.root, ["commit", "-q", "-m", "an old layout"]);
      const before = snapshot(h);
      expectRefused(await h.norn("upgrade", "--json"), "version_missing");
      expect(snapshot(h)).toEqual(before);
    } finally {
      h.cleanup();
    }
  });

  test("while watch holds the tick lock: tick_locked, do_instead to stop watch and run it again; a rerun is refused the same way", async () => {
    const h = await repoAt030();
    try {
      const lock = await acquireTickLock(h.root, { note: "norn watch" });
      if (!lock.ok) throw new Error("could not take the tick lock");
      try {
        const before = snapshot(h);
        const r = await h.norn("upgrade", "--json");
        expectRefused(r, "tick_locked");
        expect((r.value as { do_instead: string }).do_instead).toBe("stop `norn watch` and run it again");
        expect((await h.norn("upgrade", "--json")).value).toEqual(r.value);
        expect(snapshot(h)).toEqual(before);
      } finally {
        lock.release();
      }
    } finally {
      h.cleanup();
    }
  });

  test("in a linked worktree: not_main_checkout, do_instead naming the main checkout's path, nothing changed", async () => {
    const h = await repoAt030();
    try {
      const wt = `${h.root}-wt`;
      sh(h.root, ["worktree", "add", "-q", "-b", "elsewhere", wt]);
      const before = snapshot(h);
      const r = await runChecked(["upgrade", "--json"], { ...h.deps, cwd: wt });
      expectRefused(r, "not_main_checkout");
      expect((r.value as { do_instead: string }).do_instead).toBe(`cd ${h.root} && norn upgrade`);
      expect(snapshot(h)).toEqual(before);
      expect(sh(wt, ["status", "--porcelain"]).trim()).toBe("");
    } finally {
      rmSync(`${h.root}-wt`, { recursive: true, force: true });
      h.cleanup();
    }
  });
});

describe("norn upgrade --json", () => {
  test("holds exactly norn_version {from, to, changed}, skills {updated, linked}, staged, commit and labels", async () => {
    const h = await repoAt030();
    try {
      const r = await h.norn("upgrade", "--json");
      expect(r.exit).toBe(0);
      const v = r.value as Record<string, unknown>;
      expect(Object.keys(v).sort()).toEqual(["commit", "labels", "norn_version", "skills", "staged"]);
      for (const gone of ["moves", "config", "run_state", "gitattributes"]) expect(v).not.toHaveProperty(gone);
      expect(Object.keys(v.norn_version as object).sort()).toEqual(["changed", "from", "to"]);
      expect(Object.keys(v.skills as object).sort()).toEqual(["linked", "updated"]);
      expect(v).toMatchObject({
        norn_version: { from: "0.30.0", to: "0.31.0", changed: true },
        skills: { updated: ["norn-plan"], linked: ["norn-plan"] },
        commit: 'git commit -m "Upgrade norn to 0.31.0 (norn upgrade)"',
      });
    } finally {
      h.cleanup();
    }
  });
});

describe("norn upgrade leaves old config keys, criteria needs and .gitattributes alone", () => {
  const SLICE = `---
id: gh-12/02
title: Two
depends_on: []
status: planned
criteria:
  - { id: c1, verifier: agent, needs: [browser] }
---

Body
`;
  const SPEC = `---
id: gh-12
title: X
criteria:
  - { id: "02.c1", verifier: agent, needs: [browser] }
---

# X
`;
  const ATTRIBUTES = "# norn (machine state, collapsed in diffs)\n.agents/specs/*/runs/** linguist-generated=true gitlab-generated=true\n";
  const USER_OLD = "default_mode: auto\n";

  test("none of those files change or is staged; config validation still flags the old key, without pointing to norn upgrade", async () => {
    const h = await repoAt030();
    try {
      const slice = join(h.root, ".agents/specs/gh-12-x/slices/02-two.md");
      const spec = join(h.root, ".agents/specs/gh-12-x/spec.md");
      h.write(slice, SLICE);
      h.write(spec, SPEC);
      h.write(join(h.root, ".gitattributes"), ATTRIBUTES);
      sh(h.root, ["add", "-A"]);
      sh(h.root, ["commit", "-q", "-m", "an older norn's files"]);
      h.write(join(h.home, "config.yaml"), USER_OLD);

      const r = await h.norn("upgrade", "--json");
      expect(h.read(slice)).toBe(SLICE);
      expect(h.read(spec)).toBe(SPEC);
      expect(h.read(join(h.root, ".gitattributes"))).toBe(ATTRIBUTES);
      expect(h.read(join(h.home, "config.yaml"))).toBe(USER_OLD);
      expect(porcelain(h)).toBe("");
      // the old key is the config's own error (exit 6), never rewritten
      expect(r.exit).toBe(6);
      const message = JSON.stringify(r.value);
      expect(message).toContain("`default_mode` is now `mode`");
      expect(message).not.toContain("norn upgrade");
      const list = await h.norn("config", "list", "--json");
      expect(JSON.stringify(list.value)).toContain("`default_mode` is now `mode`");
      expect(JSON.stringify(list.value)).not.toContain("norn upgrade");
    } finally {
      h.cleanup();
    }
  });

  test("with a valid config the upgrade succeeds and the slice, spec and .gitattributes stay unchanged and unstaged", async () => {
    const h = await repoAt030();
    try {
      const slice = join(h.root, ".agents/specs/gh-12-x/slices/02-two.md");
      h.write(slice, SLICE);
      h.write(join(h.root, ".agents/specs/gh-12-x/spec.md"), SPEC);
      h.write(join(h.root, ".gitattributes"), ATTRIBUTES);
      sh(h.root, ["add", "-A"]);
      sh(h.root, ["commit", "-q", "-m", "an older norn's files"]);
      const r = await h.norn("upgrade", "--json");
      expect(r.exit).toBe(0);
      expect(h.read(slice)).toBe(SLICE);
      expect(h.read(join(h.root, ".gitattributes"))).toBe(ATTRIBUTES);
      expect((r.value as { staged: string[] }).staged.filter((p) => p.startsWith(".agents/specs") || p === ".gitattributes")).toEqual([]);
      expect(porcelain(h)).not.toMatch(/specs|gitattributes/);
    } finally {
      h.cleanup();
    }
  });
});

describe("norn migrate is gone", () => {
  test("it fails as an unknown command like any other, and norn help lists no migrate", async () => {
    const h = await repoAt030();
    try {
      const mig = await h.norn("migrate", "--json");
      const other = await h.norn("frobnicate", "--json");
      expect(mig.exit).toBe(other.exit);
      expect(mig.exit).not.toBe(0);
      expect((mig.value as { code?: string }).code).toBe((other.value as { code?: string }).code);
      for (const args of [["help"], ["help", "--all"], ["help", "--all", "--json"]]) expect((await h.norn(...args)).stdout).not.toMatch(/\bmigrate\b/);
    } finally {
      h.cleanup();
    }
  });
});
