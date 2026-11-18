/**
 * Conflict markers a branch's own commits left in: read off the diff since the branch left its base,
 * so a marker the base or an untouched file holds is never the branch's. Only a whole conflict
 * counts (an opening, a separating and a closing line, in order, each added), because docs and test
 * fixtures quote a marker or a lone `=======` (a setext heading) on purpose.
 */
import { fail, type HostContext, ok, type PluginResult, type VcsConflictMarker } from "@norn/plugin-api";
import { git, gitFailure } from "./git.ts";

const OPEN = /^<{7}( |$)/;
const SEPARATOR = /^={7}$/;
const CLOSE = /^>{7}( |$)/;
const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** A `+++` path as git prints it: prefixed with `b/`, quoted when it holds a character git escapes. */
function pathOf(header: string): string | null {
  let p = header.slice(4).replace(/\t$/, "");
  if (p === "/dev/null") return null;
  if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1).replace(/\\(["\\])/g, "$1").replace(/\\t/g, "\t").replace(/\\n/g, "\n");
  return p.startsWith("b/") ? p.slice(2) : p;
}

/** The opening line of every whole conflict the added lines of a `git diff -U0` hold, in diff order. */
export function addedConflicts(diff: string): VcsConflictMarker[] {
  const out: VcsConflictMarker[] = [];
  let path: string | null = null;
  let line = 0;
  // 0: looking for an opening marker; 1: opened, looking for the separator; 2: looking for the close
  let state = 0;
  let opened = 0;
  for (const l of diff.split("\n")) {
    if (l.startsWith("diff --git ")) {
      path = null;
      state = 0;
      continue;
    }
    if (l.startsWith("+++ ")) {
      path = pathOf(l);
      continue;
    }
    const hunk = HUNK.exec(l);
    if (hunk) {
      line = Number(hunk[1]);
      continue;
    }
    if (path === null) continue;
    if (l.startsWith(" ")) line++;
    if (!l.startsWith("+")) continue;
    const text = l.slice(1);
    if (OPEN.test(text)) {
      state = 1;
      opened = line;
    } else if (state === 1 && SEPARATOR.test(text)) state = 2;
    else if (state === 2 && CLOSE.test(text)) {
      out.push({ path, line: opened });
      state = 0;
    }
    line++;
  }
  return out;
}

/** The whole conflicts the commits on `head` since it left `base` added, sorted by path and line. */
export async function conflictMarkers(ctx: HostContext, cwd: string, base: string, head: string): Promise<PluginResult<VcsConflictMarker[]>> {
  if (base.startsWith("-") || head.startsWith("-")) return fail("invalid", `git: ${base} or ${head} is not a ref`, false);
  // a repo's diff settings (external tools, textconv, no prefixes, quoted paths) would change what is read
  const out = await git(ctx, cwd, [
    "-c",
    "core.quotePath=false",
    "diff",
    "-U0",
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    "--src-prefix=a/",
    "--dst-prefix=b/",
    `${base}...${head}`,
  ]);
  if (out.code !== 0) return gitFailure(out, "diff");
  const found = addedConflicts(out.stdout);
  return ok(found.sort((a, b) => (a.path === b.path ? a.line - b.line : a.path < b.path ? -1 : 1)));
}
