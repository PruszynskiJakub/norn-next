/**
 * `open-pr`: open the story's draft change from its `pr.md`, or update the one already open, and set
 * its body. Written over the Forge and Vcs slots, never a provider, so every forge gets the same step.
 * The branch is pushed first (when the vcs pushes at all), after taking in what a person pushed to it,
 * so the change shows the head this step saw.
 */
import { fail, type ForgeEffect, type HostContext, ok, parseStoryKey, type PluginResult, type StepKindDefinition, type StepKindInput, type StepKindOutcome, type Vcs } from "@norn/plugin-api";
import { PR_BODY_FILE, SPECS_DIR } from "@norn/schema";
import { type Static, Type } from "@sinclair/typebox";

export const OpenPrConfig = Type.Object(
  {
    /** the body's file, relative to the worktree; absent: `pr.md` in the story's spec folder */
    body_file: Type.Optional(Type.String({ minLength: 1, pattern: "^[^/]" })),
  },
  { additionalProperties: false },
);
export type OpenPrConfig = Static<typeof OpenPrConfig>;

/** Characters every forge can carry a receipt id in (a GitHub marker is the narrowest). */
const RECEIPT_SAFE = /[^0-9A-Za-z_-]/g;

/**
 * The idempotence key: the receipt the host wrote, else one derived from the unit, the step and the
 * head, so a host that passes none still never opens two changes for one push.
 */
export function effectKey(input: Pick<StepKindInput, "unit" | "step" | "receipt_id">, head: string | null): string {
  if (input.receipt_id !== undefined) return input.receipt_id;
  return `${input.unit}-${input.step}-${(head ?? "nohead").slice(0, 12)}`.replace(RECEIPT_SAFE, "-").slice(0, 64);
}

async function readText(ctx: HostContext, path: string): Promise<string | null> {
  try {
    return await ctx.files.read(path);
  } catch {
    return null;
  }
}

/** The agent's body file as written, trimmed; "" when there is none. */
async function bodyText(ctx: HostContext, input: StepKindInput<OpenPrConfig>): Promise<string> {
  const wt = input.worktree;
  if (wt === undefined) return "";
  const file = input.config.body_file ?? `${SPECS_DIR}/${input.story}/${PR_BODY_FILE}`;
  return ((await readText(ctx, `${wt}/${file}`)) ?? "").trim();
}

/** The story's title and link from the tracker; a tracker that cannot answer leaves the body's heading as the title. */
async function storyItem(input: StepKindInput<OpenPrConfig>): Promise<{ title?: string; url?: string }> {
  const tracker = input.slots?.tracker;
  const key = tracker ? parseStoryKey(input.story, tracker.keyPrefix) : null;
  if (!tracker || !key) return {};
  const got = await tracker.get(key.id);
  if (!got.ok || got.value === null) return {};
  return { title: got.value.title, ...(got.value.url !== undefined ? { url: got.value.url } : {}) };
}

const heading = (text: string): string | undefined => /^#\s+(.+)$/m.exec(text)?.[1]?.trim() || undefined;

export function composeBody(text: string, story: string, url: string | undefined): string {
  const footer = `${url ? `Closes ${url}\n\n` : ""}Delivered by norn (story ${story}).`;
  return text ? `${text}\n\n---\n\n${footer}` : footer;
}

/**
 * Take in commits a person pushed to the branch since norn last pushed it, so the push after them is
 * a fast-forward rather than refused: a merge commit, never a rebase or a force, since both sides are
 * published. A merge that conflicts is aborted and refused for a person, who merges by hand; nothing
 * of either side is dropped. Answers the branch's head after it.
 */
async function takeRemote(vcs: Vcs, branch: string, head: string | null): Promise<PluginResult<string | null>> {
  if (!vcs.remoteHead || !vcs.capabilities.merge) return ok(head);
  const remote = await vcs.remoteHead(branch);
  if (!remote.ok) return remote;
  if (remote.value === null || remote.value === head) return ok(head);
  if (head !== null) {
    const holds = await vcs.isAncestor(remote.value, head);
    if (!holds.ok) return holds;
    if (holds.value) return ok(head);
  }
  const merged = await vcs.merge(branch, remote.value, { abortOnConflict: true });
  if (!merged.ok) return merged;
  if ("conflict" in merged.value) {
    const files = merged.value.conflict.files.join(", ") || "?";
    return fail(
      "conflict",
      `open-pr: ${branch} diverged from its remote copy (${remote.value.slice(0, 12)}), which a person pushed to; merging it conflicts in ${files}. Nothing was pushed: merge ${remote.value.slice(0, 12)} into ${branch} in its worktree by hand (a merge commit, never a rebase or a force), and the step runs again`,
      false,
    );
  }
  return ok(merged.value.head);
}

async function run(input: StepKindInput<OpenPrConfig>, ctx: HostContext): Promise<PluginResult<StepKindOutcome>> {
  const forge = input.slots?.forge;
  if (!forge) return fail("invalid", "open-pr: the repo has no forge configured", false);
  const branch = input.branch;
  const base = input.base?.branch;
  if (branch === undefined || base === undefined) return fail("invalid", "open-pr: the host passed no branch or base for the unit", false);
  const found = await forge.findChanges([branch]);
  if (!found.ok) return found;
  const existing = found.value[branch] ?? null;
  // the story's work already landed: a second change would deliver it twice
  if (existing?.state === "merged") return fail("conflict", `open-pr: change ${existing.id} of ${branch} is already merged; no new change opened`, false);

  const vcs = input.slots?.vcs;
  let head: string | null = null;
  if (vcs) {
    const h = await vcs.head(branch);
    if (!h.ok) return h;
    head = h.value;
    if (vcs.capabilities.push) {
      const took = await takeRemote(vcs, branch, head);
      if (!took.ok) return took;
      head = took.value;
      const pushed = await vcs.push(branch);
      if (!pushed.ok) return pushed;
    }
  }
  const text = await bodyText(ctx, input);
  const item = await storyItem(input);
  const title = item.title ?? heading(text) ?? input.story;
  const body = composeBody(text, input.story, item.url);
  const effect: ForgeEffect =
    existing?.state === "open"
      ? { kind: "update", id: existing.id, title, body }
      : { kind: "open", head: branch, base, title, body, draft: forge.capabilities.draft };
  const done = await forge.perform(effect, { receipt_id: effectKey(input, head) });
  if (!done.ok) return done;
  return ok({ outcome: "done", detail: { change: done.value.change, effect: effect.kind, replayed: done.value.replayed, ...(head !== null ? { head } : {}) } });
}

export const openPr: StepKindDefinition<typeof OpenPrConfig> = {
  name: "open-pr",
  configSchema: OpenPrConfig,
  outcomes: ["done"],
  mode: "effect",
  run,
};
