import { describe, expect, test } from "bun:test";
import { versionMatch } from "../../src/index.ts";

// gh-61 B2 (D3): a running binary matches the repo's norn version when it is the same minor
// (before 1.0; the same major from 1.0 on) and at least that patch.
describe("versionMatch (gh-61 B2)", () => {
  const table: Array<[repo: string, running: string, expected: "match" | "older" | "newer"]> = [
    ["0.18.0", "0.18.0", "match"],
    ["0.18.0", "0.18.3", "match"],
    ["0.18.0", "0.17.9", "older"],
    ["0.18.0", "0.19.0", "newer"],
    ["0.18.2", "0.18.1", "older"],
    ["1.2.0", "1.5.1", "match"],
    ["1.2.0", "2.0.0", "newer"],
    ["1.2.0", "1.1.9", "older"],
    ["1.2.0", "0.19.0", "older"],
  ];
  for (const [repo, running, expected] of table)
    test(`repo ${repo}, binary ${running} → ${expected}`, () => {
      expect(versionMatch(repo, running)).toBe(expected);
    });
});
