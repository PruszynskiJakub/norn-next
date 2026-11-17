#!/usr/bin/env bun
/**
 * The `norn-thin` entry: the one place the CLI touches the process (argv, env, stdin, stdout,
 * signals, exit). Everything else runs in `runCli`, in-process and testable.
 */
import { homedir } from "node:os";
import { createNodeHost, nodeExec } from "@norn/host-node";
import { runCli } from "./cli.ts";
import { importFromPluginsDir } from "./plugins/installed.ts";
import { NORN_VERSION } from "./version.ts";

const controller = new AbortController();
let signals = 0;
for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, () => {
    // the first signal lets `watch` finish its tick; a second stops at once
    if (++signals > 1) process.exit(130);
    controller.abort();
  });

// run from source, the binary is `bun main.ts`: a launched agent's hooks must call this same build
const script = process.argv[1] ?? "";
const self = script.endsWith(".ts") ? [process.execPath, script] : [process.execPath];

const result = await runCli(process.argv.slice(2), {
  env: process.env,
  cwd: process.cwd(),
  userHome: homedir(),
  stdin: () => Bun.stdin.text(),
  signal: controller.signal,
  log: (line) => process.stderr.write(`${line}\n`),
  self,
  version: NORN_VERSION,
  hosts: { host: createNodeHost, exec: nodeExec },
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
