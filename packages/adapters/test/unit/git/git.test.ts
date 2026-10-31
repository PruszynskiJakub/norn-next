/** git adapter parsers and pure helpers (X4); the real-repo tests are in test/integration/git/. */
import { describe, expect, test } from "bun:test";
import { addedConflictMarkers, classifyPush, gitVersionOk, parseGitVersion, parseStatusV2, parseWorktreeList } from "../../../src/git/index.ts";

describe("git adapter: base sync (BS1, BS3)", () => {
  test("H1: addedConflictMarkers needs both an opening and a closing marker in one file", () => {
    const diff = (file: string, ...added: string[]) => [`diff --git a/${file} b/${file}`, `--- a/${file}`, `+++ b/${file}`, "@@ -0,0 +1 @@", ...added.map((l) => `+${l}`)].join("\n");
    expect(addedConflictMarkers([diff("x.ts", "<<<<<<< HEAD", "a", "=======", "b", ">>>>>>> main"), diff("y.md", "<<<<<<< only an opening")].join("\n"))).toEqual(["x.ts"]);
    expect(addedConflictMarkers(diff("z.md", "Heading", "=======", ">>>>>>>no space"))).toEqual([]);
  });

  test("git version gate (BS2)", () => {
    expect(parseGitVersion("git version 2.50.1 (Apple Git-155)")).toEqual([2, 50, 1]);
    expect(gitVersionOk("git version 2.38.0")).toBe(true);
    expect(gitVersionOk("git version 2.37.9")).toBe(false);
    expect(gitVersionOk("git version 3.0")).toBe(true);
    expect(gitVersionOk("nope")).toBe(false);
  });
});

describe("git adapter: parsers", () => {
  test("status v2 rename and unmerged entries", () => {
    const out = ["# branch.oid (initial)", "# branch.head (detached)", "2 R. N... 100644 100644 100644 a b R100 new.txt", "old.txt", "u UU N... 1 1 1 1 a b c both.txt", ""].join("\0");
    const st = parseStatusV2(out, "/r", true);
    expect(st).toMatchObject({ head: null, branch: null, staged: ["new.txt"], unstaged: ["both.txt"], clean: false, rebase_in_progress: true });
  });
  test("worktree list skips bare, flags locked/prunable", () => {
    const out = ["worktree /b", "bare", "", "worktree /w", "HEAD " + "0".repeat(40), "detached", "locked why", "prunable gone", "", ""].join("\0");
    expect(parseWorktreeList(out)).toEqual([{ path: "/w", branch: null, head: null, locked: true, prunable: true }]);
  });
  test("push classification", () => {
    expect(classifyPush({ code: 128, stdout: "", stderr: "fatal: unable to access 'https://x': Could not resolve host: x" }).ok).toBe(false);
    expect(classifyPush({ code: 128, stdout: "", stderr: "fatal: Authentication failed for 'https://x'" })).toMatchObject({ reason: "auth" });
    expect(classifyPush({ code: 128, stdout: "", stderr: "fatal: Could not resolve host: x" })).toMatchObject({ reason: "network" });
  });
});
