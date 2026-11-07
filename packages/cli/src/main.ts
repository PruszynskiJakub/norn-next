#!/usr/bin/env bun
/** `norn` entry point. Machine contract: one JSON value on stdout + exit code. */
import { runCli } from "./cli.ts";

const controller = new AbortController();
let signals = 0;
for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, () => {
    // first signal: let `watch` finish its tick and release claims; second: hard stop
    if (++signals > 1) process.exit(130);
    controller.abort();
  });

const result = await runCli(process.argv.slice(2), {
  signal: controller.signal,
  log: (line) => process.stderr.write(`${line}\n`),
});
// Exit only once stdout and stderr have flushed; exit does not wait for a pipe write
// that has not drained, so a value over the 64 KiB pipe buffer would be cut off
const flushed = (stream: NodeJS.WriteStream, text: string) =>
  new Promise<void>((resolve) => (text ? stream.write(text, () => resolve()) : resolve()));
await flushed(process.stderr, result.stderr ?? "");
await flushed(process.stdout, result.stdout);
process.exit(result.exit);
