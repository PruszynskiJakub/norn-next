/** Skills on disk (SK1): one committed copy in `.agents/skills/`, linked from each agent's folder. */
import { describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LEGACY_SKILL_MARKER, installSkills, linkSkills, removeSkills, skillsReport, visibleSkills } from "../../src/index.ts";
import { tmp } from "../helpers.ts";

function write(path: string, text: string) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}

/** A bundled skills folder: `norn-a` with a supporting file, `norn-b` with SKILL.md only. */
function bundle(): string {
  const src = join(tmp(), "skills");
  write(join(src, "norn-a", "SKILL.md"), "---\nname: norn-a\n---\nA v1\n");
  write(join(src, "norn-a", "ref", "tests.md"), "tests\n");
  write(join(src, "norn-b", "SKILL.md"), "---\nname: norn-b\n---\nB v1\n");
  return src;
}

describe("installSkills", () => {
  test("copies whole folders into .agents/skills and reports what changed", () => {
    const src = bundle();
    const root = tmp();
    expect(installSkills(root, src, ["norn-a", "norn-b"])).toEqual({ dir: join(root, ".agents/skills"), updated: ["norn-a", "norn-b"], unchanged: [] });
    expect(readFileSync(join(root, ".agents/skills/norn-a/ref/tests.md"), "utf8")).toBe("tests\n");
    expect(installSkills(root, src, ["norn-a", "norn-b"]).unchanged).toEqual(["norn-a", "norn-b"]);
  });

  test("overwrites local edits and removes files the bundled version no longer has", () => {
    const src = bundle();
    const root = tmp();
    installSkills(root, src, ["norn-a"]);
    writeFileSync(join(root, ".agents/skills/norn-a/SKILL.md"), "my edit\n");
    write(join(root, ".agents/skills/norn-a/extra.md"), "stale\n");
    expect(installSkills(root, src, ["norn-a"]).updated).toEqual(["norn-a"]);
    expect(readFileSync(join(root, ".agents/skills/norn-a/SKILL.md"), "utf8")).toBe("---\nname: norn-a\n---\nA v1\n");
    expect(existsSync(join(root, ".agents/skills/norn-a/extra.md"))).toBe(false);
  });
});

describe("linkSkills", () => {
  test("links each skill from the agent folder to .agents/skills, relatively", () => {
    const src = bundle();
    const root = tmp();
    installSkills(root, src, ["norn-a", "norn-b"]);
    const dir = join(root, ".claude/skills");
    expect(linkSkills(root, dir, ["norn-a", "norn-b"])).toEqual({ dir, linked: ["norn-a", "norn-b"], unchanged: [], kept: [] });
    expect(lstatSync(join(dir, "norn-a")).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(dir, "norn-a"))).toBe(join("..", "..", ".agents", "skills", "norn-a"));
    expect(readFileSync(join(dir, "norn-a/ref/tests.md"), "utf8")).toBe("tests\n");
    expect(linkSkills(root, dir, ["norn-a", "norn-b"]).unchanged).toEqual(["norn-a", "norn-b"]);
  });

  test("an agent that reads .agents/skills itself needs no links", () => {
    const root = tmp();
    installSkills(root, bundle(), ["norn-a"]);
    expect(linkSkills(root, join(root, ".agents/skills"), ["norn-a"])).toMatchObject({ linked: [], unchanged: ["norn-a"] });
  });

  test("replaces a copy an older norn installed; keeps a folder norn did not install", () => {
    const root = tmp();
    installSkills(root, bundle(), ["norn-a", "norn-b"]);
    const dir = join(root, ".claude/skills");
    write(join(dir, "norn-a/SKILL.md"), `---\nname: norn-a\n---\n${LEGACY_SKILL_MARKER}\nold\n`);
    write(join(dir, "norn-b/SKILL.md"), "---\nname: norn-b\n---\nmine\n");
    expect(linkSkills(root, dir, ["norn-a", "norn-b"])).toMatchObject({ linked: ["norn-a"], kept: ["norn-b"] });
    expect(readFileSync(join(dir, "norn-b/SKILL.md"), "utf8")).toBe("---\nname: norn-b\n---\nmine\n");
  });
});

describe("skillsReport and visibleSkills", () => {
  test("missing, drifted and unlinked skills", () => {
    const src = bundle();
    const root = tmp();
    const claude = join(root, ".claude/skills");
    const codex = join(root, ".agents/skills");
    expect(skillsReport(root, src, ["norn-a", "norn-b"], { claude, codex })).toEqual({ dir: codex, missing: ["norn-a", "norn-b"], drifted: [], unlinked: { claude: ["norn-a", "norn-b"] } });
    installSkills(root, src, ["norn-a", "norn-b"]);
    linkSkills(root, claude, ["norn-a"]);
    writeFileSync(join(codex, "norn-b/SKILL.md"), "edited\n");
    expect(skillsReport(root, src, ["norn-a", "norn-b"], { claude, codex })).toEqual({ dir: codex, missing: [], drifted: ["norn-b"], unlinked: { claude: ["norn-b"] } });
    expect(visibleSkills(claude)).toEqual(["norn-a"]);
    expect(visibleSkills(join(root, "nope"))).toEqual([]);
  });
});

describe("removeSkills", () => {
  test("removes bundled folders, links to them and older norn copies; keeps the repo's own skills", () => {
    const root = tmp();
    installSkills(root, bundle(), ["norn-a", "norn-b"]);
    const claude = join(root, ".claude/skills");
    linkSkills(root, claude, ["norn-a", "norn-b"]);
    write(join(claude, "implement/SKILL.md"), `---\nname: implement\n---\n${LEGACY_SKILL_MARKER}\nold\n`);
    write(join(claude, "mine/SKILL.md"), "---\nname: mine\n---\nmine\n");
    write(join(root, ".agents/skills/ours/SKILL.md"), "---\nname: ours\n---\nours\n");
    const r = removeSkills(root, ["norn-a", "norn-b"], [claude, join(root, ".agents/skills")]);
    expect(r.removed.length).toBe(5);
    expect(visibleSkills(claude)).toEqual(["mine"]);
    expect(visibleSkills(join(root, ".agents/skills"))).toEqual(["ours"]);
  });
});
