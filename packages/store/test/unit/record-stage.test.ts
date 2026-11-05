/** gh-195/11 (B25; review#1 S6): a record staged empty beside its place, for a takeover with the record lost. */
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stageEmptyRecord } from "../../src/record-ref.ts";

let dir = "";
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("stageEmptyRecord", () => {
  test("a staging folder a killed checkout left is swept, never reused; place() replaces the old record whole", () => {
    dir = mkdtempSync(join(tmpdir(), "norn-stage-"));
    const dest = join(dir, "gh-9");
    mkdirSync(join(dest, "_story"), { recursive: true });
    writeFileSync(join(dest, "_story", "old.json"), "{}");
    const leftover = join(dir, ".gh-9.unpack-99999");
    mkdirSync(leftover);
    writeFileSync(join(leftover, "stale.json"), "{}");

    const staged = stageEmptyRecord(dest);
    expect(existsSync(leftover)).toBe(false);
    expect(readdirSync(staged.dir)).toEqual([]);
    writeFileSync(join(staged.dir, "new.json"), '{"n":1}');
    staged.place();
    staged.discard();
    expect(readdirSync(dest)).toEqual(["new.json"]);
    expect(readFileSync(join(dest, "new.json"), "utf8")).toBe('{"n":1}');
    expect(readdirSync(dir).sort()).toEqual(["gh-9"]);
  });

  test("staging again before the first was placed starts empty: the first is swept", () => {
    dir = mkdtempSync(join(tmpdir(), "norn-stage-"));
    const dest = join(dir, "gh-9");
    const first = stageEmptyRecord(dest);
    writeFileSync(join(first.dir, "a.json"), "{}");
    const second = stageEmptyRecord(dest);
    expect(readdirSync(second.dir)).toEqual([]);
    second.discard();
  });
});
