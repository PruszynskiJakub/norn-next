/** `appendProgress` adds the line to the handoff's one Progress section at whatever heading level the agent wrote. */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendProgress } from "../../src/runtime/report.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function handoff(text: string): string {
  const dir = mkdtempSync(join(tmpdir(), "norn-report-"));
  dirs.push(dir);
  const file = join(dir, "_story.md");
  writeFileSync(file, text);
  return file;
}

describe("appendProgress", () => {
  for (const level of [1, 2, 3, 4]) {
    const h = "#".repeat(level);
    test(`level ${level} headings: the line lands after the last milestone of the one Progress section`, () => {
      const file = handoff(`${h} Goal\n\nShip it.\n\n${h} Progress\n\n- wrote the form\n\n${h} Resume\n\nRun the tests.\n`);
      appendProgress(file, "implement#1 done: x");
      expect(readFileSync(file, "utf8")).toBe(
        `${h} Goal\n\nShip it.\n\n${h} Progress\n\n- wrote the form\n- implement#1 done: x\n\n${h} Resume\n\nRun the tests.\n`,
      );
    });
  }

  test("a deeper heading inside Progress stays in the section; the line goes after its content", () => {
    const file = handoff("### Goal\n\nG\n\n### Progress\n\n#### Findings\n\n- a\n\n### Resume\n\nR\n");
    appendProgress(file, "s#1 done: x");
    expect(readFileSync(file, "utf8")).toBe("### Goal\n\nG\n\n### Progress\n\n#### Findings\n\n- a\n- s#1 done: x\n\n### Resume\n\nR\n");
  });

  test("an empty Progress section gets the line after one blank line", () => {
    const file = handoff("### Goal\n\nG\n\n### Progress\n\n### Resume\n\nR\n");
    appendProgress(file, "s#1 done: x");
    expect(readFileSync(file, "utf8")).toBe("### Goal\n\nG\n\n### Progress\n\n- s#1 done: x\n\n### Resume\n\nR\n");
  });

  test("Progress as the last section: the line is appended at its end", () => {
    const file = handoff("### Goal\n\nG\n\n### Progress\n\n- a\n");
    appendProgress(file, "s#1 done: x");
    expect(readFileSync(file, "utf8")).toBe("### Goal\n\nG\n\n### Progress\n\n- a\n- s#1 done: x\n");
  });

  test("a handoff without a Progress section gets one at the end", () => {
    const file = handoff("## Goal\n\nG\n");
    appendProgress(file, "s#1 done: x");
    expect(readFileSync(file, "utf8")).toBe("## Goal\n\nG\n\n## Progress\n\n- s#1 done: x\n");
  });
});
