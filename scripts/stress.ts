// Repeat the test tiers N times to find flaky tests (`bun run test:stress [N] [options]`).
//
//   bun run test:stress 10                       every tier, 10 rounds, the tiers of a round side by side
//   bun run test:stress 5 --tier integration     one tier
//   bun run test:stress 3 --serial               the tiers of a round one after another
//
// Each tier runs as its package script would (unit with --parallel too) and writes a junit report.
// A tier that runs past --limit (default 10m) is killed and counted as a hang, so a stuck spawnSync
// cannot stall the loop. At the end it prints, per failing test, how many rounds it failed in and the
// first error, writes the whole record to --out (default $TMPDIR/norn-stress/summary.json) and exits 1
// if any round was red.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Tier = "unit" | "integration" | "e2e";

const TIER_ARGS: Record<Tier, string[]> = {
  unit: ["test", "--parallel"],
  integration: ["test", "--config=bunfig.integration.toml", "--parallel", "--timeout=20000"],
  e2e: ["test", "--config=bunfig.e2e.toml", "--parallel", "--timeout=20000"],
};

type Failure = { tier: Tier; round: number; file: string; name: string; error: string };
type TierRun = { tier: Tier; round: number; exit: number | null; hung: boolean; ms: number; tests: number; failures: Failure[] };

function parseArgs(argv: string[]) {
  let rounds = 10;
  let tiers: Tier[] = ["unit", "integration", "e2e"];
  let serial = false;
  let limitMs = 10 * 60_000;
  let out = join(tmpdir(), "norn-stress");
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--tier") tiers = argv[++i]!.split(",") as Tier[];
    else if (a === "--serial") serial = true;
    else if (a === "--limit") limitMs = Number(argv[++i]) * 1000;
    else if (a === "--out") out = argv[++i]!;
    else if (/^\d+$/.test(a)) rounds = Number(a);
    else throw new Error(`unknown argument ${a}`);
  }
  for (const t of tiers) if (!(t in TIER_ARGS)) throw new Error(`unknown tier ${t}`);
  return { rounds, tiers, serial, limitMs, out };
}

const unescape = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#10;/g, "\n").replace(/&amp;/g, "&");

function parseJunit(xml: string, tier: Tier, round: number): { tests: number; failures: Failure[] } {
  const failures: Failure[] = [];
  let tests = 0;
  const re = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
  for (const m of xml.matchAll(re)) {
    tests++;
    const attrs = m[1]!;
    const body = m[3] ?? "";
    if (!/<(failure|error)\b/.test(body)) continue;
    const attr = (k: string) => unescape(attrs.match(new RegExp(`\\b${k}="([^"]*)"`))?.[1] ?? "");
    const msg = body.match(/<(?:failure|error)\b[^>]*?message="([^"]*)"/)?.[1] ?? body.replace(/<[^>]+>/g, "").trim();
    failures.push({ tier, round, file: attr("file") || attr("classname"), name: attr("name"), error: unescape(msg).split("\n")[0]!.slice(0, 300) });
  }
  return { tests, failures };
}

async function runTier(tier: Tier, round: number, dir: string, limitMs: number): Promise<TierRun> {
  const report = join(dir, `${tier}-${round}.xml`);
  const log = join(dir, `${tier}-${round}.log`);
  const start = Date.now();
  const proc = Bun.spawn(["bun", ...TIER_ARGS[tier], "--reporter=junit", `--reporter-outfile=${report}`], {
    stdout: Bun.file(log),
    stderr: "pipe",
    detached: true,
  });
  let hung = false;
  const timer = setTimeout(() => {
    hung = true;
    try { process.kill(-proc.pid, "SIGKILL"); } catch { proc.kill("SIGKILL"); }
  }, limitMs);
  const stderr = await new Response(proc.stderr).text();
  const exit = await proc.exited;
  clearTimeout(timer);
  writeFileSync(log + ".err", stderr);
  const parsed = existsSync(report) ? parseJunit(readFileSync(report, "utf8"), tier, round) : { tests: 0, failures: [] };
  // A red tier with no failing testcase (an unhandled error between tests, a crash) still counts.
  if ((exit !== 0 || hung) && parsed.failures.length === 0) {
    const tail = stderr.trim().split("\n").slice(-3).join(" | ").slice(0, 300);
    parsed.failures.push({ tier, round, file: "(tier)", name: hung ? `hung past ${limitMs / 1000}s` : `exit ${exit}`, error: tail });
  }
  return { tier, round, exit, hung, ms: Date.now() - start, ...parsed };
}

const { rounds, tiers, serial, limitMs, out } = parseArgs(process.argv.slice(2));
mkdirSync(out, { recursive: true });
const runs: TierRun[] = [];
for (let round = 1; round <= rounds; round++) {
  const results = serial
    ? await tiers.reduce<Promise<TierRun[]>>(async (acc, t) => [...(await acc), await runTier(t, round, out, limitMs)], Promise.resolve([]))
    : await Promise.all(tiers.map((t) => runTier(t, round, out, limitMs)));
  runs.push(...results);
  const line = results.map((r) => `${r.tier} ${r.failures.length ? `RED(${r.failures.length})` : "green"} ${Math.round(r.ms / 1000)}s`).join("  ");
  console.log(`round ${round}/${rounds}: ${line}`);
}

const byTest = new Map<string, { tier: Tier; file: string; name: string; rounds: Set<number>; error: string }>();
for (const f of runs.flatMap((r) => r.failures)) {
  const key = `${f.tier}\t${f.file}\t${f.name}`;
  const e = byTest.get(key) ?? { tier: f.tier, file: f.file, name: f.name, rounds: new Set<number>(), error: f.error };
  e.rounds.add(f.round);
  byTest.set(key, e);
}
const redRounds = new Set(runs.filter((r) => r.failures.length).map((r) => r.round));
writeFileSync(
  join(out, "summary.json"),
  JSON.stringify({ rounds, tiers, red_rounds: [...redRounds], runs, failing: [...byTest.values()].map((e) => ({ ...e, rounds: [...e.rounds] })) }, null, 2),
);
console.log(`\n${rounds - redRounds.size}/${rounds} rounds green; record in ${join(out, "summary.json")}`);
for (const e of [...byTest.values()].sort((a, b) => b.rounds.size - a.rounds.size)) {
  console.log(`  ${e.rounds.size}/${rounds}  [${e.tier}] ${e.file} > ${e.name}\n        ${e.error}`);
}
process.exit(redRounds.size ? 1 : 0);
