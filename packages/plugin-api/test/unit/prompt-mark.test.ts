import { describe, expect, test } from "bun:test";
import { markPrompt, promptMarkLine, readPromptMark } from "../../src/index.ts";

describe("prompt marks", () => {
  test("a marked prompt reads back its source and id", () => {
    const text = markPrompt("carry on with the step", { source: "nudge", id: "01JNUDGE.1" });
    expect(text).toBe("carry on with the step\n\n<!-- norn-prompt source=nudge id=01JNUDGE.1 -->");
    expect(readPromptMark(text)).toEqual({ source: "nudge", id: "01JNUDGE.1" });
  });

  test("survives trailing whitespace and a trailing newline in the text it marks", () => {
    expect(readPromptMark(`${markPrompt("brief\n", { source: "brief", id: "r1" })}\n  \n`)).toEqual({ source: "brief", id: "r1" });
  });

  test("only the last non-blank line counts: a mark quoted mid-prompt is a person's text", () => {
    const quoted = `see this:\n${promptMarkLine({ source: "answer", id: "a1" })}\nwhat was that?`;
    expect(readPromptMark(quoted)).toBeNull();
    expect(readPromptMark("just a prompt")).toBeNull();
    expect(readPromptMark("")).toBeNull();
  });

  test("a mark naming a source norn does not send, or a bad id, is no mark", () => {
    expect(readPromptMark("<!-- norn-prompt source=person id=x -->")).toBeNull();
    expect(readPromptMark("<!-- norn-prompt source=nudge id=a b -->")).toBeNull();
  });

  test("minting refuses an id outside the charset or a source norn does not send", () => {
    expect(() => promptMarkLine({ source: "nudge", id: "has space" })).toThrow(RangeError);
    expect(() => promptMarkLine({ source: "person" as "nudge", id: "x" })).toThrow(RangeError);
  });
});
