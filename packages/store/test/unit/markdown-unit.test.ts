import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { StoryFrontmatter } from "@norn/schema";
import {
  appendHandoffHeartbeat,
  ensureEvidenceDir,
  HANDOFF_HEADER_BEGIN,
  parseHandoff,
  patchSliceFile,
  patchStoryFile,
  pinWorkflow,
  readHandoff,
  readLog,
  readPinnedWorkflow,
  readSliceFile,
  readState,
  readStoryFile,
  sha256,
  writeHandoffHeader,
  writeLog,
  writeState,
  writeStoryFile,
} from "../../src/index.ts";
import { AT, state, tmp, WORKFLOW_YAML } from "../helpers.ts";

const STORY: StoryFrontmatter = {
  id: "gh-12",
  slug: "fix-login",
  provider: "gh",
  number: 12,
  url: "https://github.com/o/r/issues/12",
  title: "Fix login",
  assignee: "jakub",
  workflow: "story",
  status: "new",
  intake_at: AT,
};

describe("frontmatter (§7.1)", () => {
  test("round trip; body verbatim", () => {
    const p = join(tmp(), "story.md");
    const body = "\n# Spec\n\nSome *text*\n---\nnot frontmatter\n";
    writeStoryFile(p, STORY, body);
    const r = readStoryFile(p);
    expect(r.ok && r.value).toEqual({ frontmatter: STORY, body });
  });
  test("patch touches only given keys, keeps comments, order, unknown fields and body", () => {
    const p = join(tmp(), "slice.md");
    const text = `---
# planned by the slice skill
id: gh-12/01
title: Add form   # human note
depends_on: []
status: planned
custom: keep me
---
Body line 1

Body ---
`;
    writeFileSync(p, text);
    const r = patchSliceFile(p, { status: "active", workflow: "slice" });
    expect(r.ok).toBe(true);
    const out = readFileSync(p, "utf8");
    expect(out).toContain("# planned by the slice skill");
    expect(out).toContain("title: Add form # human note");
    expect(out).toContain("status: active");
    expect(out).toContain("custom: keep me");
    expect(out.endsWith("---\nBody line 1\n\nBody ---\n")).toBe(true);
    const back = readSliceFile(p);
    expect(back.ok && back.value.frontmatter).toMatchObject({ status: "active", workflow: "slice", custom: "keep me" });
  });
  test("patch refuses fields the CLI does not own and invalid values", () => {
    const p = join(tmp(), "story.md");
    writeStoryFile(p, STORY, "body");
    expect(() => patchStoryFile(p, { slug: "x" } as never)).toThrow(/may not change/);
    const r = patchStoryFile(p, { status: "bogus" as never });
    expect(r.ok).toBe(false);
    expect(readFileSync(p, "utf8")).toContain("status: new");
  });
  test("missing/invalid frontmatter is corrupt", () => {
    const d = tmp();
    writeFileSync(join(d, "a.md"), "no frontmatter");
    writeFileSync(join(d, "b.md"), "---\nid: [\n---\n");
    writeFileSync(join(d, "c.md"), "---\nid: gh-1/01\n---\n");
    for (const f of ["a.md", "b.md", "c.md"]) {
      const r = readSliceFile(join(d, f), d);
      expect(r.ok === false && r.reason).toBe("corrupt");
    }
    expect(readSliceFile(join(d, "none.md"))).toEqual({ ok: false, reason: "missing" });
  });
});

