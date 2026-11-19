/**
 * The fake `herdr` (fixtures/fake-herdr) put on a World's PATH, its workspaces, tabs and panes in
 * `<dir>/herdr.json` and its call log in `<dir>/herdr.log`.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type HerdrPane, type HerdrState, inputPath } from "./fixtures/fake-herdr/state.ts";
import type { World } from "./world.ts";

export type { HerdrPane, HerdrState, HerdrTab, HerdrWorkspace } from "./fixtures/fake-herdr/state.ts";

const HERDR = join(import.meta.dir, "fixtures", "fake-herdr", "herdr.ts");

const statePath = (w: World) => join(w.dir, "herdr.json");
const logPath = (w: World) => join(w.dir, "herdr.log");

/** The fake herdr first on the World's PATH, with no workspace open. */
export function fakeHerdr(w: World): void {
  const bin = join(w.dir, "herdr-bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "herdr"), `#!/bin/sh\nexec bun ${JSON.stringify(HERDR)} "$@"\n`);
  chmodSync(join(bin, "herdr"), 0o755);
  const state: HerdrState = { next: 1, workspaces: [], tabs: [], panes: [] };
  writeFileSync(statePath(w), JSON.stringify(state, null, 2));
  writeFileSync(logPath(w), "");
  w.env.PATH = `${bin}:${w.env.PATH ?? process.env.PATH ?? ""}`;
  w.env.FAKE_HERDR_STATE = statePath(w);
  w.env.FAKE_HERDR_LOG = logPath(w);
}

export function herdrState(w: World): HerdrState {
  return JSON.parse(readFileSync(statePath(w), "utf8")) as HerdrState;
}

/** Change a pane as herdr would show it: a dialog that blocks the agent, its screen. */
export function editPane(w: World, paneId: string, change: (p: HerdrPane) => void): void {
  const s = herdrState(w);
  const p = s.panes.find((x) => x.pane_id === paneId);
  if (!p) throw new Error(`no pane ${paneId} in the fake herdr`);
  change(p);
  writeFileSync(statePath(w), JSON.stringify(s, null, 2));
}

/** Every herdr call so far, as argv after `herdr` (and its `--session`). */
export function herdrCalls(w: World): string[][] {
  return readFileSync(logPath(w), "utf8")
    .split("\n")
    .filter((l) => l.startsWith("["))
    .map((l) => JSON.parse(l) as string[]);
}

/** The calls whose first two words are `cmd` (`pane run`, `tab create`). */
export function herdrCallsOf(calls: string[][], cmd: string): string[][] {
  return calls.filter((c) => `${c[0]} ${c[1]}` === cmd);
}

/** What was typed into a pane: text as it went, each key as `<name>`. */
export function typedInto(w: World, paneId: string): string {
  const path = inputPath(statePath(w), paneId);
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}
