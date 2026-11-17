/**
 * Every herdr command goes through here: the binary and session prefix, the JSON herdr answers on
 * stdout, and its errors (JSON on stderr, exit 1) as PluginFailures. Through `ctx.exec` only, so the
 * runner is tested over `scriptedExec` with no herdr running.
 */
import { type ExecOutput, fail, type HostContext, ok, type PluginFailureCode, type PluginResult, parseJson } from "@norn/plugin-api";
import { type Static, type TSchema, Type } from "@sinclair/typebox";
import { DEFAULT_HERDR_BIN, type HerdrConfig } from "./config.ts";

/** argv prefix of every herdr command: the binary and its session. */
export function herdrBase(config: HerdrConfig): string[] {
  return [config.bin ?? DEFAULT_HERDR_BIN, ...(config.session ? ["--session", config.session] : [])];
}

/** A herdr command's stdout, or its failure as a PluginFailure. */
export type HerdrCall = (args: string[]) => Promise<PluginResult<string>>;

/** What a shell gives for a command it cannot find or run. */
const NOT_RUNNABLE = 127;
/** herdr's exit for a command line it cannot parse: our argv is wrong, never herdr's state. */
const SYNTAX_ERROR = 2;
/** A hung herdr server must not hang the tick. */
const CALL_TIMEOUT_MS = 15_000;

/** herdr error codes that say the thing addressed is not there (closed, or never was). */
const GONE = new Set(["pane_not_found", "tab_not_found", "workspace_not_found", "agent_not_found"]);

const HerdrError = Type.Object({ error: Type.Object({ code: Type.String(), message: Type.Optional(Type.String()) }) });

/** The herdr error code of a failed call, for the runner to tell "gone" from a real failure. */
export function herdrErrorCode(message: string): string | null {
  return /\[herdr:([a-z_]+)\]/.exec(message)?.[1] ?? null;
}

function herdrError(out: ExecOutput): { code: string; message?: string } | null {
  for (const text of [out.stderr, out.stdout]) {
    const r = text.trim() === "" ? null : parseJson(HerdrError, text, "herdr error");
    if (r?.ok) return r.value.error;
  }
  return null;
}

export function herdrCaller(ctx: HostContext, config: HerdrConfig): HerdrCall {
  const base = herdrBase(config);
  return async (args) => {
    const what = `herdr ${args.slice(0, 2).join(" ")}`;
    let r: ExecOutput;
    try {
      r = await ctx.exec([...base, ...args], { timeoutMs: CALL_TIMEOUT_MS });
    } catch (e) {
      return fail("unavailable", `${what}: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (r.timedOut) return fail("unavailable", `${what}: no answer within ${CALL_TIMEOUT_MS / 1000}s`);
    if (r.code === NOT_RUNNABLE) return fail("unavailable", `herdr is not runnable (${base[0]}): ${r.stderr.trim() || "not found"}`, false);
    if (r.code === SYNTAX_ERROR) return fail("invalid", `${what}: herdr refused the command line: ${r.stderr.trim()}`, false);
    if (r.code !== 0) {
      const err = herdrError(r);
      // an error herdr did not answer in JSON means no server answered at all
      if (!err) return fail("unavailable", `${what}: ${r.stderr.trim() || `exit ${r.code}`}`);
      const code: PluginFailureCode = GONE.has(err.code) ? "not_found" : err.code === "timeout" ? "unavailable" : "unknown";
      // the herdr code rides in the message, as PluginFailure has no field for a provider's own code
      return fail(code, `${what}: ${err.message ?? err.code} [herdr:${err.code}]`);
    }
    return ok(r.stdout);
  };
}

/** A herdr command whose stdout is JSON of the given shape. */
export async function herdrJson<S extends TSchema>(herdr: HerdrCall, args: string[], schema: S): Promise<PluginResult<Static<S>>> {
  const out = await herdr(args);
  return out.ok ? parseJson(schema, out.value, `herdr ${args.slice(0, 2).join(" ")}`) : out;
}

/** Join argv into one POSIX command line, for `pane run`, which a shell in the pane reads. */
export function shellJoin(argv: readonly string[]): string {
  return argv.map((w) => (w !== "" && /^[A-Za-z0-9_@%+=:,./-]+$/.test(w) ? w : `'${w.replace(/'/g, `'\\''`)}'`)).join(" ");
}
