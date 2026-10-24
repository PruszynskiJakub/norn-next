/**
 * `norn approve <unit> [--reject] [--reason "…"]` (O2, W2 gate): decide the gate a unit waits at.
 * Writes an `approve` or `reject` receipt at the cursor. Claim free: acquired here (T8); held
 * elsewhere: posted to the mailbox (T9).
 */
import { nextCommand, stepOf } from "@norn/core";
import type { UnitState } from "@norn/schema";
import { git as rawGit } from "@norn/store";
import type { Context } from "../context.ts";
import { defineCommand, opt } from "../command.ts";
import { refuse } from "../output.ts";
import { at, humanReceipt, resolveTarget, runHumanVerb, type Target } from "../runtime/human.ts";
import { appendProgress, rejectProgress } from "../runtime/report.ts";

const atGate = (st: UnitState) => st.status === "parked" && st.park?.kind === "gate";

const SHA = /^[0-9a-f]{40,64}$/;

/**
 * F35: the story branch head at `approve` — the story worktree's HEAD, else the local branch,
 * else its remote-tracking ref. Recorded as the approve receipt's `head_sha` (observe: `ready_head_sha`).
 * C2: a slice gate's ruling records its slice worktree's HEAD. Every ruling names the head it judged.
 */
async function unitHead(ctx: Context, t: Target): Promise<string | null> {
  const sf = t.story_facts;
  if (t.slice !== null) {
    const head = sf?.units.find((u) => u.unit.key === t.key)?.worktree?.status?.head;
    return head && SHA.test(head) ? head : null;
  }
  const fromWt = sf?.worktree?.status?.head;
  if (fromWt && SHA.test(fromWt)) return fromWt;
  const branch = sf?.branch;
  if (!branch) return null;
  for (const ref of [`refs/heads/${branch}`, `refs/remotes/${ctx.config.remote.git_remote}/${branch}`]) {
    const r = await rawGit(ctx.root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    if (r.code === 0) return r.stdout.trim();
  }
  return null;
}

export const approveCommand = defineCommand({
  name: "approve",
  summary: "Approve (or --reject) the gate a unit waits at (O2)",
  usage: 'norn approve <unit> [--reject] [--reason "…"]',
  options: { reject: { type: "boolean" }, reason: { type: "string" } },
  positionals: { min: 1, max: 1 },
  async run(ctx, args) {
    const kind = opt.bool(args, "reject") ? "reject" : "approve";
    const reason = opt.str(args, "reason")?.trim();
    const t = await resolveTarget(ctx, args.positionals[0] as string, atGate);
    const head = await unitHead(ctx, t).catch(() => null);
    // NT3: approving a story-level gate acknowledges the story's open notes listed at it; reject leaves them open
    const acknowledged = kind === "approve" && t.slice === null ? (t.story_facts?.notes ?? []).map((n) => n.id) : [];
    const out = await runHumanVerb(ctx, t, {
      verb: "approve",
      mailbox: true,
      check(t, st) {
        const step = t.workflow ? stepOf(t.workflow, st.step) : null;
        if (step?.type !== "gate" || !atGate(st))
          throw refuse(
            `${t.key} is not waiting at a gate: ${st.step} is ${step ? `a ${step.type} step` : "not in its workflow"}, at ${at(st)}`,
            nextCommand(t.key, st) ?? `norn status ${t.story}`,
            "not_at_gate",
          );
      },
      build: (t, st) =>
        humanReceipt(ctx, t, st, kind, { ...(reason ? { comment: reason } : {}), ...(head ? { head_sha: head } : {}), ...(acknowledged.length ? { acknowledged_notes: acknowledged } : {}) }),
    });
    if (kind !== "reject") return out;
    // the rejection is a milestone of the unit, like `done` (O6): the next brief's Context carries it;
    // through the mailbox the holder's tick appends it when it imports the receipt (T9)
    if (out.delivered.via === "local" && t.runsDir) appendProgress(t.runsDir, rejectProgress(out.receipt));
    // B3: the agent sent back gets only what the comment says; without one it must ask
    return reason ? out : { ...out, warning: "rejected without --reason: the agent sent back has nothing to fix but the evidence; pass --reason \"what failed\" next time" };
  },
});
