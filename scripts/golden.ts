/**
 * The golden decisions corpus (refactor Phase 0.1): `packages/core/test/golden/*.json`, replayed by
 * `packages/core/test/golden.test.ts`, which wants each case's recorded decisions exactly. Two modes,
 * so that what changes in the corpus is a diff a reviewer can read:
 *
 *   bun scripts/golden.ts --update
 *     A behaviour change (decide is meant to decide differently). Decides every existing case again
 *     and rewrites only its `decisions`; file names, facts, workflows and config stay as they are.
 *     Prints, per changed case, the decisions that went and came. Nothing is harvested, added or
 *     dropped, so the diff is exactly the decisions that changed.
 *
 *   bun scripts/golden.ts [--per-rule N] [test-file …]
 *     Adding cases. Runs the test files that build a harness (cli integration and test/e2e, each with its
 *     tier's config) with `NORN_GOLDEN_OUT` set, so each harness repo's ticks are harvested on cleanup
 *     (`test/support/golden-harvest.ts`):
 *     decide's inputs as `norn why` replays them (O5) and the decisions the tick recorded (R5.4), temp
 *     paths normalised. Existing cases are never touched. A harvested case is added, smallest
 *     `stableKey` first, only when it brings a rule that fewer than `N` (default 2) cases fire —
 *     counting the existing corpus — and its `stableKey` is not in the corpus yet. Cases are named by
 *     the `stableKey` of decide's inputs (not its decisions), so a rerun with nothing new to cover adds
 *     nothing and `--update` never makes a name stale.
 *
 * A structural refactor uses neither: it leaves the corpus as it is and the golden test green.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import { caseInputs, stableKey } from "../test/support/golden-harvest.ts";
import { decide, type RepoWorkflows } from "../packages/core/src/decide/index.ts";
import type { Facts } from "../packages/core/src/facts.ts";

const ROOT = join(import.meta.dir, "..");
/** Where the harness test files live (gh-118 D12), each with the config of its tier: the root bunfig ignores both folders. */
const HARVEST_TIERS: Array<{ dir: string; config: string }> = [
  { dir: join("packages", "cli", "test", "integration"), config: "bunfig.integration.toml" },
  { dir: join("test", "e2e"), config: "bunfig.e2e.toml" },
];
const OUT = join(ROOT, "packages", "core", "test", "golden");

export interface RecordedDecision {
  unit: string;
  rule: string;
  action: unknown;
}

export interface GoldenCase {
  source: string;
  tick_id: string;
  facts: Facts;
  workflows: RepoWorkflows;
  config: Parameters<typeof decide>[2];
  decisions: RecordedDecision[];
}

/** The text a case's `stableKey` is taken from: what the harvest names it by (decide's inputs, not its decisions). */
export function caseBody(c: Pick<GoldenCase, "facts" | "workflows" | "config">): string {
  return caseInputs(c);
}

/** Rule ids a case's decisions fire, once each. */
export function rulesOf(c: Pick<GoldenCase, "decisions">): string[] {
  return [...new Set(c.decisions.map((d) => d.rule))];
}

export interface Candidate {
  name: string;
  key: string;
  rules: string[];
}

/**
 * The candidates to add to a corpus whose cases fire `existing` (one rule list per case) and whose
 * stable keys are `have`: smallest key first (then name), each only when its key is new and it brings
 * a rule fired by fewer than `perRule` cases so far. Depends on nothing but its inputs.
 */
export function selectNew(existing: string[][], have: Set<string>, candidates: Candidate[], perRule: number): Candidate[] {
  const fired = new Map<string, number>();
  for (const rules of existing) for (const r of rules) fired.set(r, (fired.get(r) ?? 0) + 1);
  const seen = new Set(have);
  const added: Candidate[] = [];
  for (const c of [...candidates].sort((a, b) => a.key.length - b.key.length || a.name.localeCompare(b.name))) {
    if (seen.has(c.key)) continue;
    if (!c.rules.some((r) => (fired.get(r) ?? 0) < perRule)) continue;
    seen.add(c.key);
    added.push(c);
    for (const r of c.rules) fired.set(r, (fired.get(r) ?? 0) + 1);
  }
  return added;
}

/** Decisions in `before` and not in `after` (gone) and the reverse (came), as `unit rule action` lines, counted as multisets. */
export function decisionChanges(before: RecordedDecision[], after: RecordedDecision[]): { gone: string[]; came: string[] } {
  const line = (d: RecordedDecision) => `${d.unit} ${d.rule} ${JSON.stringify(d.action)}`;
  const minus = (a: string[], b: string[]) => {
    const left = [...b];
    return a.filter((x) => {
      const i = left.indexOf(x);
      if (i < 0) return true;
      left.splice(i, 1);
      return false;
    });
  };
  const b = before.map(line);
  const a = after.map(line);
  return { gone: minus(b, a), came: minus(a, b) };
}

/** decide's output as the trace records it: JSON-safe (`tick.start` decisions, R5.4). */
function decideRecorded(c: GoldenCase): RecordedDecision[] {
  const ds = decide(c.facts, c.workflows, c.config);
  return JSON.parse(JSON.stringify(ds.map((d) => ({ unit: d.unit, rule: d.rule, action: d.action })))) as RecordedDecision[];
}

