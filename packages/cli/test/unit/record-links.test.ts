/** `open-pr`'s rewrite of `pr.md`'s record links to the record commit's URLs. */
import { describe, expect, test } from "bun:test";
import { rewriteRecordLinks } from "../../src/runtime/act/record-links.ts";

const record: Record<string, string> = {
  "evidence/01-parser/01ABC/shot.png": "01-parser/evidence/01ABC/shot.png",
  "evidence/_story/01DEF/after.png": "_story/rounds/02-story/evidence/01DEF/after.png",
};
const url = async (path: string) => `https://github.com/o/r/blob/SHA/${path}?raw=true`;

describe("rewriteRecordLinks (B28)", () => {
  test("a slice's and the story's record links become the files' URLs; a link the record lacks stays and is named once", async () => {
    const text = [
      "![parser](evidence/01-parser/01ABC/shot.png)",
      '<img src="evidence/_story/01DEF/after.png" width="400">',
      "[again](evidence/01-parser/01ABC/shot.png) and ![gone](evidence/02-x/01GHI/gone.png) ![gone](evidence/02-x/01GHI/gone.png)",
      "evidence/01-parser/01ABC/shot.png in prose stays",
    ].join("\n");
    const out = await rewriteRecordLinks(text, (l) => record[l] ?? null, url);
    expect(out.text).toBe(
      [
        "![parser](https://github.com/o/r/blob/SHA/01-parser/evidence/01ABC/shot.png?raw=true)",
        '<img src="https://github.com/o/r/blob/SHA/_story/rounds/02-story/evidence/01DEF/after.png?raw=true" width="400">',
        "[again](https://github.com/o/r/blob/SHA/01-parser/evidence/01ABC/shot.png?raw=true) and ![gone](evidence/02-x/01GHI/gone.png) ![gone](evidence/02-x/01GHI/gone.png)",
        "evidence/01-parser/01ABC/shot.png in prose stays",
      ].join("\n"),
    );
    expect(out.missing).toEqual(["evidence/02-x/01GHI/gone.png"]);
    expect(out.rewritten).toEqual(["evidence/01-parser/01ABC/shot.png", "evidence/_story/01DEF/after.png"]);
  });
});