describe("unit files", () => {
  test("state write/read validated", () => {
    const u = tmp();
    writeState(u, state());
    expect(readState(u)).toMatchObject({ ok: true, value: { step: "implement" } });
    expect(() => writeState(u, { ...state(), attempt: 0 })).toThrow();
  });
  test("pinned workflow: exclusive, idempotent, replace", () => {
    const u = tmp();
    expect(pinWorkflow(u, WORKFLOW_YAML)).toEqual({ ok: true, hash: sha256(WORKFLOW_YAML) });
    expect(pinWorkflow(u, WORKFLOW_YAML).ok).toBe(true);
    const changed = WORKFLOW_YAML.replace("max: 3", "max: 4");
    expect(pinWorkflow(u, changed)).toMatchObject({ ok: false, reason: "pinned" });
    expect(pinWorkflow(u, changed, { replace: true }).ok).toBe(true);
    const r = readPinnedWorkflow(u);
    expect(r.ok && r.value.hash).toBe(sha256(changed));
    expect(r.ok && r.value.workflow.counters?.test_loop?.max).toBe(4);
    expect(() => pinWorkflow(tmp(), "name: x\n")).toThrow(/invalid workflow/);
  });
  test("logs and evidence", () => {
    const u = tmp();
    expect(writeLog(u, "01JBQ6ZK3E8Y4V5W6X7Y8Z9ABC", "out")).toBe("logs/01JBQ6ZK3E8Y4V5W6X7Y8Z9ABC.log");
    expect(readLog(u, "01JBQ6ZK3E8Y4V5W6X7Y8Z9ABC")).toBe("out");
    const src = tmp();
    mkdirSync(join(src, "shots"));
    writeFileSync(join(src, "shots/a.png"), "x");
    expect(ensureEvidenceDir(u, "R1", src)).toBe("evidence/R1");
    expect(existsSync(join(u, "evidence/R1/shots/a.png"))).toBe(true);
    // a second copy merges over what is there
    const more = tmp();
    writeFileSync(join(more, "b.txt"), "y");
    ensureEvidenceDir(u, "R1", more);
    expect(readdirSync(join(u, "evidence/R1")).sort()).toEqual(["b.txt", "shots"]);
    expect(ensureEvidenceDir(u, "R2")).toBe("evidence/R2");
    expect(existsSync(join(u, "evidence/R2"))).toBe(true);
  });
  test("evidence copy is temp + rename (S1): a failed copy leaves no partial dir and no temp", () => {
    if (process.getuid?.() === 0) return; // root reads mode-000 files
    const u = tmp();
    const src = tmp();
    writeFileSync(join(src, "a.txt"), "x");
    writeFileSync(join(src, "z-unreadable.txt"), "secret");
    chmodSync(join(src, "z-unreadable.txt"), 0o000);
    try {
      expect(() => ensureEvidenceDir(u, "R1", src)).toThrow();
    } finally {
      chmodSync(join(src, "z-unreadable.txt"), 0o644);
    }
    expect(existsSync(join(u, "evidence/R1"))).toBe(false);
    expect(readdirSync(join(u, "evidence"))).toEqual([]);
    // an existing evidence dir is left as it was
    const ok = tmp();
    writeFileSync(join(ok, "keep.txt"), "k");
    ensureEvidenceDir(u, "R1", ok);
    chmodSync(join(src, "z-unreadable.txt"), 0o000);
    try {
      expect(() => ensureEvidenceDir(u, "R1", src)).toThrow();
    } finally {
      chmodSync(join(src, "z-unreadable.txt"), 0o644);
    }
    expect(readdirSync(join(u, "evidence/R1"))).toEqual(["keep.txt"]);
    expect(readdirSync(join(u, "evidence"))).toEqual(["R1"]);
  });
  test("handoff: header replaced, agent sections preserved, heartbeat collapses", () => {
    const u = tmp();
    writeHandoffHeader(u, "story gh-12 · step implement · attempt 1");
    let h = readHandoff(u);
    expect(h?.body).toContain("## Goal");
    // agent edits its sections
    const raw = readFileSync(join(u, "handoff.md"), "utf8").replace("## Progress\n", "## Progress\n- wrote the form\n");
    writeFileSync(join(u, "handoff.md"), raw);
    appendHandoffHeartbeat(u, "nudged (silent)");
    appendHandoffHeartbeat(u, "nudged (silent)");
    appendHandoffHeartbeat(u, "nudged (silent)");
    appendHandoffHeartbeat(u, "resumed");
    writeHandoffHeader(u, "story gh-12 · step test · attempt 1\n");
    h = readHandoff(u);
    expect(h?.header).toBe("story gh-12 · step test · attempt 1");
    expect(h?.heartbeat).toEqual(["nudged (silent) (×3)", "resumed"]);
    expect(h?.body).toContain("- wrote the form");
    expect(readFileSync(join(u, "handoff.md"), "utf8").startsWith(HANDOFF_HEADER_BEGIN)).toBe(true);
  });
  test("handoff without norn blocks is all body", () => {
    expect(parseHandoff("# mine\n")).toMatchObject({ header: "", heartbeat: [], body: "# mine\n" });
  });
});
