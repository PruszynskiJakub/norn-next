/**
 * `norn status --segment`: one plain line for Herdr's tab bar (`tab_bar_right`), and the presentation
 * of norn's orient workspaces — a sidebar token per story and needs-you-first order. Pure: a view
 * and Herdr's workspaces in, the line, tokens and moves out. Presentation only, never a fact (HC13).
 */
import { basename } from "node:path";
import { herdr } from "@norn/adapters";
import type { InboxGroup } from "@norn/core";
import { inboxItemsInOrder, type ProjectView } from "@norn/view";
import { GROUP_MARK } from "./pick.ts";

/** Groups the segment counts, in O1 order, with the word shown after the count. */
const COUNTED: Array<[InboxGroup, string]> = [
  ["your_turn", "your turn"],
  ["answer", "answer"],
  ["approve", "approve"],
  ["unblock", "stuck"],
  ["check", "check"],
  ["running", "running"],
];

/** Groups that wait for the person. */
const NEEDS: readonly InboxGroup[] = ["your_turn", "answer", "approve", "unblock", "check"];

/** e.g. `norn·todoist-app ● 1 approve ◐ 2 running`; calm when nothing waits: `norn·todoist-app ✓ nothing waits`. */
export function segmentLine(view: ProjectView): string {
  const head = `norn·${basename(view.repo)}`;
  const parts = COUNTED.flatMap(([g, word]) => {
    const n = view.inbox.groups[g].length;
    return n ? [`${GROUP_MARK[g]} ${n} ${word}`] : [];
  });
  const waiting = NEEDS.some((g) => view.inbox.groups[g].length > 0);
  return waiting ? `${head} ${parts.join(" ")}` : `${head} ✓ nothing waits${parts.length ? ` · ${parts.join(" ")}` : ""}`;
}

/** What a story needs, as its orient workspace's sidebar token; `needs` = it waits for the person. */
export function storyToken(view: ProjectView, story: string): { text: string; needs: boolean } {
  const items = inboxItemsInOrder(view).filter((i) => i.story === story);
  const first = items.find((i) => NEEDS.includes(i.group));
  if (first) {
    const word = COUNTED.find(([g]) => g === first.group)?.[1] ?? first.group;
    const more = items.filter((i) => NEEDS.includes(i.group)).length - 1;
    return { text: `${GROUP_MARK[first.group]} ${word}${more > 0 ? ` +${more}` : ""}`, needs: true };
  }
  if (items.some((i) => i.group === "running")) return { text: `${GROUP_MARK.running} running`, needs: false };
  const s = view.stories.find((x) => x.key === story);
  return { text: s?.status === "done" ? "✓ done" : "· quiet", needs: false };
}

/**
 * A story's orient workspace: labelled `<story> orient` with a pane in the story's checkout or worktree
 * (another repo's story of the same key has none). Other panes may sit elsewhere: the picker's popup
 * runs from the plugin folder inside the workspace it covers.
 */
export function isOrientWorkspace(w: herdr.HerdrWorkspace, story: string, root: string): boolean {
  return w.label === `${story} orient` && (w.cwds.length === 0 || w.cwds.some((c) => herdr.inside(c, root)));
}

/**
 * Moves that put our workspaces in needs-you-first order inside the slots they already hold, moving
 * only ours: every other workspace ends where it was. Applied in order with `workspace.move
 * {workspace_id, insert_index}`; none when the order holds. Herdr's `insert_index` is a gap in the
 * order as it stands, the moved workspace still in it (verified on herdr 0.9.5: moving index 5 to 7
 * lands at 6), so each move's index is that gap.
 */
export function planWorkspaceMoves(order: readonly string[], ours: readonly string[], needs: ReadonlySet<string>): Array<{ workspace_id: string; index: number }> {
  const mine = new Set(ours);
  const slots = order.flatMap((id, i) => (mine.has(id) ? [i] : []));
  const present = order.filter((id) => mine.has(id));
  const wanted = [...present.filter((id) => needs.has(id)), ...present.filter((id) => !needs.has(id))];
  const target = [...order];
  slots.forEach((slot, k) => {
    target[slot] = wanted[k] as string;
  });
  if (target.every((id, i) => id === order[i])) return [];
  // ours to the end in the wanted order, then each into its slot: the slots before it are already final
  const finals = [...wanted.map((id) => ({ id, at: order.length - 1 })), ...slots.map((slot, k) => ({ id: wanted[k] as string, at: slot }))];
  const now = [...order];
  return finals.map(({ id, at }) => {
    const from = now.indexOf(id);
    now.splice(from, 1);
    now.splice(at, 0, id);
    return { workspace_id: id, index: at > from ? at + 1 : at };
  });
}
