/**
 * The command that runs this same norn, for a launched agent's hooks. A compiled binary is its own
 * program; run by bun (from source, or the npm package's bundled `norn.js`) the script must follow
 * bun, or a hook would run `bun hook …` and bun would look for a script named `hook`.
 */
export function selfCommand(execPath: string, script: string | undefined): string[] {
  const viaBun = /^bun(\.exe)?$/i.test(execPath.split(/[\\/]/).pop() ?? "");
  return viaBun && script ? [execPath, script] : [execPath];
}
