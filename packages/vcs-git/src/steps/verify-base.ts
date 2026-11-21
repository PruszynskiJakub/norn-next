/**
 * `verify-base`: after the base moves under a story waiting on its change, test the merge of the base
 * into the story head again. A base move without a conflict can still break the merged tree (a rename
 * on the base the story's new code still calls), and nothing else would notice before the merge.
 *
 * Polled every tick: `waiting` while the story holds the base, while the base merges into it only
 * with a conflict (the workflow's stale route takes that), or once this (head, base) pair has been
 * tested; `verified` when the merged tree passes, `broken` when it fails. The merge is made in a
 * throwaway detached worktree and never committed, so the story branch and its change stay as they were.
 */
import { fail, type HostContext, ok, parseJson, type PluginResult, type StepKindDefinition, type StepKindInput, type StepKindOutcome } from "@norn/plugin-api";
import { type Static, Type } from "@sinclair/typebox";
import { git, gitFailure } from "../git.ts";
import { fetchRemote } from "../push.ts";
import { isAncestor, revParse, unmergedPaths } from "../refs.ts";
import { GitStepKeys, resolveBase, stepPlace } from "./common.ts";

export const DEFAULT_VERIFY_TIMEOUT_MS = 15 * 60_000;
/** The tail of the command's output kept with `broken`: where a failure is, never the whole log. */
const OUTPUT_TAIL_LINES = 100;

export const VerifyBaseConfig = Type.Object(
  {
    /** the shell command that tests the merged tree; exit 0 is green */
    command: Type.String({ minLength: 1 }),
    /** how long the command may run before it counts as red */
    timeout_ms: Type.Optional(Type.Integer({ minimum: 1 })),
    ...GitStepKeys,
  },
  { additionalProperties: false },
);
export type VerifyBaseConfig = Static<typeof VerifyBaseConfig>;

/** The newest pair tested, so one base move is tested once however many ticks poll it. */
const Tested = Type.Object({ head: Type.String(), base: Type.String(), outcome: Type.String() });
type Tested = Static<typeof Tested>;

const unitFile = (unit: string) => unit.replace("/", "-");
const testedPath = (ctx: HostContext, unit: string) => `${ctx.repo.dataDir}/verify-base/${unitFile(unit)}.json`;
const scratchPath = (ctx: HostContext, unit: string) => `${ctx.repo.dataDir}/worktrees/.verify-${unitFile(unit)}`;

async function readTested(ctx: HostContext, unit: string): Promise<Tested | null> {
  let text: string | null;
  try {
    text = await ctx.files.read(testedPath(ctx, unit));
  } catch {
    return null;
  }
  if (text === null) return null;
  // a file in any other shape is only a lost cache: the pair is tested again
  const v = parseJson(Tested, text, "verify-base tested pair");
  return v.ok ? v.value : null;
}

async function writeTested(ctx: HostContext, unit: string, t: Tested): Promise<PluginResult<void>> {
  try {
    await ctx.files.write(testedPath(ctx, unit), `${JSON.stringify(t)}\n`);
    return ok(undefined);
  } catch (e) {
    return fail("unknown", `verify-base: cannot record the tested pair: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Remove the scratch worktree, a leftover of a run cut short included. */
async function dropScratch(ctx: HostContext, path: string): Promise<void> {
  await git(ctx, ctx.repo.root, ["worktree", "remove", "--force", "--force", path]);
  await git(ctx, ctx.repo.root, ["worktree", "prune"]);
}

type Tried = { outcome: "verified" | "broken"; exit: number; timed_out: boolean; output: string } | { outcome: "conflict"; files: string[] };

/** Merge `base` into `head` in the scratch worktree without committing, and run the command on the result. */
async function tryMerged(ctx: HostContext, scratch: string, head: string, base: string, cfg: VerifyBaseConfig): Promise<PluginResult<Tried>> {
  const added = await git(ctx, ctx.repo.root, ["worktree", "add", "--detach", "--quiet", scratch, head]);
  if (added.code !== 0) return gitFailure(added, "worktree add");
  const merge = await git(ctx, scratch, ["merge", "--no-ff", "--no-commit", "--quiet", base]);
  if (merge.code !== 0) {
    const files = await unmergedPaths(ctx, scratch);
    if (!files.ok) return files;
    if (files.value.length === 0) return gitFailure(merge, `merge ${base}`);
    return ok({ outcome: "conflict", files: files.value });
  }
  const out = await ctx.exec(["sh", "-c", cfg.command], { cwd: scratch, timeoutMs: cfg.timeout_ms ?? DEFAULT_VERIFY_TIMEOUT_MS });
  const output = `${out.stdout}${out.stderr}`.split("\n").slice(-OUTPUT_TAIL_LINES).join("\n");
  const green = out.code === 0 && !out.timedOut;
  return ok({ outcome: green ? "verified" : "broken", exit: out.code, timed_out: out.timedOut, output });
}

async function run(input: StepKindInput<VerifyBaseConfig>, ctx: HostContext): Promise<PluginResult<StepKindOutcome>> {
  const place = await stepPlace(ctx, input);
  if (!place.ok) return place;
  const p = place.value;
  const fetched = await fetchRemote(ctx, p.cwd, p.remote);
  if (!fetched.ok) return fetched;
  const base = await resolveBase(ctx, p.cwd, input, p.remote);
  if (!base.ok) return base;
  const head = await revParse(ctx, p.cwd, "HEAD");
  if (!head.ok) return head;
  if (head.value === null) return fail("invalid", `verify-base: ${p.branch} has no commit`, false);
  const pair = { head: head.value, base: base.value.sha };

  const holds = await isAncestor(ctx, p.cwd, pair.base, pair.head);
  if (!holds.ok) return holds;
  if (holds.value) return ok({ outcome: "waiting", detail: { ...pair, reason: "the story holds the base" } });
  const tested = await readTested(ctx, input.unit);
  // `tested` is the pair's outcome as data, so a host polling outside a workflow step reads a broken pair as broken every time
  if (tested && tested.head === pair.head && tested.base === pair.base) return ok({ outcome: "waiting", detail: { ...pair, tested: tested.outcome, reason: `tested: ${tested.outcome}` } });

  const scratch = scratchPath(ctx, input.unit);
  await dropScratch(ctx, scratch);
  const tried = await tryMerged(ctx, scratch, pair.head, pair.base, input.config);
  await dropScratch(ctx, scratch);
  if (!tried.ok) return tried;
  const t = tried.value;
  const kept = await writeTested(ctx, input.unit, { ...pair, outcome: t.outcome });
  if (!kept.ok) return kept;
  if (t.outcome === "conflict") return ok({ outcome: "waiting", detail: { ...pair, reason: "the base conflicts with the story", conflicts: t.files } });
  return ok({ outcome: t.outcome, detail: { ...pair, ref: base.value.ref, exit: t.exit, timed_out: t.timed_out, output: t.output } });
}

export const verifyBase: StepKindDefinition<typeof VerifyBaseConfig> = {
  name: "verify-base",
  configSchema: VerifyBaseConfig,
  outcomes: ["verified", "broken"],
  mode: "wait",
  slot: "vcs",
  run,
};
