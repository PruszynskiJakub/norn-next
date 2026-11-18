/**
 * What the host sent a run and what it holds for one. Two records the launcher writes and hook
 * ingestion reads, so neither needs the other running:
 * - sent prompts: every brief, nudge or answer recorded under its prompt id before it is sent, so a
 *   hook seeing a prompt mark (plugin-api prompt-mark.ts) trusts it only when the host sent that id,
 *   and only the first time (`claimReceived`), so a person pasting an old nudge back is the person;
 * - the outbox: a nudge or answer for a runner with no pane, delivered by the next hook answer that
 *   can carry context (`injectContext`) and then marked delivered. Never dropped: an entry stays
 *   until a hook answer carried it.
 * Every write is an exclusive create, so a replayed send records nothing twice.
 */
import type { HostContext, NornPromptSource, PluginResult } from "@norn/plugin-api";
import { fail, ok, parseJson } from "@norn/plugin-api";
import { IsoTime, NonEmpty } from "@norn/schema";
import { type Static, Type } from "@sinclair/typebox";
import { deliveredDir, outboxDir, receivedDir, sentDir, stopBlocksDir } from "./paths.ts";

const PromptSourceSchema = Type.Union([Type.Literal("brief"), Type.Literal("nudge"), Type.Literal("answer")]);

export const SentPrompt = Type.Object(
  {
    id: NonEmpty,
    source: PromptSourceSchema,
    at: IsoTime,
    /** the session's input or permission an answer goes to */
    input_id: Type.Optional(NonEmpty),
  },
  { additionalProperties: false, title: "SentPrompt" },
);
export type SentPrompt = Static<typeof SentPrompt> & { source: NornPromptSource };

export const Injection = Type.Object(
  {
    /** the prompt id it goes under, so its arrival is attributed like a typed prompt */
    id: NonEmpty,
    source: Type.Union([Type.Literal("nudge"), Type.Literal("answer")]),
    /** already marked (see prompt-mark.ts) */
    text: Type.String(),
    input_id: Type.Optional(NonEmpty),
    at: IsoTime,
  },
  { additionalProperties: false, title: "Injection" },
);
export type Injection = Static<typeof Injection>;

// a prompt id becomes a file name, so it keeps to the prompt mark's charset and never walks a folder
const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/;

const unsafe = (id: string) => fail("invalid", `not a prompt id: ${JSON.stringify(id)}`, false);

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

async function createOnce(ctx: HostContext, path: string, data: string): Promise<PluginResult<boolean>> {
  try {
    return ok(await ctx.files.create(path, data));
  } catch (e) {
    return fail("unavailable", `writing ${path}: ${errorText(e)}`);
  }
}

const json = (value: unknown): string => `${JSON.stringify(value)}\n`;

/** Record a prompt before sending it; recording one already there is a replay and changes nothing. */
export async function recordSentPrompt(ctx: HostContext, unit: string, runId: string, sent: SentPrompt): Promise<PluginResult<{ recorded: boolean }>> {
  if (!SAFE_ID.test(sent.id)) return unsafe(sent.id);
  const made = await createOnce(ctx, `${sentDir(ctx, unit, runId)}/${sent.id}.json`, json(sent));
  return made.ok ? ok({ recorded: made.value }) : made;
}

/** The prompt sent under `id`, or null when the host sent none (or its record fails validation). */
export async function readSentPrompt(ctx: HostContext, unit: string, runId: string, id: string): Promise<SentPrompt | null> {
  if (!SAFE_ID.test(id)) return null;
  const text = await ctx.files.read(`${sentDir(ctx, unit, runId)}/${id}.json`);
  if (text === null) return null;
  const parsed = parseJson(SentPrompt, text, "sent prompt");
  return parsed.ok && parsed.value.id === id ? (parsed.value as SentPrompt) : null;
}

/** Mark a sent prompt received; false when it was received before, so this arrival is not norn's. */
export async function claimReceived(ctx: HostContext, unit: string, runId: string, id: string): Promise<boolean> {
  if (!SAFE_ID.test(id)) return false;
  return ctx.files.create(`${receivedDir(ctx, unit, runId)}/${id}`, `${ctx.now()}\n`);
}

/** Queue text for the next hook answer; queueing an id already there is a replay. */
export async function queueInjection(ctx: HostContext, unit: string, runId: string, injection: Injection): Promise<PluginResult<{ queued: boolean }>> {
  if (!SAFE_ID.test(injection.id)) return unsafe(injection.id);
  const made = await createOnce(ctx, `${outboxDir(ctx, unit, runId)}/${injection.id}.json`, json(injection));
  return made.ok ? ok({ queued: made.value }) : made;
}

/** Queued entries no hook answer has carried yet, oldest first, and the files that failed validation. */
export async function pendingInjections(ctx: HostContext, unit: string, runId: string): Promise<{ injections: Injection[]; problems: string[] }> {
  const dir = outboxDir(ctx, unit, runId);
  const delivered = new Set(await ctx.files.list(deliveredDir(ctx, unit, runId)));
  const injections: Injection[] = [];
  const problems: string[] = [];
  for (const name of await ctx.files.list(dir)) {
    if (!name.endsWith(".json")) continue;
    const id = name.slice(0, -".json".length);
    if (delivered.has(id)) continue;
    const text = await ctx.files.read(`${dir}/${name}`);
    if (text === null) continue;
    const parsed = parseJson(Injection, text, `outbox ${dir}/${name}`);
    if (!parsed.ok) problems.push(parsed.failure.message);
    else if (parsed.value.id !== id) problems.push(`outbox ${dir}/${name}: holds entry ${parsed.value.id}`);
    else injections.push(parsed.value);
  }
  injections.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id));
  return { injections, problems };
}

/** Mark entries delivered once the answer carrying them is printed. */
export async function markDelivered(ctx: HostContext, unit: string, runId: string, ids: readonly string[]): Promise<PluginResult<void>> {
  const at = ctx.now();
  for (const id of ids) {
    if (!SAFE_ID.test(id)) return unsafe(id);
    const made = await createOnce(ctx, `${deliveredDir(ctx, unit, runId)}/${id}`, `${at}\n`);
    if (!made.ok) return made;
  }
  return ok(undefined);
}

/**
 * Take one of the run's `max` stop refusals; false when all are taken. Each is an exclusive create of
 * its own number, so hooks that fire together never refuse past the cap between them.
 */
export async function claimStopBlock(ctx: HostContext, unit: string, runId: string, max: number): Promise<boolean> {
  const dir = stopBlocksDir(ctx, unit, runId);
  for (let n = 1; n <= max; n++) if (await ctx.files.create(`${dir}/${n}`, `${ctx.now()}\n`)) return true;
  return false;
}