function readCorpus(): Array<[string, GoldenCase]> {
  return readdirSync(OUT)
    .filter((n) => n.endsWith(".json"))
    .sort()
    .map((n) => [n, JSON.parse(readFileSync(join(OUT, n), "utf8")) as GoldenCase]);
}

function update(): void {
  const corpus = readCorpus();
  let changed = 0;
  for (const [name, c] of corpus) {
    const now = decideRecorded(c);
    if (JSON.stringify(now) === JSON.stringify(c.decisions)) continue;
    const { gone, came } = decisionChanges(c.decisions, now);
    console.error(`\n${name}`);
    for (const g of gone) console.error(`  - ${g}`);
    for (const k of came) console.error(`  + ${k}`);
    if (!gone.length && !came.length) console.error("  (same decisions, new order)");
    writeFileSync(join(OUT, name), `${JSON.stringify({ ...c, decisions: now })}\n`);
    changed++;
  }
  console.error(`\n${changed} of ${corpus.length} golden case(s) decide differently now; only their decisions were rewritten`);
}

/** The harness test files the harvest runs, repo-relative: every `*.test.ts` in a harvest tier that calls `createHarness(`. */
export function harvestFiles(): string[] {
  return HARVEST_TIERS.flatMap(({ dir }) =>
    readdirSync(join(ROOT, dir))
      .filter((n) => n.endsWith(".test.ts") && readFileSync(join(ROOT, dir, n), "utf8").includes("createHarness("))
      .sort()
      .map((n) => join(dir, n)),
  );
}

/** The command that runs one harvested test file (repo-relative) with its tier's config and the tiers' 20 s timeout (D7). */
export function harvestCommand(file: string): string[] {
  const tier = HARVEST_TIERS.find(({ dir }) => file.startsWith(`${dir}/`));
  if (!tier) throw new Error(`${file} is not in a harvest tier (${HARVEST_TIERS.map((t) => t.dir).join(", ")})`);
  return ["bun", "test", `--config=${tier.config}`, "--timeout=20000", `./${file}`];
}

async function add(perRule: number, named: string[]): Promise<void> {
  const testFiles = (named.length ? named : harvestFiles()).map((f) => join(ROOT, f));

  const raw = mkdtempSync(join(tmpdir(), "norn-golden-"));
  const failed: string[] = [];
  const harvest = async (file: string) => {
    const source = basename(file).replace(/\.test\.ts$/, "");
    const proc = Bun.spawn(harvestCommand(relative(ROOT, file)), {
      cwd: ROOT,
      env: { ...process.env, NORN_GOLDEN_OUT: join(raw, source), NORN_GOLDEN_SOURCE: source },
      stdout: "ignore",
      stderr: "pipe",
    });
    const err = await new Response(proc.stderr).text();
    const code = await proc.exited;
    if (code !== 0) failed.push(`${relative(ROOT, file)} (exit ${code})\n${err.split("\n").filter((l) => /fail|error/i.test(l)).slice(0, 10).join("\n")}`);
    console.error(`${code === 0 ? "ok  " : "FAIL"} ${relative(ROOT, file)}`);
  };
  const queue = [...testFiles];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let f = queue.shift(); f; f = queue.shift()) await harvest(f);
    }),
  );
  if (failed.length) {
    rmSync(raw, { recursive: true, force: true });
    console.error(`\nnothing added: a harvested test file failed\n${failed.join("\n")}`);
    process.exit(1);
  }

  const texts = new Map<string, string>();
  const candidates: Candidate[] = [];
  for (const source of readdirSync(raw).sort()) {
    for (const name of readdirSync(join(raw, source)).sort()) {
      if (texts.has(name)) continue;
      const text = readFileSync(join(raw, source, name), "utf8");
      const c = JSON.parse(text) as GoldenCase;
      texts.set(name, text);
      candidates.push({ name, key: stableKey(caseBody(c)), rules: rulesOf(c) });
    }
  }
  rmSync(raw, { recursive: true, force: true });

  const corpus = readCorpus();
  const names = new Set(corpus.map(([n]) => n));
  const added = selectNew(
    corpus.map(([, c]) => rulesOf(c)),
    new Set(corpus.map(([, c]) => stableKey(caseBody(c)))),
    candidates.filter((c) => !names.has(c.name)),
    perRule,
  );
  for (const c of added) {
    writeFileSync(join(OUT, c.name), `${(texts.get(c.name) as string).trimEnd()}\n`);
    console.error(`added ${c.name}: ${c.rules.join(", ")}`);
  }
  console.error(`\n${added.length} golden case(s) added of ${candidates.length} harvested; the ${corpus.length} existing left as they were → ${relative(ROOT, OUT)}`);
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  let perRule = 2;
  let doUpdate = false;
  const named: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === "--per-rule") perRule = Number(argv[++i]);
    else if (a === "--update") doUpdate = true;
    else named.push(a);
  }
  if (!Number.isInteger(perRule) || perRule < 1) throw new Error("--per-rule takes a positive integer");
  if (doUpdate && named.length) throw new Error("--update decides the existing cases again; it takes no test files");
  if (doUpdate) update();
  else await add(perRule, named);
}
