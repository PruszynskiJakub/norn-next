const SAFE_WORD = /^[A-Za-z0-9_@%+=:,./-]+$/;

/** One POSIX shell word: hook configs hold a command line, and a path with a space must stay one argument. */
export function shellQuote(argv: readonly string[]): string {
  return argv.map((a) => (SAFE_WORD.test(a) ? a : `'${a.replaceAll("'", `'\\''`)}'`)).join(" ");
}
