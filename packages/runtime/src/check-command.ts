/**
 * A check step may name a command the config holds, as `{checks.<name>}`, so a repo sets its test
 * command once in its config rather than in a copy of every shipped workflow. The step keeps the
 * name, never the command: the workflow's hash stays the same whatever a machine's config says.
 */

/** What a check named `test` runs when no config sets `checks.test`. */
export const DEFAULT_CHECKS: Readonly<Record<string, string>> = { test: "bun test" };

const NAMED = /\{checks\.([a-z0-9][a-z0-9._-]*)\}/g;

/** The command with each `{checks.<name>}` replaced by the config's; the names no config sets otherwise. */
export function checkCommandOf(command: string, checks: Readonly<Record<string, string>> | undefined): { ok: true; command: string } | { ok: false; missing: string[]; error: string } {
  const all = { ...DEFAULT_CHECKS, ...checks };
  const missing = [...new Set([...command.matchAll(NAMED)].map((m) => m[1] as string).filter((name) => all[name] === undefined))];
  if (missing.length > 0) {
    const sets = missing.map((n) => `norn config set checks.${n} <command>`).join(", ");
    return { ok: false, missing, error: `the check names ${missing.map((n) => `{checks.${n}}`).join(", ")}, which no config sets: ${sets}` };
  }
  // a replacer function, so a `$` in the configured command is never read as a replacement pattern
  return { ok: true, command: command.replace(NAMED, (_m, name: string) => all[name] as string) };
}
