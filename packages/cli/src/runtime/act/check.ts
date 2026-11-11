/**
 * act: start a check step's command without holding the tick.
 *
 * The tick takes the unit's `check` run lease, writes a check order to `~/.norn/checks/<run_id>.json`
 * and starts a detached `norn check-run <run_id>`, then hands the lease to that process. It runs the
 * command, writes the `check` receipt and releases the lease; while it lives, decide sees the lease
 * and waits (`check.running`), and the tick after it ends applies the receipt. The process also takes
 * the lease over itself as it starts, so one the tick could not identify still holds it. One that dies
 * leaves a dead lease: it is reclaimed and the check runs again.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { type Action, type ActionResult, checkOutcome } from "@norn/core";
import { assertValid, type CheckOrder, type ReceiptOf, ulid } from "@norn/schema";
import {
  acquireRunLease,
  appendReceipt,
  atomicWriteJson,
  checkOrderPath,
  checkOrdersDir,
  claimRunLease,
  handOverLease,
  listLeases,
  localProcess,
  noteSpawn,
  readEnvNorn,
  readJsonFile,
  releaseLease,
  releaseRunLease,
  safeUnlink,
  spawnDetached,
  writeLog,
} from "@norn/store";
import { nornEntry } from "../shim.ts";
import { runShell, type ShellResult, tailLines } from "../shell.ts";
import { slotPorts, stopStrayListeners } from "../strays.ts";
import { type ActEnv, QueueFull } from "./env.ts";

/** Start the command in the worktree with `.env.norn`; `norn check-run` writes the check receipt. */
export async function runCheck(act: ActEnv, a: Extract<Action, { kind: "run_check" }>): Promise<ActionResult> {
  const loc = act.unitLoc(a.unit);
  const attempt = loc.state?.attempt;
  if (!attempt) throw new Error(`${a.unit.key} has no state`);
  const lease = await acquireRunLease(act.ctx.home, "check", act.config.max_agents, {
    repo: act.root,
    story: a.unit.story,
    slice: a.unit.slice,
    run_id: a.run_id,
    now: act.nowIso(),
    liveness: act.liveness(),
  });
  if (!lease.ok) throw new QueueFull(`queued: max_agents ${act.config.max_agents} in use`);
  await sweepCheckOrders(act);
  // the process env is inherited by `norn check-run`, not written: the order holds only `.env.norn`, the step env and NORN_HOME
  const env = definedOnly({ ...(readEnvNorn(a.cwd) ?? {}), ...a.env, NORN_HOME: act.root });
  const order: CheckOrder = {
    version: 1,
    home: act.ctx.home,
    lease_file: lease.entry.file,
    runs_dir: loc.runsDir,
    run_id: a.run_id,
    step: a.step,
    attempt,
    tick_id: act.tick,
    who: act.obs.facts.machine.holder,
    command: a.command,
    cwd: a.cwd,
    env,
    timeout_ms: a.timeout_ms,
    ...(a.exits ? { exits: a.exits } : {}),
    ports: slotPorts({ ...act.ctx.env, ...env }.PORT_BASE),
  };
  const path = checkOrderPath(act.ctx.home, a.run_id);
  let started = false;
  try {
    assertValid("check-order", order);
    atomicWriteJson(path, order, 0o600);
    const [cmd, ...args] = nornEntry();
    noteSpawn(["norn", "check-run", a.run_id], a.cwd); // recorded for effect transcripts (the logical argv)
    const child = spawnDetached([cmd!, ...args, "check-run", a.run_id], { cwd: a.cwd, env: { ...process.env, ...act.ctx.env } });
    const pid: number | undefined = child.pid;
    started = true;
    const exited = child.exited;
    act.ctx.deps.onCheckStarted?.(exited);
    // The lease lives as long as `norn check-run` does. It takes the lease over itself as it starts;
    // handing it over here only closes the gap before that. An unidentified pid (a failed probe) leaves
    // the tick's lease for it to take, and one it already released stays released.
    const holder = pid ? await act.obs.ports.process.identify(pid).catch(() => null) : null;
    if (holder) handOverLease(act.ctx.home, lease.entry.file, lease.entry.lease, { ...lease.entry.lease, holder });
    return { ok: true, detail: { started: true, pid: pid ?? null } };
  } catch (e) {
    if (!started) {
      safeUnlink(path);
      releaseLease(act.ctx.home, lease.entry.file);
    }
    throw e;
  }
}

/** The order runCheck wrote for a run, or null when it is missing or invalid. */
export function readCheckOrder(home: string, runId: string): CheckOrder | null {
  const r = readJsonFile("check-order", checkOrderPath(home, runId));
  return r.ok ? r.value : null;
}

/** `norn check-run`: run the order's command (timeout kills the group), write the receipt, release the lease. */
export async function runCheckOrder(order: CheckOrder, now: () => number): Promise<ReceiptOf<"check">> {
  const started = now();
  claimRunLease(order.home, order.lease_file, order.run_id, localProcess.self()); // The lease dies with this process
  const receipt = (res: ShellResult): ReceiptOf<"check"> => {
    return {
      kind: "check",
      receipt_id: ulid(now()),
      run_id: order.run_id,
      step: order.step,
      attempt: order.attempt,
      at: new Date(now()).toISOString(),
      by: "norn",
      who: order.who,
      tick_id: order.tick_id,
      outcome: checkOutcome(order.exits, res),
      command: order.command,
      exit_code: res.exit_code,
      duration_ms: res.duration_ms,
      output_tail: tailLines(res.output, 200),
      ...(res.timed_out ? { reason: "timeout" as const } : {}),
    };
  };
  try {
    // A server an agent left running from this worktree must not hold the slot's ports
    const stopped = order.ports ? await stopStrayListeners(order.cwd, order.ports) : [];
    const res = await runShell(order.command, { cwd: order.cwd, env: { ...process.env, ...order.env }, timeoutMs: order.timeout_ms });
    if (stopped.length) res.output = `${stopped.map((s) => `norn: stopped pid ${s.pid} (${s.command}) left listening on :${s.port} from this worktree`).join("\n")}\n${res.output}`;
    const r = receipt(res);
    if (r.outcome !== "pass") r.log = writeLog(order.runs_dir, order.run_id, res.output);
    appendReceipt(order.runs_dir, r);
    return r;
  } catch (e) {
    // A check-run that breaks on its own side still ends the step, or every tick would start it again
    const r = receipt({ exit_code: null, output: `norn check-run failed: ${(e as Error).message}`, duration_ms: now() - started, timed_out: false });
    appendReceipt(order.runs_dir, r);
    return r;
  } finally {
    safeUnlink(checkOrderPath(order.home, order.run_id));
    releaseRunLease(order.home, order.lease_file, order.run_id); // one reclaimed meanwhile may be another run's now
  }
}

/** Remove orders no live check lease names: a `norn check-run` that died (crash, reboot) left them. */
async function sweepCheckOrders(act: ActEnv): Promise<void> {
  const leases = (await listLeases(act.ctx.home, act.liveness())).live.map((e) => e.lease);
  const live = new Set(leases.flatMap((l) => (l.kind === "check" && l.run_id ? [l.run_id] : [])));
  const dir = checkOrdersDir(act.ctx.home);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return; // no orders yet
  }
  for (const name of names) if (name.endsWith(".json") && !live.has(name.slice(0, -".json".length))) safeUnlink(join(dir, name));
}

/** What the tick adds to a check's env, as the order stores it: unset names left out. */
function definedOnly(env: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter((e): e is [string, string] => e[1] !== undefined));
}
