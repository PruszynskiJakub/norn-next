/**
 * `norn run cancel [<unit>]` (B51–B53, D4): stop a unit's running agent session without cancelling
 * the story. A `stuck` receipt by the person (reason `cancelled by person`) is written first, then
 * the session is killed through the runner (P6); the next tick parks the unit under Unblock and does
 * not restart it. Commits, the worktree, the branch, the claim and the pane stay; `norn run rerun`
 * resumes the step. Only the claim holder cancels: the session runs on its machine.
 */
import { cmd, type SessionRef } from "@norn/core";
import type { UnitState } from "@norn/schema";
import { machineHolder } from "@norn/store";
import { defineCommand } from "../command.ts";
import { failure, refuse } from "../output.ts";
import { at, claimFor, humanReceipt, resolveTarget as resolveUnit, runHumanVerb, started } from "../runtime/human.ts";
import { inState, resolveTarget } from "../runtime/target.ts";

const CANCEL_REASON = "cancelled by person";

export const runCancelCommand = defineCommand({
  name: "run cancel",
  summary: "Stop a unit's running agent session; the story and its work stay (rerun resumes it)",
  usage: "norn run cancel [<unit>]",
  positionals: { max: 1 },
  async run(ctx, args) {
    const key = await resolveTarget(ctx, args.positionals[0], args.json === true, inState("run cancel", (k) => cmd.runCancel(k), "Nothing is running", (u) => u.status === "running"));
    const t = await resolveUnit(ctx, key, (st) => st.status === "running");
    started(t);
    // B53: the session runs on the claim holder's machine; this checkout's copy may be stale (T9)
    const claim = await claimFor(ctx, t.story);
    const notHolder = () => {
      const who = claim.state === "other" ? `held by ${claim.blob.holder}` : "not held by this checkout";
      return refuse(`${t.story}'s claim is ${who}; only the claim holder stops its runs`, cmd.storyCheckout(t.story), "not_holder");
    };
    if (claim.state === "other") throw notHolder();
    const done = await runHumanVerb(ctx, t, {
      verb: "run cancel",
      mailbox: false,
      claim,
      check(t, st) {
        if (st.status !== "running" || !st.run) throw refuse(`${t.key} has no running agent: it is at ${at(st)}`, cmd.status(t.story), "nothing_to_cancel");
        if (claim.state !== "mine" || !t.runsDir) throw notHolder();
      },
      build: (t, st) => humanReceipt(ctx, t, st, "stuck", { reason: CANCEL_REASON }),
    });
    // P6: the receipt is written; now stop the session (what kill means is the runner's)
    const session = sessionOf(t.state as UnitState);
    let killed = false;
    if (session && (!t.state?.run?.machine || t.state.run.machine === machineHolder(ctx.env))) {
      const runner = (await ctx.ports()).runner;
      if (runner && runner.name === session.runner) {
        try {
          await runner.kill(session);
          killed = true;
        } catch (e) {
          throw failure(`${t.key}: cancel recorded, but the session was not stopped: ${(e as Error).message}`, "stop the agent by hand; the next tick will not restart it", "kill_failed");
        }
      }
    }
    return { ...done, killed, next: cmd.runRerun(t.key) };
  },
});

/** The live run's session, as the runner addresses it (R7.2: only a run started on this machine). */
function sessionOf(st: UnitState): SessionRef | null {
  const s = st.run?.session;
  if (!s) return null;
  return { runner: s.runner, session_id: s.session_id, ...(s.pane_id ? { pane_id: s.pane_id } : {}), ...(st.run?.process ? { process: st.run.process } : {}) };
}
