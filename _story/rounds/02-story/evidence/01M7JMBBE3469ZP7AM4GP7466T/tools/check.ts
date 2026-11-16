import { parse } from "/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-343-a-step-is-written-with-two-keys-for-one/node_modules/yaml/dist/index.js";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
const dir = process.argv[2];
const OLD = ["type","skill","instructions","run","prompt","action"];
let bad = 0;
for (const f of (readdirSync(dir, { recursive: true }) as string[]).filter(p => /\.ya?ml$/.test(p)).sort()) {
  const doc = parse(readFileSync(join(dir, f), "utf8"));
  const probs: string[] = []; let agents = 0;
  for (const [sn, s] of Object.entries<any>(doc.steps ?? {})) {
    for (const k of OLD) if (k in s) probs.push(`${sn}.${k}`);
    if ("agent" in s) { agents++; if (typeof s.agent !== "string" || !s.agent.trim()) probs.push(`${sn}.agent empty`); }
    for (const [o, e] of Object.entries<any>(s.outcomes ?? {})) if (e && typeof e === "object" && ("means" in e || "verdict" in e)) probs.push(`${sn}.outcomes.${o} means/verdict in edge`);
  }
  for (const [x, e] of Object.entries<any>(doc.exits ?? {})) if (e && typeof e === "object" && ("means" in e || "verdict" in e)) probs.push(`exits.${x} means/verdict`);
  console.log(`${f}: steps=${Object.keys(doc.steps ?? {}).length} agent_steps=${agents} ${probs.length ? "PROBLEMS " + probs.join(", ") : "ok"}`);
  bad += probs.length;
}
console.log("total problems:", bad);
