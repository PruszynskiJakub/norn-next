import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  appendReceipt,
  currentRound,
  loadSnapshot,
  pinWorkflow,
  storyDir,
  startDir,
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
  test("R3.4 (N1): a story worktree supplies only its own story; others come from the base copy", () => {
    const repo = tmp();
    const own = tmp(); // gh-12's own worktree: its record says active
    const other = tmp(); // gh-15's worktree, cut from a base that already records gh-12 as done
    seed(own, "Own copy");
    writeUnitMarker(own, { repo, story: "gh-12", slice: null, unit: "_story", spec_dir: ".agents/specs/gh-12-fix-login" });
    writeStoryFile(storyFile(storyDir(other, "gh-12", "fix-login")), { id: "gh-12", slug: "fix-login", provider: "gh", number: 12, url: "u", title: "Shadow copy", assignee: null, workflow: "story", status: "done", intake_at: AT }, "");
    writeStoryFile(storyFile(storyDir(other, "gh-15", "other")), { id: "gh-15", slug: "other", provider: "gh", number: 15, url: "u", title: "Other", assignee: null, workflow: "story", status: "active", intake_at: AT }, "");
    writeUnitMarker(other, { repo, story: "gh-15", slice: null, unit: "_story", spec_dir: ".agents/specs/gh-15-other" });
    // the shadowing worktree sorts first: before R3.4 it supplied gh-12's record
    const s = loadSnapshot({ repoRoot: repo, storyRoots: [other, own], home: tmp(), baseRef: null });
    expect(s.stories.map((x) => [x.key, x.root, x.frontmatter?.title])).toEqual([
      ["gh-12", own, "Own copy"],
      ["gh-15", other, "Other"],
    ]);
    // without its own worktree, gh-12 is not read from gh-15's worktree at all
    const t = loadSnapshot({ repoRoot: repo, storyRoots: [other], home: tmp(), baseRef: null });
    expect(t.stories.map((x) => x.key)).toEqual(["gh-15"]);
    // a root without a story marker supplies nothing
    expect(loadSnapshot({ repoRoot: repo, storyRoots: [tmp()], home: tmp(), baseRef: null }).stories).toEqual([]);
  });
});

describe("storyFile (GR2: spec.md, story.md still read)", () => {
  test("a new folder gets spec.md; spec.md wins over story.md; a folder holding only story.md keeps it", () => {
    const spec = storyDir(tmp(), "gh-12", "fix-login");
    expect(storyFile(spec)).toBe(join(spec, "spec.md"));
    mkdirSync(spec, { recursive: true });
    writeFileSync(join(spec, "story.md"), "");
    expect(storyFile(spec)).toBe(join(spec, "story.md"));
    writeFileSync(join(spec, "spec.md"), "");
    expect(storyFile(spec)).toBe(join(spec, "spec.md"));
  });
});

describe("the story's current round (gh-71 D2, S5)", () => {
  test("a round folder without state.json (a round.start that stopped after the pin) is not the current round", () => {
    const spec = storyDir(tmp(), "gh-12", "fix-login");
    const r1 = join(spec, "runs/_story/rounds/01-triage");
    pinWorkflow(r1, WORKFLOW_YAML);
    writeState(r1, state());
    expect(currentRound(spec)).toEqual({ n: 1, workflow: "triage" });
    const r2 = join(spec, "runs/_story/rounds/02-story");
    pinWorkflow(r2, WORKFLOW_YAML);
    expect(currentRound(spec)).toEqual({ n: 1, workflow: "triage" });
    expect(storyUnitDir(spec)).toBe(r1);
    expect(startDir(spec, "_story", "story")).toBe(r1);
    writeState(r2, state());
    expect(currentRound(spec)).toEqual({ n: 2, workflow: "story" });
    expect(storyUnitDir(spec)).toBe(r2);
  });
  test("a story whose round 1 was pinned but never got its state starts in round 1 again", () => {
    const spec = storyDir(tmp(), "gh-12", "fix-login");
    pinWorkflow(join(spec, "runs/_story/rounds/01-triage"), WORKFLOW_YAML);
    expect(currentRound(spec)).toBeNull();
    expect(startDir(spec, "_story", "triage")).toBe(join(spec, "runs/_story/rounds/01-triage"));
  });
});
