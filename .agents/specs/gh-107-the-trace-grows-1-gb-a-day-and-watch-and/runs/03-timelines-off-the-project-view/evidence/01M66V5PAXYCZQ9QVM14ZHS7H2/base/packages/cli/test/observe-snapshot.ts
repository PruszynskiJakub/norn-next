/**
 * Observe snapshots and inbox parity (refactor Phase 0.3). At a fixed point of a harness scenario:
 *   - `observeNow(h)` runs observe as a tick would (no remote sync, so nothing leaves the machine)
 *     and returns its Facts, config and workflows;
 *   - `expectFactsSnapshot(h, facts, name)` compares the normalised Facts with
 *     `test/observe-snapshots/<name>.json` (`NORN_TRANSCRIPT_UPDATE=1` rewrites it), so a refactor of
 *     the facts builders (Phase 5) shows it observes the same world;
 *   - `inboxParity(h, obs)` gives the inbox `norn inbox` shows (`loadProjectView`, X1) and the inbox
 *     `buildInbox` makes over observe's Facts (the tick's notifier and history), for the same instant.
 * Normalisation is the effect transcripts' (`textNormaliser`), plus this process's pid and start
 * time in machine lease holders and wall-clock epoch ms (git commit times).
 */
import { expect } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildInbox, type Facts, type Inbox } from "@norn/core";
import { ulid } from "@norn/schema";
import { Context, observe, type Observed } from "../src/index.ts";
import { projectView } from "../src/runtime/human.ts";
import { type Harness, T0 } from "./harness.ts";
import { textNormaliser } from "./transcript.ts";

/** Observe the harness repo now, as a tick's observe would without a remote sync. */
export async function observeNow(h: Harness): Promise<Observed> {
  const ctx = new Context(h.deps);
  await ctx.locate();
  return observe(ctx, { tick_id: ulid(h.clock.now()), sync: "never" });
}

/**
 * Facts as stable text: keys sorted, process identity of this test run replaced, epoch ms from the
 * real clock (git commit times: the harness commits at wall time, before the fake clock's T0) →
 * `"<wall-ms>"`, then the transcript normaliser.
 */
export function normaliseFacts(h: Harness, facts: Facts): string {
  const sorted = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sorted);
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(o)
          .sort()
          .filter((k) => o[k] !== undefined)
          .map((k) => [k, k === "holder" && o[k] && typeof o[k] === "object" ? processIdentity(o[k] as Record<string, unknown>) : sorted(o[k])]),
      );
    }
    if (typeof v === "number" && v > 1e12 && v < T0) return "<wall-ms>";
    return v;
  };
  return `${textNormaliser(h.dir)(JSON.stringify(sorted(facts), null, 2))}\n`;
}

/** A lease holder's pid and start time are this test process's: stable placeholders. */
function processIdentity(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(o).sort()) out[k] = k === "pid" ? "<pid>" : k === "pid_start" ? "<pid_start>" : o[k];
  return out;
}

/** Compare with `test/observe-snapshots/<name>.json`; `NORN_TRANSCRIPT_UPDATE=1` writes it instead. */
export function expectFactsSnapshot(h: Harness, facts: Facts, name: string): void {
  const dir = join(import.meta.dir, "observe-snapshots");
  const file = join(dir, `${name}.json`);
  const actual = normaliseFacts(h, facts);
  if (process.env.NORN_TRANSCRIPT_UPDATE === "1") {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, actual);
    return;
  }
  if (!existsSync(file)) throw new Error(`no observe snapshot ${file}: run NORN_TRANSCRIPT_UPDATE=1 bun test on this file and review it`);
  expect(actual).toBe(readFileSync(file, "utf8"));
}

/** The view's inbox (what `norn inbox` reads) and the inbox built over observe's Facts, at the same instant. */
export async function inboxParity(h: Harness, obs: Observed): Promise<{ view: Inbox; observed: Inbox }> {
  const ctx = new Context(h.deps);
  await ctx.locate();
  const view = await projectView(ctx);
  return { view: view.inbox, observed: buildInbox(obs.facts, obs.config) };
}
