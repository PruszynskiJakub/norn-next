/**
 * `norn upgrade`'s refusal of a main checkout with a part in both layouts' places:
 * it moves nothing rather than guess which of the two is the repo's.
 */
import { cmd } from "@norn/core";
import { type Layout, layoutProblems } from "@norn/store";
import { refuse } from "../output.ts";

export function layoutRefusal(l: Layout, root: string) {
  const parts = layoutProblems(l, root);
  const details = { layout: l.layout, root, parts: l.parts.filter((p) => p.at_old) };
  if (l.layout === "both")
    return refuse(
      `${root} has norn files in both the old and the new layout (${parts.join("; ")}); norn reads neither`,
      `keep one of each pair and remove the other, then run ${cmd.upgrade()} in ${root}`,
      "both_layouts",
      details,
    );
  return refuse(`${root} is on the old norn layout (${parts.join("; ")})`, cmd.upgrade(), "old_layout", details);
}
