/**
 * Regenerate the golden decisions corpus (refactor Phase 0.1): `bun scripts/golden.ts`.
 *
 * Runs every cli integration test file that builds a harness with `NORN_GOLDEN_OUT` set, so each
 * harness repo's ticks are harvested on cleanup (`packages/cli/test/golden-harvest.ts`): decide's
 * inputs as `norn why` replays them (O5) and the decisions the tick recorded (R5.4), temp paths
 * normalised. From those it keeps, smallest first, every case that brings a rule fewer than
 * `PER_RULE` kept cases fire, and writes them to `packages/core/test/golden/`, replacing what is
 * there. `packages/core/test/golden.test.ts` replays each one through decide and wants exactly the
 * recorded decisions.
 *
 * Regenerate only when decide is meant to decide differently (a behaviour change), and review the
 * diff: a structural refactor must leave the corpus as it is and the golden test green.
 *
 *   bun scripts/golden.ts [--per-rule N] [test-file …]
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..");
const CLI_TESTS = join(ROOT, "packages", "cli", "test");
const OUT = join(ROOT, "packages", "core", "test", "golden");

const argv = process.argv.slice(2);
let perRule = 2;
const named: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i] as string;
  if (a === "--per-rule") perRule = Number(argv[++i]);
  else named.push(a);
}
if (!Number.isInteger(perRule) || perRule < 1) throw new Error("--per-rule takes a positive integer");

const testFiles = named.length
  ? named.map((f) => join(ROOT, f))
  : readdirSync(CLI_TESTS)
      .filter((n) => n.endsWith(".test.ts") && readFileSync(join(CLI_TESTS, n), "utf8").includes("createHarness("))
      .sort()
      .map((n) => join(CLI_TESTS, n));

const raw = mkdtempSync(join(tmpdir(), "norn-golden-"));
const failed: string[] = [];

async function harvest(file: string): Promise<void> {
  const source = basename(file).replace(/\.test\.ts$/, "");
  const proc = Bun.spawn(["bun", "test", relative(ROOT, file)], {
    cwd: ROOT,
    env: { ...process.env, NORN_GOLDEN_OUT: join(raw, source), NORN_GOLDEN_SOURCE: source },
    stdout: "ignore",
    stderr: "pipe",
  });
  const err = await new Response(proc.stderr).text();
  const code = await proc.exited;
  if (code !== 0) failed.push(`${relative(ROOT, file)} (exit ${code})\n${err.split("\n").filter((l) => /fail|error/i.test(l)).slice(0, 10).join("\n")}`);
  console.error(`${code === 0 ? "ok  " : "FAIL"} ${relative(ROOT, file)}`);
}

const queue = [...testFiles];
const workers = Array.from({ length: 4 }, async () => {
  for (let f = queue.shift(); f; f = queue.shift()) await harvest(f);
});
await Promise.all(workers);
if (failed.length) {
  rmSync(raw, { recursive: true, force: true });
  console.error(`\nnot regenerated: a harvested test file failed\n${failed.join("\n")}`);
  process.exit(1);
}

interface Case {
  name: string;
  text: string;
  rules: string[];
}
const byHash = new Map<string, Case>();
for (const source of readdirSync(raw).sort()) {
  for (const name of readdirSync(join(raw, source)).sort()) {
    const text = readFileSync(join(raw, source, name), "utf8");
    const hash = name.replace(/\.json$/, "").split("-").at(-1) as string;
    if (byHash.has(hash)) continue;
    const c = JSON.parse(text) as { decisions: Array<{ rule: string }> };
    byHash.set(hash, { name, text, rules: [...new Set(c.decisions.map((d) => d.rule))] });
  }
}

const kept: Case[] = [];
const fired = new Map<string, number>();
for (const c of [...byHash.values()].sort((a, b) => a.text.length - b.text.length || a.name.localeCompare(b.name))) {
  if (!c.rules.some((r) => (fired.get(r) ?? 0) < perRule)) continue;
  kept.push(c);
  for (const r of c.rules) fired.set(r, (fired.get(r) ?? 0) + 1);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
for (const c of kept) writeFileSync(join(OUT, c.name), `${c.text.trimEnd()}\n`);
rmSync(raw, { recursive: true, force: true });
const bytes = kept.reduce((s, c) => s + c.text.length, 0);
console.error(`\n${kept.length} golden case(s) of ${byHash.size} harvested, ${fired.size} rule(s), ~${Math.round(bytes / 1024)} KiB → ${relative(ROOT, OUT)}`);
