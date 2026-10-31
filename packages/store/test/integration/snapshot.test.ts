import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  appendReceipt,
  loadSnapshot,
  pinWorkflow,
  storyDir,
  storyFile,
  storyUnitDir,
  unitDir,
  writeHandoffHeader,
  writeSliceFile,
  writeState,
  writeStoryFile,
  writeUnitMarker,
} from "../../src/index.ts";
import { AT, receipt, state, tmp, WORKFLOW_YAML } from "../helpers.ts";

function seed(root: string, title = "Fix login") {
  const spec = storyDir(root, "gh-12", "fix-login");
  writeStoryFile(storyFile(spec), {
    id: "gh-12", slug: "fix-login", provider: "gh", number: 12, url: "u", title, assignee: null, workflow: "story", status: "active", intake_at: AT,
  }, "\nspec\n");
  writeSliceFile(join(spec, "slices/01-add-form.md"), { id: "gh-12/01", title: "Add form", depends_on: [], status: "active" }, "");
  writeSliceFile(join(spec, "slices/02-wire-api.md"), { id: "gh-12/02", title: "Wire", depends_on: ["gh-12/01"], status: "planned" }, "");
  const u1 = unitDir(spec, "01-add-form");
  pinWorkflow(u1, WORKFLOW_YAML);
  appendReceipt(u1, receipt());
  appendReceipt(u1, receipt());
  writeState(u1, state({ applied_through: 1 }));
  writeHandoffHeader(u1, "header");
  return spec;
}

describe("loadSnapshot", () => {
  test("reads stories, slices, units, unapplied receipts, pinned workflows, handoff", () => {
    const repo = tmp();
    const home = tmp();
    const spec = seed(repo);
    // a corrupt story unit state
    mkdirSync(storyUnitDir(spec), { recursive: true });
    writeFileSync(join(storyUnitDir(spec), "state.json"), "{}");
    // a folder that is not a spec
    mkdirSync(join(repo, ".agents/specs/notes"), { recursive: true });

    const s = loadSnapshot({ repoRoot: repo, home, includeApplied: true });
    expect(s.config.ok).toBe(true);
    expect(s.stories.map((x) => x.key)).toEqual(["gh-12"]);
    const st = s.stories[0];
    if (!st) throw new Error("unreachable");
    expect(st.spec_dir).toBe(".agents/specs/gh-12-fix-login");
    expect(st.frontmatter?.title).toBe("Fix login");
    expect(st.slices.map((x) => [x.key, x.frontmatter?.status])).toEqual([["gh-12/01", "active"], ["gh-12/02", "planned"]]);
    expect(st.units.map((u) => u.unit.key)).toEqual(["gh-12", "gh-12/01", "gh-12/02"]);
    const [story, u1, u2] = st.units;
    expect(story?.state).toBeNull();
    expect(story?.errors.map((e) => e.file)).toEqual([".agents/specs/gh-12-fix-login/runs/_story/state.json"]);
    expect(u1?.state?.applied_through).toBe(1);
    expect(u1?.unapplied.map((r) => r.n)).toEqual([2]);
    expect(u1?.receipts?.length).toBe(2);
    expect(u1?.workflow?.workflow.name).toBe("slice");
    expect(u1?.handoff?.header).toBe("header");
    expect(u1?.errors).toEqual([]);
    expect(u2).toMatchObject({ state: null, workflow: null, unapplied: [], errors: [] });
  });
  test("story worktree roots win over the main checkout; pinned hash mismatch is an error", () => {
    const repo = tmp();
    const wt = tmp();
    seed(repo, "Old title");
    const spec = seed(wt, "Worktree title");
    writeUnitMarker(wt, { repo, story: "gh-12", slice: null, unit: "_story", spec_dir: ".agents/specs/gh-12-fix-login" });
    writeFileSync(join(unitDir(spec, "01-add-form"), "workflow.yaml"), `${WORKFLOW_YAML}# edited\n`);
    const s = loadSnapshot({ repoRoot: repo, storyRoots: [wt], home: tmp() });
    expect(s.stories[0]?.frontmatter?.title).toBe("Worktree title");
    expect(s.stories[0]?.root).toBe(wt);
    expect(s.stories[0]?.units[1]?.errors[0]?.errors[0]?.message).toMatch(/hash/);
  });
});

describe("storyFile (GR2: spec.md, story.md still read)", () => {
  test("a story whose folder holds only story.md loads as before", () => {
    const repo = tmp();
    const spec = storyDir(repo, "gh-12", "fix-login");
    mkdirSync(spec, { recursive: true });
    writeStoryFile(join(spec, "story.md"), { id: "gh-12", slug: "fix-login", provider: "gh", number: 12, url: "u", title: "Old", assignee: null, workflow: "story", status: "active", intake_at: AT }, "");
    const story = loadSnapshot({ repoRoot: repo, home: tmp() }).stories.find((s) => s.key === "gh-12");
    expect(story?.frontmatter_error).toBeNull();
    expect(story?.frontmatter?.title).toBe("Old");
  });

  test("a folder with neither file reports spec.md missing", () => {
    const repo = tmp();
    mkdirSync(storyDir(repo, "gh-12", "fix-login"), { recursive: true });
    const story = loadSnapshot({ repoRoot: repo, home: tmp() }).stories.find((s) => s.key === "gh-12");
    expect(story?.frontmatter_error).toEqual({ file: ".agents/specs/gh-12-fix-login/spec.md", errors: [{ path: "", message: "spec.md missing" }] });
  });
});
