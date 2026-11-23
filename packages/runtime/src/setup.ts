/**
 * The worktree setup (`setup:` in the config): the command that readies a unit's worktree, such as
 * installing its dependencies, run before an agent or a check runs there. It runs once in a worktree
 * made new, and again whenever its digest (the command and the content of the files `inputs` names)
 * differs from the one recorded when it last succeeded.
 *
 * It is a gate in front of a launch, not a step: decide never sees it. While it runs, the launch
 * waits without writing its intent, so it spends no retry and no counter, and the next tick asks
 * again. A setup that failed parks the unit for a person with a `unit.parked` receipt the host writes
 * itself, as `norn run stop` does, under an id derived from the failed setup: once a person lifts the
 * park (`norn run rerun`), recording it again is a replay, and the setup runs again.
 *
 * It runs detached, as a check does (checks-detached.ts), so a long install never holds the tick; a
 * host that cannot detach runs it inside the tick.
 */
import { ok, type HostContext, hostProcesses, parseJson, type PluginResult } from "@norn/plugin-api";
import { deriveUlid, ulid } from "@norn/schema";
import { ensureWorktree } from "./branches.ts";
import { CheckExit, checkWrapperArgv } from "./checks-detached.ts";
import { encodeCheckHandle, readDetached, stopDetached } from "./detached.ts";
import type { TickContext } from "./env.ts";
import { unitInFacts } from "./record.ts";
import { readSetupRecord, type SetupRecord, setupExitPath, setupLogPath, setupPidPath, writeSetupRecord } from "./setup-record.ts";
import type { SetupConfig } from "./types.ts";
import { wakePath } from "./wake.ts";

/** The park of a unit whose worktree's setup failed: a person fixes the command or its files and reruns the step. */
export const SETUP_FAILED_PARK = "worktree.setup.failed";

/** How much of a setup's output the record keeps: the end, where an installer says what went wrong. */
export const SETUP_OUTPUT_TAIL = 4000;

/** Ready to run in, or why not yet: its setup runs (`setup`), or failed and parked the unit (`parked`). */
export type PreparedWorktree = { path: string; waiting?: "setup" | "parked" };

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function sha256(data: string | Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(data).digest("hex");
}

