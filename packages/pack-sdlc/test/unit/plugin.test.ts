import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { packProblems, stepRoles } from "@norn/plugin-api";
import { packSdlcPlugin, SDLC_PACK } from "../../src/index.ts";

const ASSETS = join(import.meta.dir, "..", "..", "assets");

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? filesUnder(p) : [p];
  });
}

/** Every file the pack carries, by its path under assets/, as the pack holds it. */
function packFiles(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [f, text] of Object.entries(SDLC_PACK.workflows)) out[`workflows/${f}`] = text;
  for (const [f, text] of Object.entries(SDLC_PACK.shared)) out[`workflows/shared/${f}`] = text;
  for (const [skill, files] of Object.entries(SDLC_PACK.skills)) for (const [f, text] of Object.entries(files)) out[`skills/${skill}/${f}`] = text;
  return out;
}

describe("norn-pack-sdlc", () => {
  test("provides pack sdlc, frozen, as defineNornPlugin checked it", () => {
    expect(packSdlcPlugin.name).toBe("norn-pack-sdlc");
    expect(packSdlcPlugin.provides.packs?.sdlc).toEqual(SDLC_PACK);
    expect(Object.isFrozen(packSdlcPlugin.provides.packs?.sdlc)).toBe(true);
    expect(packProblems(SDLC_PACK)).toEqual([]);
  });

  test("registers the roles a step names with by:, each with its purpose and capabilities, and the supervisor, which does no step", () => {
    expect(Object.fromEntries(Object.entries(SDLC_PACK.roles ?? {}).map(([name, r]) => [name, r.allow]))).toEqual({
      builder: ["code:write", "docs:write", "exec:any"],
      reviewer: ["code:read", "docs:write", "exec:checks", "out:findings"],
      qa: ["code:scratch", "exec:any", "out:criteria", "out:evidence", "out:findings"],
      investigator: ["code:scratch", "exec:any", "out:findings", "tracker:comment", "tracker:label"],
      writer: ["docs:write"],
      supervisor: ["read:any", "answer", "decide:granted", "escalate"],
    });
    expect(stepRoles(SDLC_PACK.roles ?? {})).toEqual(["builder", "reviewer", "qa", "investigator", "writer"]);
  });

  test("carries every file under its assets folder, each with its text, and nothing else", () => {
    const onDisk = Object.fromEntries(filesUnder(ASSETS).map((p) => [relative(ASSETS, p), readFileSync(p, "utf8")]));
    expect(Object.keys(packFiles()).sort()).toEqual(Object.keys(onDisk).sort());
    for (const [path, text] of Object.entries(packFiles())) expect({ path, same: text === onDisk[path] }).toEqual({ path, same: true });
  });

  test("ships the six workflows, the four shared files and every bundled skill with its SKILL.md", () => {
    expect(Object.keys(SDLC_PACK.workflows).sort()).toEqual(["quick.yaml", "refinement.yaml", "reproduce.yaml", "slice.yaml", "story.yaml", "triage.yaml"]);
    expect(Object.keys(SDLC_PACK.shared).sort()).toEqual(["base-update.yaml", "catch-up.yaml", "land.yaml", "publish.yaml"]);
    for (const [skill, files] of Object.entries(SDLC_PACK.skills)) expect({ skill, has: typeof files["SKILL.md"] }).toEqual({ skill, has: "string" });
  });
});
