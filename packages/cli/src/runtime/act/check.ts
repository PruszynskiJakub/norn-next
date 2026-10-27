/** act: run a check step's command (W2, C5). */
import { type Action, type ActionResult } from "@norn/core";
import { type ReceiptOf, ulid } from "@norn/schema";
import { acquireRunLease, appendReceipt, readEnvNorn, releaseLease, writeLog } from "@norn/store";
import { runShell, tailLines } from "../shell.ts";
import { stopStrayListeners } from "../strays.ts";
import { type ActEnv, QueueFull } from "./env.ts";

/** W2/C5: run the command in the worktree with `.env.norn`; write the check receipt after. */
export async function runCheck(act: ActEnv, a: Extract<Action, { kind: "run_check" }>): Promise<ActionResult> {
  const loc = act.unitLoc(a.unit);
  const attempt = loc.state?.attempt;
  if (!attempt) throw new Error(`${a.unit.key} has no state`);
  const lease = await acquireRunLease(act.ctx.home, "check", act.config.max_checks, {
    repo: act.root,
    story: a.unit.story,
    slice: a.unit.slice,
    run_id: a.run_id,
    now: act.nowIso(),
    liveness: act.liveness(),
  });
  if (!lease.ok) throw new QueueFull(`queued: max_checks ${act.config.max_checks} in use (K1)`);
  try {
    const env = { ...process.env, ...act.ctx.env, ...(readEnvNorn(a.cwd) ?? {}), ...a.env, NORN_HOME: act.root };
    // K4.1: a server an agent left running from this worktree must not hold the slot's ports
    const portBase = Number((env as Record<string, string | undefined>).PORT_BASE);
    const stopped = Number.isInteger(portBase) && portBase > 0
      ? await stopStrayListeners(a.cwd, { from: portBase, to: portBase + act.config.slots.ports_per_slot - 1 })
      : [];
    const res = await runShell(a.command, { cwd: a.cwd, env, timeoutMs: a.timeout_ms });
    if (stopped.length) res.output = `${stopped.map((s) => `norn: stopped pid ${s.pid} (${s.command}) left listening on :${s.port} from this worktree (K4.1)`).join("\n")}\n${res.output}`;
    const pass = !res.timed_out && res.exit_code === 0;
    const receipt: ReceiptOf<"check"> = {
      kind: "check",
      receipt_id: ulid(act.ctx.clock.now()),
      run_id: a.run_id,
      step: a.step,
      attempt,
      at: act.nowIso(),
      by: "norn",
      who: act.obs.facts.machine.holder,
      tick_id: act.tick,
      outcome: pass ? "pass" : "fail",
      command: a.command,
      exit_code: res.exit_code,
      duration_ms: res.duration_ms,
      output_tail: tailLines(res.output, 200),
      ...(res.timed_out ? { reason: "timeout" as const } : {}),
    };
    if (!pass) receipt.log = writeLog(loc.runsDir, a.run_id, res.output);
    const written = appendReceipt(loc.runsDir, receipt);
    return { ok: true, detail: { outcome: receipt.outcome, exit_code: res.exit_code, duration_ms: res.duration_ms, receipt: written.n, ...(receipt.log ? { log: receipt.log } : {}) } };
  } finally {
    releaseLease(act.ctx.home, lease.entry.file);
  }
}
