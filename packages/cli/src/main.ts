#!/usr/bin/env bun
/** `norn` entry point. Machine contract: one JSON value on stdout + exit code (P8). */
import { runCli } from "./cli.ts";

const controller = new AbortController();
let signals = 0;
for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, () => {
    // first signal: let `watch` finish its tick and release claims (T6); second: hard stop
    if (++signals > 1) process.exit(130);
    controller.abort();
  });

const result = await runCli(process.argv.slice(2), {
  signal: controller.signal,
  log: (line) => process.stderr.write(`${line}\n`),
});
if (result.stderr) process.stderr.write(result.stderr);
process.stdout.write(result.stdout);
process.exit(result.exit);
