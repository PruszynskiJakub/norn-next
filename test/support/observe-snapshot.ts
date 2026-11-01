/**
 * Observe snapshots and inbox parity (refactor Phase 0.3). At a fixed point of a harness scenario:
 *   - `observeNow(h)` (observe-now.ts) runs observe as a tick would (no remote sync, so nothing leaves the machine)
 *     and returns its Facts, config and workflows;
 *   - `expectFactsSnapshot(h, facts, name)` compares the normalised Facts with
 *     `test/e2e/observe-snapshots/<name>.json` (`NORN_TRANSCRIPT_UPDATE=1 bun run test:e2e <file>` rewrites it), so a refactor of
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
import { Context, type Observed } from "../../packages/cli/src/index.ts";
import { projectView } from "../../packages/cli/src/runtime/human.ts";
import { type Harness, T0 } from "./harness.ts";
import { REPO_ROOT } from "./repo-root.ts";
import { textNormaliser } from "./transcript.ts";

/** Where the pinned observe snapshots live, named from the repo root (gh-118 B19). */
export const OBSERVE_SNAPSHOTS_DIR = join(REPO_ROOT, "test", "e2e", "observe-snapshots");

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

/** Compare with `test/e2e/observe-snapshots/<name>.json`; `NORN_TRANSCRIPT_UPDATE=1` writes it instead. */
export function expectFactsSnapshot(h: Harness, facts: Facts, name: string): void {
  const file = join(OBSERVE_SNAPSHOTS_DIR, `${name}.json`);
  const actual = normaliseFacts(h, facts);
  if (process.env.NORN_TRANSCRIPT_UPDATE === "1") {
    mkdirSync(OBSERVE_SNAPSHOTS_DIR, { recursive: true });
    writeFileSync(file, actual);
    return;
  }
  if (!existsSync(file)) throw new Error(`no observe snapshot ${file}: run NORN_TRANSCRIPT_UPDATE=1 bun run test:e2e <this file> and review it`);
  expect(actual).toBe(readFileSync(file, "utf8"));
}

/** The view's inbox (what `norn inbox` reads) and the inbox built over observe's Facts, at the same instant. */
export async function inboxParity(h: Harness, obs: Observed): Promise<{ view: Inbox; observed: Inbox }> {
  const ctx = new Context(h.deps);
  await ctx.locate();
  const view = await projectView(ctx);
  return { view: view.inbox, observed: buildInbox(obs.facts, obs.config) };
}
