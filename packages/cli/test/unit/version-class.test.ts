/**
 * gh-61 D1, B6–B10: every command declares how a binary that does not match the repo's `norn_version`
 * treats it — `acts` (refused), `reads` (runs) or `exempt` (never checked). This table pins each one;
 * `Command.version` is required by the type, so a new command cannot leave it out.
 */
import { describe, expect, test } from "bun:test";
import type { Command, VersionClass } from "../../src/command.ts";
import { COMMANDS, NOUNS } from "../../src/commands/index.ts";

const D1: Record<string, VersionClass> = {
  tick: "acts",
  watch: "acts",
  sync: "acts",
  brief: "acts",
  tidy: "acts",
  "config set": "acts",
  "config unset": "acts",
  "story start": "acts",
  "story approve": "acts",
  "story reject": "acts",
  "story answer": "acts",
  "story edit": "acts",
  "story take": "acts",
  "story create": "acts",
  "story close": "acts",
  "story reopen": "acts",
  "story reset": "acts",
  "story checkout": "acts",
  "story update-branch": "acts",
  "story chat": "acts",
  "story handoff": "acts",
  "run rerun": "acts",
  "run cancel": "acts",
  "run attach": "acts",
  help: "reads",
  doctor: "reads",
  status: "reads",
  "story list": "reads",
  "story view": "reads",
  "story wait": "reads",
  "run list": "reads",
  "run view": "reads",
  "config list": "reads",
  "config get": "reads",
  init: "exempt",
  upgrade: "exempt",
  migrate: "exempt",
  uninstall: "exempt",
  done: "exempt",
  ask: "exempt",
  stuck: "exempt",
  hook: "exempt",
  "check-run": "exempt",
};

const all: Command[] = [...COMMANDS, ...NOUNS.flatMap((n) => n.verbs)];

describe("version classes (gh-61 D1)", () => {
  test("every command declares the class D1 gives it, and D1 names every command", () => {
    expect(Object.fromEntries(all.map((c) => [c.name, c.version]))).toEqual(D1);
  });

  test("a command the guard refuses needs the repo: no `acts` command runs outside one", () => {
    for (const c of all.filter((x) => x.version === "acts")) expect(c.repo).not.toBe(false);
  });
});
