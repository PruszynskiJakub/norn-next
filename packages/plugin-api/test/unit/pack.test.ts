import { describe, expect, test } from "bun:test";
import { defineNornPlugin, isPackPath, type Pack, packProblems } from "../../src/index.ts";

function pack(over: Partial<Pack> = {}): Pack {
  return {
    workflows: { "story.yaml": "name: story\n" },
    shared: { "ship.yaml": "steps: {}\n" },
    skills: { "norn-pr": { "SKILL.md": "---\nname: norn-pr\n---\n", "scripts/run.sh": "#!/bin/sh\n" } },
    ...over,
  };
}

describe("pack contract", () => {
  test("a pack of workflows, shared files and skills has no problems", () => {
    expect(packProblems(pack())).toEqual([]);
    expect(packProblems(pack({ workflows: {}, shared: {}, skills: {} }))).toEqual([]);
  });

  test("a path that is absolute, climbs out or names a folder is not a pack path", () => {
    expect(isPackPath("scripts/run.sh")).toBe(true);
    for (const bad of ["", "/etc/passwd", "../x", "a/../b", "a//b", "./a", "dir/", "a\\b", 7]) expect(isPackPath(bad)).toBe(false);
  });

  test("names every problem: a non-yaml workflow, a bad path, non-text, a bad skill name and a skill without SKILL.md", () => {
    const bad = {
      workflows: { "story.txt": "x", "../escape.yaml": "x" },
      shared: { "ship.yaml": 3 },
      skills: { "Bad Name": { "SKILL.md": "" }, empty: { "notes.md": "" } },
    };
    expect(packProblems(bad)).toEqual([
      "workflows file story.txt is not a .yaml file",
      'workflows path "../escape.yaml" is not a relative file path',
      "shared file ship.yaml is not text",
      'skill name "Bad Name" must match ^[a-z][a-z0-9-]*$',
      "skill empty has no SKILL.md",
    ]);
    expect(packProblems({ workflows: [], shared: {}, skills: null })).toEqual(["workflows must be an object of file texts", "skills must be an object"]);
    expect(packProblems(null)).toEqual(["is not an object"]);
  });
});

describe("defineNornPlugin: packs", () => {
  test("keeps a pack frozen to its leaves, and a later change to the spec does not reach it", () => {
    const given = pack();
    const plugin = defineNornPlugin({ name: "norn-pack-x", api: "^1.4", provides: { packs: { x: given } } });
    const kept = plugin.provides.packs?.x as Pack;
    expect(kept).toEqual(pack());
    expect(Object.isFrozen(plugin.provides.packs)).toBe(true);
    expect(Object.isFrozen(kept.workflows)).toBe(true);
    expect(Object.isFrozen(kept.skills["norn-pr"])).toBe(true);
    given.workflows["quick.yaml"] = "name: quick\n";
    (given.skills["norn-pr"] as Record<string, string>)["SKILL.md"] = "changed";
    expect(Object.keys(kept.workflows)).toEqual(["story.yaml"]);
    expect(kept.skills["norn-pr"]?.["SKILL.md"]).toBe("---\nname: norn-pr\n---\n");
  });

  test("refuses a pack with a problem when the plugin is defined, naming the pack", () => {
    expect(() => defineNornPlugin({ name: "p", api: "^1", provides: { packs: { sdlc: pack({ skills: { s: {} } }) } } })).toThrow(
      "norn plugin p: pack sdlc skill s has no SKILL.md",
    );
  });
});
