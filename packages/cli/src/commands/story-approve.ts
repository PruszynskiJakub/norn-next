/**
 * `norn story approve [<unit>] [--reason "…"]` (B25) and `norn story reject [<unit>] --reason "…"` (B26)
 * (O2, W2 gate): decide the gate a unit waits at. Without a unit: the worktree's, else a pick of the
 * units at a gate (B54, B57). Writes an `approve` or `reject` receipt at the cursor. Claim free:
 * acquired here (T8); held elsewhere: posted to the mailbox (T9).
 */
import { cmd, isParked, nextCommand, stepOf } from "@norn/core";
import { isGitSha, type UnitState } from "@norn/schema";
import type { Context } from "../context.ts";
import { defineCommand, type ParsedArgs } from "../command.ts";
import { refuse, usageError } from "../output.ts";
import { at, DELEGATED_HELP, DELEGATED_OPTION, delegatedFields, delegation, humanReceipt, stepOnlyReceipt, resolveTarget, runHumanVerb, type Target } from "../runtime/human.ts";
import { parkedOn, targetKey } from "../runtime/target.ts";

const atGate = (st: UnitState) => isParked(st, "gate");

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
  for (const ref of [`refs/heads/${branch}`, `refs/remotes/${ctx.config.git_remote}/${branch}`]) {
    const sha = await ctx.git.revParse(ctx.root, `${ref}^{commit}`);
    if (sha) return sha;
  }
  return null;
}

/** Decide the gate: the receipt (a rejection's milestone in handoff.md follows it on every route, O6). */
async function decideGate(ctx: Context, args: ParsedArgs, kind: "approve" | "reject") {
  const verb = `story ${kind}`;
  const d = delegation(ctx, args, verb);
  // §6 gate row, SK3: a step agent never decides a gate, delegated or not; a person in the worktree may
  if (ctx.unit && ctx.env.NORN_RUN)
    throw refuse(
      `${verb} from a step agent is refused: a gate is decided by the person, never a step agent (SK3)`,
      `gates are decided by the person, or by a supervisor in the main checkout (${ctx.root}); report this step's outcome instead`,
      "gate_by_agent",
    );
  const reason = d.reason;
  // B26 (B3): the agent sent back gets only what the reason says, so a rejection needs one
  if (kind === "reject" && !reason) throw usageError("story reject: the reason is required", 'pass --reason "what failed": norn story reject <unit> --reason "…"', "reason_required");
  const key = await targetKey(ctx, args.positionals[0], args.json === true, parkedOn("gate", verb, "Nothing waits at a gate", (k) => (kind === "reject" ? cmd.storyReject(k) : cmd.storyApprove(k))));
  // gh-195 B20: a `local` story held elsewhere: the step its last boundary led to, checked by the holder
  const t = await resolveTarget(ctx, key, atGate, { stepOnly: (t, step) => stepOnlyReceipt(ctx, t, step, kind, delegatedFields(d)) });
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
          nextCommand(t.key, st) ?? cmd.storyView(t.story),
          "not_at_gate",
        );
    },
    build: (t, st) =>
      humanReceipt(ctx, t, st, kind, { ...delegatedFields(d), ...(head ? { head_sha: head } : {}), ...(acknowledged.length ? { acknowledged_notes: acknowledged } : {}) }),
  });
  return out;
}

export const storyApproveCommand = defineCommand({
  name: "story approve",
  version: "acts",
  summary: "Approve the gate a unit waits at (B25, O2)",
  usage: 'norn story approve [<story|slice>] [--reason "…"] [--delegated]',
  optionHelp: { "--reason <text>": "a comment kept on the approve receipt", ...DELEGATED_HELP },
  options: { reason: { type: "string" }, ...DELEGATED_OPTION },
  positionals: { max: 1 },
  run: (ctx, args) => decideGate(ctx, args, "approve"),
});

export const storyRejectCommand = defineCommand({
  name: "story reject",
  version: "acts",
  summary: "Reject the gate a unit waits at, with the reason the next attempt gets (B26, O2)",
  usage: 'norn story reject [<story|slice>] --reason "…" [--delegated]',
  optionHelp: { "--reason <text>": "required: what failed; the agent sent back gets it", ...DELEGATED_HELP },
  options: { reason: { type: "string" }, ...DELEGATED_OPTION },
  positionals: { max: 1 },
  run: (ctx, args) => decideGate(ctx, args, "reject"),
});
