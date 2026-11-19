/**
 * What a local change is right now. Git is the truth for merged: a person merges with git, and the
 * forge sees it the next time it looks. The merge is remembered on first sight so `merged_at` and
 * `merge_sha` do not drift as the base moves on or the head branch is deleted.
 */
import { type ChangeRequest, type ChangeRequestState, type HostContext, ok, type PluginResult } from "@norn/plugin-api";
import { baseTip, isAncestor, revParse } from "./git.ts";
import type { ChangeRecord } from "./record.ts";

export interface Observed {
  state: ChangeRequestState;
  head_sha: string;
  /** the record to keep: the input itself unless this look saw the merge for the first time */
  record: ChangeRecord;
}

export async function observe(ctx: HostContext, rec: ChangeRecord): Promise<PluginResult<Observed>> {
  if (rec.merged_at !== undefined) return ok({ state: "merged", head_sha: rec.head_sha, record: rec });
  if (rec.closed_at !== undefined) return ok({ state: "closed", head_sha: rec.head_sha, record: rec });
  const head = await revParse(ctx, rec.head_branch);
  if (!head.ok) return head;
  const headSha = head.value ?? rec.head_sha;
  const base = await baseTip(ctx, rec.base_branch);
  if (!base.ok) return base;
  if (base.value === null) return ok({ state: "open", head_sha: headSha, record: rec });
  const inBase = await isAncestor(ctx, headSha, base.value);
  if (!inBase.ok) return inBase;
  if (!inBase.value) return ok({ state: "open", head_sha: headSha, record: rec });
  // a head already inside the base when the change opened (a branch with no commits yet) has merged nothing
  const wasThere = await isAncestor(ctx, headSha, rec.base_sha_at_open);
  if (!wasThere.ok) return wasThere;
  if (wasThere.value) return ok({ state: "open", head_sha: headSha, record: rec });
  return ok({ state: "merged", head_sha: headSha, record: { ...rec, head_sha: headSha, merged_at: ctx.now(), merge_sha: base.value } });
}

export function toChange(o: Observed): ChangeRequest {
  const r = o.record;
  return {
    id: r.id,
    state: o.state,
    draft: r.draft,
    head_branch: r.head_branch,
    base_branch: r.base_branch,
    head_sha: o.head_sha,
    ...(o.state === "merged" && r.merge_sha !== undefined && { merge_sha: r.merge_sha }),
    ...(o.state === "merged" && r.merged_at !== undefined && { merged_at: r.merged_at }),
    title: r.title,
  };
}
