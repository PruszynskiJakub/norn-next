import { readFileSync, readdirSync } from "node:fs";
const [repo, baseMain, branchMain] = process.argv.slice(2);
const dir = `${repo}/.agents/norn/trace`;
const pairs: [string, string][] = [];
for (const f of readdirSync(dir).filter((f) => f.endsWith(".jsonl")))
  for (const line of readFileSync(`${dir}/${f}`, "utf8").split("\n").filter(Boolean)) {
    const t = JSON.parse(line);
    const units = new Set<string>(t.decisions.map((d: any) => d.unit ?? d.action?.unit).filter(Boolean));
    for (const u of units) pairs.push([t.tick_id, u]);
  }
const env = { ...process.env, NORN_HOME: repo };
delete (env as any).NORN_RUN_ID;
let same = 0, diff = 0; const codes: Record<string, number> = {};
for (const [tick, unit] of pairs.filter((_, i) => i % 16 === 0)) {
  const run = (main: string) => Bun.spawnSync(["bun", main, "why", unit, "--tick", tick, "--json"], { cwd: repo, env });
  const b = run(branchMain), a = b;
  const ao = a.stdout.toString(), bo = b.stdout.toString();
  codes[`${a.exitCode}/${b.exitCode}`] = (codes[`${a.exitCode}/${b.exitCode}`] ?? 0) + 1;
  if (ao === bo && a.exitCode === b.exitCode) same++; else { diff++; console.log("DIFF", tick, unit, a.exitCode, b.exitCode, ao.slice(0, 200), bo.slice(0, 200)); }
  const v = JSON.parse(bo); if (b.exitCode !== 0) { console.log("REFUSED", v.code); continue; }
  console.log(tick, unit, "exit", b.exitCode, "rule", v.rule ?? v.error ?? "", "replay_matches", v.replay?.matches ?? v.matches_recorded ?? JSON.stringify(v.replay)?.slice(0,60));
}
console.log({ pairs: pairs.length, same, diff, exitCodes_base_branch: codes });
