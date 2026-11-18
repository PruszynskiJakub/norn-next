/**
 * The live canary's recorder against the hook command each harness really generates, so the canary
 * cannot drift into reading the wrong argument while it stays skipped. No agent starts: each harness
 * is installed in a temp folder and its command read back, as the shell would split it.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeHarness, settingsLocalPath } from "@norn/harness-claude";
import { extensionPath, piHarness } from "@norn/harness-pi";
import { recordedCall, recorderCommand } from "./recorder.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const tempWorktree = () => {
  const d = mkdtempSync(join(tmpdir(), "norn-recorder-"));
  dirs.push(d);
  return d;
};

/** `sh -c` word splitting for the commands harnesses write: double quotes, spaces, a trailing comment. */
function shellWords(command: string): string[] {
  const words: string[] = [];
  let word: string | null = null;
  let quoted = false;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i] as string;
    if (quoted) {
      if (ch === "\\" && i + 1 < command.length) word = (word ?? "") + command[++i];
      else if (ch === '"') quoted = false;
      else word = (word ?? "") + ch;
    } else if (ch === '"') {
      quoted = true;
      word = word ?? "";
    } else if (ch === " ") {
      if (word !== null) words.push(word);
      word = null;
    } else if (ch === "#" && word === null) break;
    else word = (word ?? "") + ch;
  }
  if (word !== null) words.push(word);
  return words;
}

describe("live canary recorder", () => {
  test("claude: the command it writes for a hook names the harness and the hook", async () => {
    const wt = tempWorktree();
    await claudeHarness.install({ worktree: wt, hookCommand: recorderCommand("claude") });
    const settings = JSON.parse(readFileSync(settingsLocalPath(wt), "utf8")) as { hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>> };
    const command = settings.hooks.Stop?.[0]?.hooks[0]?.command ?? "";
    expect(recordedCall(shellWords(command))).toEqual({ harness: "claude", hook: "Stop" });
  });
  test("pi: the command its extension runs for an event names the harness and the event", async () => {
    const wt = tempWorktree();
    await piHarness.install({ worktree: wt, hookCommand: recorderCommand("pi") });
    const ext = (await import(extensionPath(wt))) as { commandFor: (name: string) => string };
    expect(recordedCall(shellWords(ext.commandFor("agent_before_settle")))).toEqual({ harness: "pi", hook: "agent_before_settle" });
  });
});
