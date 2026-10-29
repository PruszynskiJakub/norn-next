/**
 * `norn story approve [<unit>] [--reason "…"]` (B25) and `norn story reject [<unit>] --reason "…"` (B26)
 * (O2, W2 gate): decide the gate a unit waits at. Without a unit: the worktree's, else a pick of the
 * units at a gate (B54, B57). Writes an `approve` or `reject` receipt at the cursor. Claim free:
 * acquired here (T8); held elsewhere: posted to the mailbox (T9).
 */
import { cmd, nextCommand, stepOf } from "@norn/core";
import { isGitSha, type UnitState } from "@norn/schema";
import type { Context } from "../context.ts";
import { defineCommand, opt, type ParsedArgs } from "../command.ts";
import { refuse, usageError } from "../output.ts";
import { at, humanReceipt, resolveTarget, runHumanVerb, type Target } from "../runtime/human.ts";
import { appendProgress, rejectProgress } from "../runtime/report.ts";
import { parkedOn, targetKey } from "../runtime/target.ts";

const atGate = (st: UnitState) => st.status === "parked" && st.park?.kind === "gate";

/**
 * F35: the story branch head at `approve` — the story worktree's HEAD, else the local branch,
 * else its remote-tracking ref. Recorded as the approve receipt's `head_sha` (observe: `ready_head_sha`).
 * C2: a slice gate's ruling records its slice worktree's HEAD. Every ruling names the head it judged.
 */
async function unitHead(ctx: Context, t: Target): Promise<string | null> {
  const sf = t.story_facts;
  if (t.slice !== null) {
    const head = sf?.units.find((u) => u.unit.key === t.key)?.worktree?.status?.head;
    return isGitSha(head) ? head : null;
  }
  const fromWt = sf?.worktree?.status?.head;
  if (isGitSha(fromWt)) return fromWt;
  const branch = sf?.branch;
  if (!branch) return null;
  for (const ref of [`refs/heads/${branch}`, `refs/remotes/${ctx.config.remote.git_remote}/${branch}`]) {
    const sha = await ctx.git.revParse(ctx.root, `${ref}^{commit}`);
    if (sha) return sha;
  }
  return null;
}

/** Decide the gate: the receipt, and for a rejection the milestone in handoff.md (O6). */
async function decideGate(ctx: Context, args: ParsedArgs, kind: "approve" | "reject") {
  const verb = `story ${kind}`;
  const reason = opt.str(args, "reason")?.trim();
  // B26 (B3): the agent sent back gets only what the reason says, so a rejection needs one
  if (kind === "reject" && !reason) throw usageError("story reject: the reason is required", 'pass --reason "what failed": norn story reject <unit> --reason "…"', "reason_required");
  const key = await targetKey(ctx, args.positionals[0], args.json === true, parkedOn("gate", verb, "Nothing waits at a gate", (k) => cmd.approve(k, { reject: kind === "reject" })));
  const t = await resolveTarget(ctx, key, atGate);
  const head = await unitHead(ctx, t).catch(() => null);
  // NT3: approving a story-level gate acknowledges the story's open notes listed at it; reject leaves them open
  const acknowledged = kind === "approve" && t.slice === null ? (t.story_facts?.notes ?? []).map((n) => n.id) : [];
  const out = await runHumanVerb(ctx, t, {
    verb,
    mailbox: true,
    check(t, st) {
      const step = t.workflow ? stepOf(t.workflow, st.step) : null;
      if (step?.type !== "gate" || !atGate(st))
        throw refuse(
          `${t.key} is not waiting at a gate: ${st.step} is ${step ? `a ${step.type} step` : "not in its workflow"}, at ${at(st)}`,
          nextCommand(t.key, st) ?? cmd.status(t.story),
          "not_at_gate",
        );
    },
    build: (t, st) =>
      humanReceipt(ctx, t, st, kind, { ...(reason ? { comment: reason } : {}), ...(head ? { head_sha: head } : {}), ...(acknowledged.length ? { acknowledged_notes: acknowledged } : {}) }),
  });
  // the rejection is a milestone of the unit, like `done` (O6): the next brief's Context carries it;
  // through the mailbox the holder's tick appends it when it imports the receipt (T9)
  if (kind === "reject" && out.delivered.via === "local" && t.runsDir) appendProgress(t.runsDir, rejectProgress(out.receipt));
  return out;
}

export const storyApproveCommand = defineCommand({
  name: "story approve",
  summary: "Approve the gate a unit waits at (B25, O2)",
  usage: 'norn story approve [<story|slice>] [--reason "…"]',
  optionHelp: { "--reason <text>": "a comment kept on the approve receipt" },
  options: { reason: { type: "string" } },
  positionals: { max: 1 },
  run: (ctx, args) => decideGate(ctx, args, "approve"),
});

export const storyRejectCommand = defineCommand({
  name: "story reject",
  summary: "Reject the gate a unit waits at, with the reason the next attempt gets (B26, O2)",
  usage: 'norn story reject [<story|slice>] --reason "…"',
  optionHelp: { "--reason <text>": "required: what failed; the agent sent back gets it" },
  options: { reason: { type: "string" } },
  positionals: { max: 1 },
  run: (ctx, args) => decideGate(ctx, args, "reject"),
});
