/**
 * The fake `gh` (fixtures/fake-gh) put on a World's PATH, its repository in `<dir>/gh.json` and its
 * call log in `<dir>/gh.log`; and the remote's push log, which a post-receive hook on the bare
 * remote appends `<ref> <old> <new>` to, so a test reads when the story branch was pushed.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GhPr, GhState } from "./fixtures/fake-gh/gh.ts";
import type { World } from "./world.ts";

export type { GhIssue, GhPr, GhState } from "./fixtures/fake-gh/gh.ts";

const GH = join(import.meta.dir, "fixtures", "fake-gh", "gh.ts");
export const REPO = "acme/app";
export const LOGIN = "octocat";
export const WEB = `https://github.com/${REPO}`;

const statePath = (w: World) => join(w.dir, "gh.json");
const logPath = (w: World) => join(w.dir, "gh.log");
export const pushLogPath = (w: World) => join(w.dir, "pushes.log");

function script(path: string, text: string): void {
  writeFileSync(path, text);
  chmodSync(path, 0o755);
}

/**
 * The fake gh first on the World's PATH, with an instant `sleep` beside it: the check scripts wait in
 * 5- and 10-second sleeps for GitHub, which the fake answers at once. Also the remote's push log.
 */
export function fakeGh(w: World): void {
  const bin = join(w.dir, "bin");
  mkdirSync(bin, { recursive: true });
  script(join(bin, "gh"), `#!/bin/sh\nexec bun ${JSON.stringify(GH)} "$@"\n`);
  script(join(bin, "sleep"), "#!/bin/sh\nexit 0\n");
  const state: GhState = { repo: REPO, login: LOGIN, remote: w.remote, issues: [], labels: [], prs: [], fail: {} };
  writeFileSync(statePath(w), JSON.stringify(state, null, 2));
  writeFileSync(logPath(w), "");
  script(join(w.remote, "hooks", "post-receive"), `#!/bin/sh\nwhile read old new ref; do echo "$ref $old $new" >> ${JSON.stringify(pushLogPath(w))}; done\n`);
  w.env.PATH = `${bin}:${process.env.PATH ?? ""}`;
  w.env.FAKE_GH_STATE = statePath(w);
  w.env.FAKE_GH_LOG = logPath(w);
}

export function ghState(w: World): GhState {
  return JSON.parse(readFileSync(statePath(w), "utf8")) as GhState;
}

/** Change the fake repository as a person on github.com would: merge a PR, rename an issue, break a call. */
export function editGh(w: World, change: (s: GhState) => void): void {
  const s = ghState(w);
  change(s);
  writeFileSync(statePath(w), JSON.stringify(s, null, 2));
}

/** Every gh call so far, as argv after `gh`. */
export function ghCalls(w: World): string[][] {
  return readFileSync(logPath(w), "utf8")
    .split("\n")
    .filter((l) => l.startsWith("["))
    .map((l) => JSON.parse(l) as string[]);
}

/** The calls whose first two words are `cmd` (`label create`, `pr edit`). */
export function callsOf(calls: string[][], cmd: string): string[][] {
  return calls.filter((c) => `${c[0]} ${c[1]}` === cmd);
}

/** The pushed refs, one `<ref> <old> <new>` line each, in order. */
export function pushes(w: World): string[] {
  return existsSync(pushLogPath(w)) ? readFileSync(pushLogPath(w), "utf8").split("\n").filter(Boolean) : [];
}

export function openPr(w: World, head: string): GhPr | undefined {
  return ghState(w).prs.find((p) => p.head === head);
}

/** A PR's body without the receipt markers norn hides in it. */
export const visibleBody = (body: string): string => body.replace(/<!--[^>]*-->/g, "").trim();
