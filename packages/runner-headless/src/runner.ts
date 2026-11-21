/**
 * The headless runner: the agent as a detached process through `ctx.spawn`, output to the request's
 * log, nobody watching. Nothing to type into, so `send` is refused and the launcher queues the text
 * for the next hook answer instead.
 *
 * `start` is idempotent by key: the key's record (`<dataDir>/runners/headless/<key>.json`, made with
 * `ctx.files.create`) names the process a first start made, and a replay hands back that handle,
 * alive or not, rather than starting a second agent: a key is one run, and a run that died is for
 * the host to see as died, never to restart under the same key. The window between the spawn and
 * the record stays open: a crash exactly there starts the agent again on replay.
 */
import { fail, type HostContext, type HostProcesses, ok, parseJson, type PluginResult, type Runner, type RunnerCapabilities } from "@norn/plugin-api";
import { Type } from "@sinclair/typebox";
import { DEFAULT_KILL_GRACE_MS, type HeadlessConfig } from "./config.ts";
import { decodeHandle, encodeHandle } from "./handle.ts";

export const RUNNER_NAME = "headless";

export const HEADLESS_CAPABILITIES: RunnerCapabilities = Object.freeze({ attended: false, headless: true, paneInput: false });

/** Where a key's record lives: the handle a start under that key made. */
export function keyRecordPath(ctx: HostContext, key: string): string {
  return `${ctx.repo.dataDir}/runners/headless/${key}.json`;
}

/** A key becomes a file name, so it may not climb out of the runner's folder. */
const SAFE_KEY = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

const KeyRecord = Type.Object({ key: Type.String(), handle: Type.String() }, { additionalProperties: false });

/** How often `stop` looks whether TERM ended the process before it sends KILL. */
const STOP_POLL_MS = 100;

export interface HeadlessDeps {
  /** waits between stop's looks; a test passes one that returns at once */
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const notHandle = (handle: string) => fail<never>("invalid", `headless runner: ${JSON.stringify(handle)} is not a headless handle`, false);

export function createHeadlessRunner(ctx: HostContext, procs: HostProcesses, config: HeadlessConfig, deps: HeadlessDeps = {}): Runner {
  const graceMs = config.kill_grace_ms ?? DEFAULT_KILL_GRACE_MS;
  const sleep = deps.sleep ?? realSleep;

  async function readRecord(path: string): Promise<PluginResult<string | null>> {
    let text: string | null;
    try {
      text = await ctx.files.read(path);
    } catch (e) {
      return fail("unavailable", `headless runner: cannot read ${path}: ${message(e)}`);
    }
    if (text === null) return ok(null);
    const rec = parseJson(KeyRecord, text, path);
    // a record no start wrote is never guessed at: starting over could put a second agent on the run
    if (!rec.ok || decodeHandle(rec.value.handle) === null) return fail("invalid", `headless runner: ${path} is not a key record; remove it to start the run again`, false);
    return ok(rec.value.handle);
  }

  /**
   * TERM to the group, then KILL to the group once the leader ends or outlives the grace: a child
   * that ignores TERM lives on after its leader, and a group id is not handed out again while any
   * member lives, so the KILL reaches only what is left of this run. A leader already gone still has
   * its group killed: an agent exits once its turn ends, and a child it left in the background could
   * otherwise write after the check that stopped it. Nothing is sent when another process holds the
   * pid: the id may be someone else's by now. What is left unguarded is a pid handed to a new group
   * leader that itself exited while its members run on, which the group id cannot tell apart.
   */
  async function stopHandle(handle: string): Promise<void> {
    const h = decodeHandle(handle);
    if (!h) return;
    if (!(await procs.alive(h.pid, h.started))) {
      if (!(await procs.alive(h.pid))) await procs.kill(h.pid, "KILL");
      return;
    }
    await procs.kill(h.pid, "TERM");
    for (let waited = 0; waited < graceMs; waited += STOP_POLL_MS) {
      await sleep(STOP_POLL_MS);
      if (!(await procs.alive(h.pid, h.started))) break;
    }
    await procs.kill(h.pid, "KILL");
  }

  return {
    name: RUNNER_NAME,
    capabilities: HEADLESS_CAPABILITIES,

    async start(req) {
      if (!SAFE_KEY.test(req.key)) return fail("invalid", `headless runner: key ${JSON.stringify(req.key)} is not a safe file name`, false);
      if (req.argv.length === 0) return fail("invalid", "headless runner: nothing to start (empty argv)", false);
      const path = keyRecordPath(ctx, req.key);
      const known = await readRecord(path);
      if (!known.ok) return known;
      if (known.value !== null) return ok({ handle: known.value });

      let handle: string;
      try {
        handle = encodeHandle(await procs.spawn(req.argv, { cwd: req.cwd, env: req.env, logPath: req.logPath }));
      } catch (e) {
        return fail("unavailable", `headless runner: cannot start ${req.argv[0]}: ${message(e)}`);
      }
      let made: boolean;
      try {
        made = await ctx.files.create(path, `${JSON.stringify({ key: req.key, handle })}\n`);
      } catch (e) {
        // unrecorded, the process could never be found again by its key: end it rather than leave it running
        await stopHandle(handle).catch(() => undefined);
        return fail("unavailable", `headless runner: cannot record ${path}: ${message(e)}`);
      }
      if (made) return ok({ handle });
      // another start under the same key recorded first: theirs is the run's process, ours goes
      await stopHandle(handle).catch(() => undefined);
      const theirs = await readRecord(path);
      if (!theirs.ok) return theirs;
      return theirs.value === null ? fail("conflict", `headless runner: ${path} vanished during start`) : ok({ handle: theirs.value });
    },

    async alive(handle) {
      const h = decodeHandle(handle);
      if (!h) return notHandle(handle);
      try {
        return ok(await procs.alive(h.pid, h.started));
      } catch (e) {
        return fail("unavailable", `headless runner: cannot probe pid ${h.pid}: ${message(e)}`);
      }
    },

    send: async () => fail("invalid", "a headless run has no pane to type into", false),

    async stop(handle) {
      if (!decodeHandle(handle)) return notHandle(handle);
      try {
        await stopHandle(handle);
        return ok(undefined);
      } catch (e) {
        return fail("unavailable", `headless runner: cannot stop ${handle}: ${message(e)}`);
      }
    },
  };
}
