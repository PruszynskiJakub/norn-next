/**
 * Golden decisions harvest (refactor Phase 0.1). With `NORN_GOLDEN_OUT` set, `Harness.cleanup()`
 * calls `harvestGolden` before deleting the temp repo: every tick of the repo's trace becomes one
 * golden case — decide's inputs as `norn why` rebuilds them (O5, `replayInputs`) and the decisions
 * the tick's `tick.start` record holds (R5.4) — with the harness's temp paths normalised.
 * `scripts/golden.ts` runs the cli integration tests with it on and writes the corpus that
 * `packages/core/test/golden.test.ts` replays. Off (the default), this does nothing.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { TickStartTrace, TickTrace } from "@norn/schema";
import { readTrace } from "@norn/store";
import { replayInputs } from "../src/runtime/tick.ts";

/** Placeholders the golden corpus uses in place of machine-specific paths. */
export const GOLDEN_DIR_TOKEN = "<dir>";
export const GOLDEN_HOME_TOKEN = "<user-home>";

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Replace the harness temp dir (realpath and the `/var`-not-`/private/var` spelling) and the user's home. */
export function normaliser(dir: string): (text: string) => string {
  const dirs = [...new Set([dir, join(tmpdir(), basename(dir)), dir.replace(/^\/private\//, "/")])].sort((a, b) => b.length - a.length);
  const home = homedir();
  return (text) => {
    let out = text;
    for (const d of dirs) out = out.replace(new RegExp(escapeRe(d), "g"), GOLDEN_DIR_TOKEN);
    if (home && home !== "/") out = out.replace(new RegExp(`${escapeRe(home)}(?=/|"|$)`, "g"), GOLDEN_HOME_TOKEN);
    return out;
  };
}

/** One golden case per tick in `root`'s trace, written to `outDir` as `<source>-<hash>.json`. Returns the count. */
export function harvestGolden(dir: string, root: string, outDir: string, source: string): number {
  const { events } = readTrace(root, { types: ["tick", "tick.start"] });
  const starts = new Map<string, TickStartTrace>();
  for (const ev of events) if (ev.type === "tick.start") starts.set(ev.tick_id, ev);
  const norm = normaliser(dir);
  mkdirSync(outDir, { recursive: true });
  let n = 0;
  for (const ev of events) {
    if (ev.type !== "tick") continue;
    const tick = ev as TickTrace;
    const inputs = replayInputs(root, tick);
    const start = starts.get(tick.tick_id);
    if (!inputs || !start) continue;
    const body = norm(JSON.stringify({ facts: inputs.facts, workflows: inputs.workflows, config: inputs.config, decisions: start.decisions }));
    const hash = new Bun.CryptoHasher("sha256").update(body).digest("hex").slice(0, 12);
    const parsed = JSON.parse(body) as Record<string, unknown>;
    writeFileSync(join(outDir, `${source}-${hash}.json`), `${JSON.stringify({ source, tick_id: tick.tick_id, ...parsed })}\n`);
    n++;
  }
  return n;
}