/** A `*` in one path segment as a pattern over a folder's names. */
function segmentPattern(segment: string): RegExp {
  return new RegExp(`^${segment.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
}

/**
 * A read that met a file where a folder was expected, or a folder where a file was: what a `*` matched
 * is not the kind of entry the input names. The files contract has no stat, so the error is the only sign.
 */
function wrongKind(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  return code === "ENOTDIR" || code === "EISDIR";
}

/** A folder's names, or none when the path is a file. */
async function namesIn(ctx: HostContext, dir: string): Promise<string[]> {
  try {
    return await ctx.files.list(dir);
  } catch (e) {
    if (wrongKind(e)) return [];
    throw e;
  }
}

/** Each input as the paths it names relative to the worktree: a literal path as it is, a `*` segment as the names that folder holds. */
async function expandInputs(ctx: HostContext, worktree: string, inputs: readonly string[]): Promise<{ literal: Set<string>; matched: Set<string> }> {
  const literal = new Set<string>();
  const matched = new Set<string>();
  for (const input of inputs) {
    const segments = input.split("/").filter((s) => s !== "" && s !== ".");
    if (!segments.some((s) => s.includes("*"))) {
      literal.add(segments.join("/"));
      continue;
    }
    let paths = [""];
    for (const segment of segments) {
      const next: string[] = [];
      for (const at of paths) {
        if (!segment.includes("*")) next.push(at ? `${at}/${segment}` : segment);
        else {
          const pattern = segmentPattern(segment);
          for (const name of await namesIn(ctx, at ? `${worktree}/${at}` : worktree)) if (pattern.test(name)) next.push(at ? `${at}/${name}` : name);
        }
      }
      paths = next;
    }
    for (const p of paths) matched.add(p);
  }
  return { literal, matched };
}

/** A file's bytes, or null when it is missing or is not a file, such as a folder a `*` matched. */
async function bytesOf(ctx: HostContext, path: string): Promise<Uint8Array | string | null> {
  try {
    return await (ctx.files.readBytes ? ctx.files.readBytes(path) : ctx.files.read(path));
  } catch (e) {
    if (wrongKind(e)) return null;
    throw e;
  }
}

/**
 * The setup's digest in `worktree`: sha256 over the command, then each input path in order with the
 * sha256 of its bytes. A literal path that is missing counts as missing, so making it changes the
 * digest, as does one that is a folder or sits under a file; a `*` that matches a folder, a path
 * under a file, or nothing adds nothing. With no inputs it is the command alone.
 */
export async function setupDigest(ctx: HostContext, setup: Pick<SetupConfig, "command" | "inputs">, worktree: string): Promise<string> {
  const { literal, matched } = await expandInputs(ctx, worktree, setup.inputs);
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(`${setup.command}\0`);
  for (const path of [...new Set([...literal, ...matched])].sort()) {
    const bytes = await bytesOf(ctx, `${worktree}/${path}`);
    if (bytes === null && !literal.has(path)) continue;
    hasher.update(`${path}\0${bytes === null ? "-" : sha256(bytes)}\0`);
  }
  return hasher.digest("hex");
}

/** 900000 → `15m`, as a config file spells it. */
function durationText(ms: number): string {
  for (const [unit, size] of [["h", 3_600_000], ["m", 60_000], ["s", 1000]] as const) if (ms % size === 0) return `${ms / size}${unit}`;
  return `${ms}ms`;
}

/** The last line the setup printed that says something, kept short for the park. */
function lastLine(output: string | undefined): string {
  const line = (output ?? "").split("\n").map((l) => l.trim()).filter((l) => l !== "").at(-1) ?? "";
  return line.length > 300 ? `${line.slice(0, 300)}…` : line;
}

/** What the person reads on the park: the command, how it ended, where, the log, and what it last said. */
export function setupParkText(r: SetupRecord): string {
  const said = lastLine(r.output);
  return `the worktree setup \`${r.command}\` ${r.reason ?? "failed"} in ${r.worktree} (log: ${r.log})${said ? `: ${said}` : ""}; fix setup.command or the files it reads, then rerun the step`;
}

async function logTail(ctx: HostContext, log: string): Promise<string> {
  return ((await ctx.files.read(log)) ?? "").slice(-SETUP_OUTPUT_TAIL);
}

function settled(r: SetupRecord, over: Partial<SetupRecord>): SetupRecord {
  const { handle: _h, ...rest } = r;
  return { ...rest, ...over };
}

/**
 * A running setup as it stands now: still running (null), or settled done or failed. A start cut short
 * before its process was made settles to nothing: no record, so the setup starts again.
 */
async function readRunning(t: TickContext, r: SetupRecord, digestNow: () => Promise<string>): Promise<SetupRecord | null | "running"> {
  const { ctx } = t.env;
  const now = ctx.now();
  const read = await readDetached(
    ctx,
    { ...(r.handle !== undefined && { handle: r.handle }), at: r.started_at, timeoutMs: r.timeout_ms, exitPath: setupExitPath(ctx, r.unit, r.id), pidPath: setupPidPath(ctx, r.unit, r.id) },
    now,
  );
  switch (read.kind) {
    case "starting":
    case "running":
      return "running";
    case "never_started":
      return null;
    case "exited": {
      const output = await logTail(ctx, r.log);
      const exit = parseJson(CheckExit, read.exitText, "setup exit");
      if (!exit.ok) return settled(r, { state: "failed", reason: `left an unreadable exit file (${exit.failure.message})`, output, finished_at: now });
      // the digest is taken again after a success, so a setup that rewrites one of its own inputs is not run twice
      if (exit.value.exit === 0) return settled(r, { state: "done", digest: await digestNow(), exit: 0, output, finished_at: exit.value.finished_at });
      return settled(r, { state: "failed", exit: exit.value.exit, reason: `exited ${exit.value.exit}`, output, finished_at: exit.value.finished_at });
    }
    case "timed_out":
      if (read.alive) await stopDetached(ctx, read.handle);
      return settled(r, { state: "failed", reason: `timed out after ${durationText(r.timeout_ms)}`, output: await logTail(ctx, r.log), finished_at: now });
    case "died":
      return settled(r, { state: "failed", reason: "ended without recording its exit", output: await logTail(ctx, r.log), finished_at: now });
  }
}

/** Run the setup inside the tick, on a host that cannot detach it, and settle its record. */
async function runInline(t: TickContext, r: SetupRecord, digestNow: () => Promise<string>): Promise<SetupRecord> {
  const { ctx } = t.env;
  try {
    const out = await ctx.exec(["sh", "-c", r.command], { cwd: r.worktree, timeoutMs: r.timeout_ms });
    const output = `${out.stdout}${out.stderr ? `\n${out.stderr}` : ""}`.slice(-SETUP_OUTPUT_TAIL);
    try {
      await ctx.files.write(r.log, output);
    } catch {
      // the record keeps the tail; the log is only for a person to read more
    }
    const finished_at = ctx.now();
    if (out.timedOut) return settled(r, { state: "failed", reason: `timed out after ${durationText(r.timeout_ms)}`, output, finished_at });
    if (out.code === 0) return settled(r, { state: "done", digest: await digestNow(), exit: 0, output, finished_at });
    return settled(r, { state: "failed", exit: out.code, reason: `exited ${out.code}`, output, finished_at });
  } catch (e) {
    return settled(r, { state: "failed", reason: `could not start: ${message(e)}`, finished_at: ctx.now() });
  }
}

/** Start the setup detached, its record written `running` before the spawn so a crash between the two leaves one a later tick reads. */
async function start(t: TickContext, unit: string, worktree: string, setup: SetupConfig, digest: string): Promise<SetupRecord | "running"> {
  const { ctx } = t.env;
  const id = ulid(Date.parse(ctx.now()));
  const record: SetupRecord = {
    unit,
    id,
    command: setup.command,
    digest,
    inputs: [...setup.inputs],
    worktree,
    state: "running",
    started_at: ctx.now(),
    timeout_ms: setup.timeoutMs,
    log: setupLogPath(ctx, unit, id),
  };
  await writeSetupRecord(ctx, record);
  const procs = hostProcesses(ctx);
  if (!procs.ok) return runInline(t, record, () => setupDigest(ctx, setup, worktree));
  try {
    const p = await procs.value.spawn(checkWrapperArgv(setup.command, setupExitPath(ctx, unit, id), wakePath(ctx)), { cwd: worktree, logPath: record.log });
    await writeSetupRecord(ctx, { ...record, handle: encodeCheckHandle(p.pid, p.started) });
    return "running";
  } catch (e) {
    return settled(record, { state: "failed", reason: `could not start: ${message(e)}`, finished_at: ctx.now() });
  }
}

/** Park the unit on a failed setup; true when this call parked it, false when the park was already recorded (and since lifted). */
async function park(t: TickContext, unit: string, r: SetupRecord): Promise<PluginResult<boolean>> {
  const state = unitInFacts(t.facts, unit)?.state;
  const parked = await t.env.journal.record(unit, {
    id: deriveUlid(r.id, 1),
    data: { kind: "unit.parked", reason: SETUP_FAILED_PARK, text: setupParkText(r), ...(state && { step: state.step, attempt: state.attempt }) },
  });
  return parked.ok ? ok(!parked.value.replayed) : parked;
}

/** The gate: whether the worktree's setup is done for its digest now, starting or reading it when not. */
async function gate(t: TickContext, unit: string, worktree: string, setup: SetupConfig): Promise<PluginResult<PreparedWorktree>> {
  const { ctx } = t.env;
  const digestNow = () => setupDigest(ctx, setup, worktree);
  let r = await readSetupRecord(ctx, unit);
  if (r?.state === "running") {
    const read = await readRunning(t, r, digestNow);
    if (read === "running") return ok({ path: worktree, waiting: "setup" });
    r = read;
    if (r) await writeSetupRecord(ctx, r);
  }
  // at most twice: a setup that settles inside this call (inline, or a spawn that failed) is judged at once
  for (let pass = 0; pass < 2; pass++) {
    const digest = await digestNow();
    if (r?.state === "done" && r.digest === digest) return ok({ path: worktree });
    if (r?.state === "failed" && r.digest === digest) {
      const parked = await park(t, unit, r);
      if (!parked.ok) return parked;
      if (parked.value) return ok({ path: worktree, waiting: "parked" });
      // the park was recorded before and a person lifted it: the setup runs again
    }
    // a setup run in this call that settled for another digest (it rewrote an input, then failed) is not
    // ready: the next tick starts it again for the digest the worktree has now
    if (pass === 1) return ok({ path: worktree, waiting: "setup" });
    const begun = await start(t, unit, worktree, setup, digest);
    if (begun === "running") return ok({ path: worktree, waiting: "setup" });
    r = begun;
    await writeSetupRecord(ctx, r);
  }
  return ok({ path: worktree, waiting: "setup" });
}

/**
 * The unit's worktree, made when missing, and whether it is ready to run in: with no setup configured,
 * or a vcs without worktrees, it always is.
 */
export async function prepareWorktree(t: TickContext, unit: string): Promise<PluginResult<PreparedWorktree>> {
  const worktree = await ensureWorktree(t.env, unit);
  if (!worktree.ok) return worktree;
  const setup = t.env.config.setup;
  if (!setup || !t.env.slots.vcs.capabilities.worktrees) return ok({ path: worktree.value });
  return gate(t, unit, worktree.value, setup);
}
