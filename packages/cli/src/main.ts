#!/usr/bin/env bun
/**
 * The `norn` entry: the one place the CLI touches the process (argv, env, stdin, stdout,
 * signals, exit). Everything else runs in `runCli`, in-process and testable.
 */
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import { createNodeHost, nodeAncestry, nodeExec } from "@norn/host-node";
import { runCli } from "./cli.ts";
import { importFromPluginsDir } from "./plugins/installed.ts";
import { selfCommand } from "./self.ts";
import { NORN_VERSION } from "./version.ts";

const controller = new AbortController();
let signals = 0;
for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, () => {
    // the first signal lets `watch` finish its tick; a second stops at once
    if (++signals > 1) process.exit(130);
    controller.abort();
  });

const self = selfCommand(process.execPath, process.argv[1]);

/** The alternate screen (frames leave no scrollback), no cursor, SGR mouse reporting for the wheel. */
const SCREEN_ON = "\x1b[?1049h\x1b[?25l\x1b[?1000h\x1b[?1006h";
const SCREEN_OFF = "\x1b[?1006l\x1b[?1000l\x1b[?25h\x1b[?1049l";

/** stdin in raw mode for `status --watch`, put back as it was on close; without a terminal its input ends the cockpit. */
function terminal() {
  const stdin = process.stdin;
  const raw = stdin.isTTY === true;
  const screen = process.stderr.isTTY === true;
  if (raw) stdin.setRawMode(true);
  stdin.setEncoding("utf8");
  if (screen) process.stderr.write(SCREEN_ON);
  return {
    keys: stdin as AsyncIterable<string>,
    columns: Number(process.env.COLUMNS) || process.stderr.columns || 100,
    rows: Number(process.env.LINES) || process.stderr.rows || 30,
    color: screen && process.env.NO_COLOR === undefined && process.env.TERM !== "dumb",
    close: () => {
      if (raw) stdin.setRawMode(false);
      if (screen) process.stderr.write(SCREEN_OFF);
      stdin.pause();
    },
  };
}

const result = await runCli(process.argv.slice(2), {
  env: process.env,
  cwd: process.cwd(),
  userHome: homedir(),
  stdin: () => Bun.stdin.text(),
  signal: controller.signal,
  log: (line) => process.stderr.write(`${line}\n`),
  lines: () => createInterface({ input: process.stdin, terminal: false }),
  terminal,
  self,
  version: NORN_VERSION,
  hosts: { host: createNodeHost, exec: nodeExec, ancestry: nodeAncestry },
  importer: importFromPluginsDir,
});
// exit does not wait for a pipe write that has not drained, so a value over the pipe buffer would be cut off
const flushed = (stream: NodeJS.WriteStream, text: string) => new Promise<void>((resolve) => (text ? stream.write(text, () => resolve()) : resolve()));
await flushed(process.stderr, result.stderr ?? "");
await flushed(process.stdout, result.stdout);
try {
  await result.after?.();
} catch (e) {
  // the answer is out; what was left to mark is done again by the next call, never by failing this one
  process.stderr.write(`norn: ${e instanceof Error ? e.message : String(e)}\n`);
}
process.exit(result.exit);
