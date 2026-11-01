/**
 * Golden decisions harvest (refactor Phase 0.1). With `NORN_GOLDEN_OUT` set, `Harness.cleanup()`
 * calls `harvestGolden` before deleting the temp repo: every tick of the repo's trace becomes one
 * golden case — decide's inputs as `norn why` rebuilds them (O5, store `readTickInputs`) and the decisions
 * the tick's `tick.start` record holds (R5.4) — with the harness's temp paths normalised.
 * `scripts/golden.ts` runs the cli integration tests with it on and writes the corpus that
 * `packages/core/test/unit/golden.test.ts` replays. Off (the default), this does nothing.
 *
 * A case is named by its `stableKey`, not by its raw text: harvested facts hold values that change
 * on every run (random ulids, git shas and commit times from the wall clock, pids), so naming and
 * picking by raw text would rename and reshuffle the corpus on each run.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { TickStartTrace, TickTrace } from "@norn/schema";
import { readTrace, tickReader } from "@norn/store";

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

const ULID = /\b[0-9A-HJKMNP-TV-Z]{26}\b/g;
const SHA = /\b[0-9a-f]{40}\b/g;

/**
 * `body` with the values that differ between two runs of the same test replaced: ulids and git shas
 * by a token per distinct value in order of first appearance (so which ids are equal survives),
 * pids, process start times, wall-clock epoch milliseconds (2001–2033; the harness clock is in 2099)
 * and ISO times with an offset (git commit dates) by fixed tokens. Two runs of one tick give the same
 * key; it names a case and orders the smallest-first pick.
 */
export function stableKey(body: string): string {
  const tokens = (prefix: string) => {
    const seen = new Map<string, string>();
    return (v: string) => {
      let t = seen.get(v);
      if (!t) seen.set(v, (t = `<${prefix}${seen.size}>`));
      return t;
    };
  };
  return body
    .replace(ULID, tokens("ulid"))
    .replace(SHA, tokens("sha"))
    .replace(/"pid":\d+/g, '"pid":0')
    .replace(/"pid_start":"[^"]*"/g, '"pid_start":"<pid-start>"')
    .replace(/(?<![\d.])1\d{12}(?![\d.])/g, "<epoch-ms>")
    .replace(/"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d"/g, '"<git-date>"');
}

/**
 * The text a case is named and deduplicated by: decide's inputs only. decide is pure, so the inputs
 * identify the case, and its decisions are what the golden test expects of them; an intended
 * behaviour change (`golden.ts --update`) rewrites the decisions and keeps the name.
 */
export function caseInputs(c: { facts: unknown; workflows: unknown; config: unknown }): string {
  return JSON.stringify({ facts: c.facts, workflows: c.workflows, config: c.config });
}

/** The file name of a harvested case: its source and a hash of the `stableKey` of its `caseInputs`. */
export function caseName(source: string, body: string): string {
  return `${source}-${new Bun.CryptoHasher("sha256").update(stableKey(body)).digest("hex").slice(0, 12)}.json`;
}

/** One golden case per tick in `root`'s trace, written to `outDir` as `caseName(source, body)`. Returns the count. */
export function harvestGolden(dir: string, root: string, outDir: string, source: string): number {
  const { events } = readTrace(root, { types: ["tick", "tick.start"] });
  const starts = new Map<string, TickStartTrace>();
  for (const ev of events) if (ev.type === "tick.start") starts.set(ev.tick_id, ev);
  const norm = normaliser(dir);
  mkdirSync(outDir, { recursive: true });
  const reader = tickReader(root);
  let n = 0;
  for (const ev of events) {
    if (ev.type !== "tick") continue;
    const tick = ev as TickTrace;
    const read = reader.inputs(tick);
    const start = starts.get(tick.tick_id);
    if (!read.ok || !start) continue;
    const { inputs } = read;
    const body = norm(JSON.stringify({ facts: inputs.facts, workflows: inputs.workflows, config: inputs.config, decisions: start.decisions }));
    const parsed = JSON.parse(body) as { facts: unknown; workflows: unknown; config: unknown };
    writeFileSync(join(outDir, caseName(source, caseInputs(parsed))), `${JSON.stringify({ source, tick_id: tick.tick_id, ...parsed })}\n`);
    n++;
  }
  return n;
}
