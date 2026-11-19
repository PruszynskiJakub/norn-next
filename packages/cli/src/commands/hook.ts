/**
 * `norn hook <harness> <hook>`: answer a harness hook: the payload on stdin, the harness's reply on stdout.
 * Prints the harness's native reply and exits with its code; never a CliError, as a hook must always answer.
 */
import { type Harness, parseJson, RUN_ENV } from "@norn/plugin-api";
import { claimHeldElsewhere, failedHookReply, type IngestInput, ingestHook } from "@norn/runtime";
import { Type } from "@sinclair/typebox";
import { defineCommand } from "../command.ts";
import type { CliContext } from "../context.ts";
import { raw } from "../output.ts";
import { BUNDLED_PLUGINS } from "../plugins/bundled.ts";

/** Every harness the configured plugins provide, by the name a hook command spells. */
async function harnessesOf(ctx: CliContext): Promise<Record<string, Harness>> {
  const out: Record<string, Harness> = {};
  for (const p of (await ctx.plugins()).plugins) for (const [name, h] of Object.entries(p.provides.harness ?? {})) out[name] ??= h;
  return out;
}

/**
 * The harness a hook names when the configured plugins cannot be had: a bundled one needs no config,
 * and an installed one counts only if the plugins did load.
 */
async function fallbackHarness(ctx: CliContext, name: string): Promise<Harness | undefined> {
  const bundled = BUNDLED_PLUGINS.find((p) => p.provides.harness?.[name])?.provides.harness?.[name];
  if (bundled) return bundled;
  try {
    return (await harnessesOf(ctx))[name];
  } catch {
    return undefined;
  }
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

async function payloadOf(ctx: CliContext): Promise<unknown> {
  let text = "";
  try {
    text = await ctx.io.stdin();
  } catch (e) {
    ctx.note(`norn hook: stdin: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
  if (!text.trim()) return null;
  const parsed = parseJson(Type.Unknown(), text, "hook payload");
  if (parsed.ok) return parsed.value;
  ctx.note(`norn hook: ${parsed.failure.message}`);
  return null;
}

/** Roots outside the worktree an agent's write may land in: the temp folders. */
function writableRoots(env: Readonly<Record<string, string | undefined>>): string[] {
  return [...new Set([env.TMPDIR?.replace(/\/+$/, ""), "/tmp", "/private/tmp"].filter((x): x is string => Boolean(x)))];
}

/** More words than any hook line has: past it the line is not a hook's at all. */
const MAX_HOOK_ARGS = 16;

/** norn failed before its guard could run: an empty reply would let a write through, as a harness reads it as allow. */
async function failedBeforeGuard(ctx: CliContext, input: IngestInput, problem: string) {
  ctx.note(problem);
  const h = input.harness ? await fallbackHarness(ctx, input.harness) : undefined;
  if (!h || !input.hook) return raw("", 0);
  const reply = failedHookReply(h, input, problem, new Date().toISOString());
  return raw(reply.stdout, reply.exit_code);
}

export const hookCommand = defineCommand({
  name: "hook",
  summary: "Answer a harness hook: the payload on stdin, the harness's reply on stdout",
  usage: "norn hook <harness> <hook>",
  // the count is checked here, not by the parser: a refused line would answer nothing, which lets a write through
  positionals: { min: 0, max: MAX_HOOK_ARGS },
  answersRaw: true,
  async run(ctx, args) {
    const words = args.positionals;
    const harness = words[0] ?? "";
    // the hook's name is last on the line: a hook line that names the harness twice still says which hook it is
    const hook = words.length >= 2 ? (words.at(-1) as string) : "";
    const payload = await payloadOf(ctx);
    // a session norn did not launch is not norn's to answer, and must not need a config to be let through
    if (!ctx.env[RUN_ENV.unit] || !ctx.env[RUN_ENV.run]) return raw("", 0);
    const input = { harness, hook, payload, env: { ...ctx.env } };
    if (words.length !== 2) return failedBeforeGuard(ctx, input, `norn hook: expected <harness> <hook>, got ${words.length} argument(s)`);
    let r: Awaited<ReturnType<typeof ingestHook>>;
    try {
      const env = await ctx.runtimeEnv();
      r = await ingestHook(
        {
          ctx: env.ctx,
          harnesses: await harnessesOf(ctx),
          journal: env.journal,
          worktreeOf: (unit) => env.slots.vcs.worktree.path(unit),
          writableRoots: writableRoots(ctx.env),
          claimMoved: async (unit) => (await claimHeldElsewhere(env, unit)) !== null,
        },
        input,
      );
    } catch (e) {
      return failedBeforeGuard(ctx, input, `norn hook: ${errorText(e)}`);
    }
    for (const p of r.problems) ctx.note(`norn hook: ${p}`);
    const log = ctx.io.log;
    return raw(r.reply.stdout, r.reply.exit_code, async () => {
      const before = r.problems.length;
      await r.delivered();
      for (const p of r.problems.slice(before)) log?.(`norn hook: ${p}`);
    });
  },
});
