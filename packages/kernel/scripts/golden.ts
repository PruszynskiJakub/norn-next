/**
 * The kernel's golden corpus, `packages/kernel/test/golden/*.json`, replayed by
 * `test/unit/golden.test.ts`, which wants each case's decisions exactly. Two modes, so what changes in
 * the corpus is a diff a reviewer can read:
 *
 *   bun run golden -- --update     (from packages/kernel)
 *     A behaviour change: decide is meant to decide differently. Decides every existing case again
 *     and rewrites only its `decisions`; names, facts, workflows and config stay as they are. Prints,
 *     per changed case, the decisions that went and came.
 *
 *   bun run golden                 (from packages/kernel)
 *     Adding cases. Plays every scenario in scripts/golden/ through the model host and writes each
 *     case whose name is not in the corpus yet. Existing cases are never touched, so a scenario
 *     edited later adds its new moments and leaves the recorded ones as they were.
 *
 * A structural refactor uses neither: it leaves the corpus as it is and the golden test green.
 */
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Decision } from "../src/index.ts";
import { caseText, decideGolden, GOLDEN_DIR, type GoldenCase, readCases } from "../test/golden.ts";
import { JOURNEYS } from "./golden/journeys.ts";
import { MATRIX } from "./golden/matrix.ts";

const line = (d: Decision) => `${d.unit ?? "-"} ${d.rule} ${d.kind}`;

/** The decisions that went (`-`) and came (`+`), compared whole, listed by unit, rule and kind. */
export function decisionChanges(before: readonly Decision[], after: readonly Decision[]): string[] {
  const key = (d: Decision) => JSON.stringify(d);
  const was = new Set(before.map(key));
  const now = new Set(after.map(key));
  return [...before.filter((d) => !now.has(key(d))).map((d) => `- ${line(d)}`), ...after.filter((d) => !was.has(key(d))).map((d) => `+ ${line(d)}`)];
}

function update(): void {
  let changed = 0;
  for (const c of readCases()) {
    const decisions = decideGolden(c);
    if (JSON.stringify(decisions) === JSON.stringify(c.decisions)) continue;
    changed++;
    const diff = decisionChanges(c.decisions, decisions);
    console.log(`${c.name}\n${(diff.length ? diff : ["  (same decisions, new order)"]).map((l) => `  ${l}`).join("\n")}`);
    writeFileSync(join(GOLDEN_DIR, `${c.name}.json`), caseText({ ...c, decisions }));
  }
  console.log(changed ? `${changed} case(s) rewritten` : "no case changed");
}

function add(): void {
  let added = 0;
  for (const s of [...JOURNEYS, ...MATRIX]) {
    for (const c of s.build()) {
      const file = join(GOLDEN_DIR, `${c.name}.json`);
      if (existsSync(file)) continue;
      writeFileSync(file, caseText(structuredClone(c) as GoldenCase));
      added++;
      console.log(`+ ${c.name}`);
    }
  }
  console.log(added ? `${added} case(s) added` : "nothing to add");
}

if (import.meta.main) {
  if (process.argv.includes("--update")) update();
  else add();
}
