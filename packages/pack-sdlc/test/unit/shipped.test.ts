/**
 * The pack is the old engine's shipped workflows and skills, copied, with only the routes the kernel's
 * loader needs added. While the old engine's assets exist beside the pack, this holds the copy to them
 * so an edit to one is made to both; the cutover removes them and this check with them.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parse } from "yaml";
import { SDLC_PACK } from "../../src/index.ts";

const OLD = join(import.meta.dir, "..", "..", "..", "cli", "assets");

/**
 * The routes the old engine took with no edge, each written where it took it: the light path's
 * `clean` and `resolved` as `done`, the merge ending the round, and a story waiting at ready or merge
 * with commits its PR lacks going back to open-pr.
 */
const ROUTE_EDITS: ReadonlyArray<{ file: string; step: string; routes: Record<string, unknown> }> = [
  { file: "shared/sync.yaml", step: "sync", routes: { clean: { exit: "synced" }, resolved: { exit: "synced" } } },
  { file: "refinement.yaml", step: "sync", routes: { clean: "refine", resolved: "refine" } },
  { file: "shared/ship.yaml", step: "ready", routes: { unpushed: "open-pr" } },
  { file: "shared/ship.yaml", step: "merge", routes: { merged: "$done", unpushed: "open-pr" } },
];

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? filesUnder(p) : [p];
  });
}

const oldText = (path: string) => readFileSync(join(OLD, path), "utf8");

function edited(file: string): unknown {
  const doc = parse(oldText(`workflows/${file}`)) as { steps: Record<string, { outcomes: Record<string, unknown> }> };
  for (const e of ROUTE_EDITS.filter((x) => x.file === file)) {
    const step = doc.steps[e.step];
    if (!step) throw new Error(`${file} has no step ${e.step}`);
    step.outcomes = { ...step.outcomes, ...e.routes };
  }
  return doc;
}

describe.skipIf(!existsSync(OLD))("the pack against the old engine's shipped assets", () => {
  test("every workflow and shared file is the shipped one with only the route edits", () => {
    const shipped = filesUnder(join(OLD, "workflows")).map((p) => relative(join(OLD, "workflows"), p));
    const packed = [...Object.keys(SDLC_PACK.workflows), ...Object.keys(SDLC_PACK.shared).map((f) => `shared/${f}`)];
    expect(packed.sort()).toEqual(shipped.sort());
    for (const file of shipped) {
      const text = file.startsWith("shared/") ? SDLC_PACK.shared[file.slice("shared/".length)] : SDLC_PACK.workflows[file];
      expect({ file, doc: parse(text as string) }).toEqual({ file, doc: edited(file) });
    }
  });

  test("the files no edit touches are copied byte for byte", () => {
    const touched = new Set(ROUTE_EDITS.map((e) => e.file));
    for (const [file, text] of Object.entries(SDLC_PACK.workflows)) if (!touched.has(file)) expect({ file, same: text === oldText(`workflows/${file}`) }).toEqual({ file, same: true });
    for (const [file, text] of Object.entries(SDLC_PACK.shared))
      if (!touched.has(`shared/${file}`)) expect({ file, same: text === oldText(`workflows/shared/${file}`) }).toEqual({ file, same: true });
  });

  test("every bundled skill is the shipped one, file for file", () => {
    const shipped = filesUnder(join(OLD, "skills")).map((p) => relative(join(OLD, "skills"), p));
    const packed = Object.entries(SDLC_PACK.skills).flatMap(([skill, files]) => Object.keys(files).map((f) => `${skill}/${f}`));
    expect(packed.sort()).toEqual(shipped.sort());
    for (const [skill, files] of Object.entries(SDLC_PACK.skills))
      for (const [f, text] of Object.entries(files)) expect({ path: `${skill}/${f}`, same: text === oldText(`skills/${skill}/${f}`) }).toEqual({ path: `${skill}/${f}`, same: true });
  });
});
