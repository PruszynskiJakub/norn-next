/**
 * The live canary's stand-in for norn's hook command: run as `bun recorder.ts <harness>`, which a
 * harness then extends with the hook's name, it keeps each call as the agent made it and answers
 * nothing, which every harness's protocol reads as allow.
 */
import { appendFileSync, readFileSync } from "node:fs";

export const RECORDER_PATH = import.meta.path;

/** The hook command a harness is installed with, so it runs this recorder for `harness`. */
export const recorderCommand = (harness: string): string => `bun ${JSON.stringify(RECORDER_PATH)} ${harness}`;

/**
 * Which harness and hook a call is for, from the recorder's argv (`bun recorder.ts <harness> <hook>`).
 * A harness appends only the hook's name to its hook command, so the harness comes from the command.
 */
export function recordedCall(argv: readonly string[]): { harness: string | undefined; hook: string | undefined } {
  const at = argv.findIndex((a) => a === RECORDER_PATH);
  const rest = at === -1 ? argv.slice(2) : argv.slice(at + 1);
  return { harness: rest[0], hook: rest[1] };
}

if (import.meta.main) {
  const { harness, hook } = recordedCall(process.argv);
  let payload: unknown = null;
  try {
    payload = JSON.parse(readFileSync(0, "utf8"));
  } catch {}
  const log = process.env.NORN_CANARY_LOG;
  if (log) appendFileSync(log, `${JSON.stringify({ harness, hook, at: new Date().toISOString(), payload })}\n`);
}
