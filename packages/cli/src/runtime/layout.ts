/**
 * gh-110 D5: the one layout guard. The code knows one layout (D1); on a main checkout still on the
 * old one (B18, B19) or with a part in both places (B17) a command refuses before it reads config
 * or workflows, so norn never half-reads an old layout or guesses between two.
 */
import { cmd } from "@norn/core";
import { type Layout, layoutProblems, repoLayout } from "@norn/store";
import { refuse } from "../output.ts";

/** Throws the refusal for `root`'s layout unless it is new; returns the layout otherwise. */
export function guardLayout(root: string): Layout {
  const l = repoLayout(root);
  if (l.layout === "new") return l;
  throw layoutRefusal(l, root);
}

export function layoutRefusal(l: Layout, root: string) {
  const parts = layoutProblems(l, root);
  const details = { layout: l.layout, root, parts: l.parts.filter((p) => p.at_old) };
  if (l.layout === "both")
    return refuse(
      `${root} has norn files in both the old and the new layout (${parts.join("; ")}); norn reads neither`,
      `keep one of each pair and remove the other, then run ${cmd.migrate()} in ${root}`,
      "both_layouts",
      details,
    );
  return refuse(`${root} is on the old norn layout (${parts.join("; ")})`, cmd.migrate(), "old_layout", details);
}
