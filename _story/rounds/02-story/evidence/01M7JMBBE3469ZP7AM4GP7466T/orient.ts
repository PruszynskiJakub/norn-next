import { parse } from "/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-343-a-step-is-written-with-two-keys-for-one/node_modules/yaml/dist/index.js";
import { readFileSync, readdirSync } from "node:fs";
const d = "/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-343-a-step-is-written-with-two-keys-for-one/packages/cli/assets/workflows";
const files = [...readdirSync(d).filter(f => f.endsWith(".yaml")), ...readdirSync(d + "/shared").map(f => "shared/" + f)];
for (const f of files) {
  const doc = parse(readFileSync(d + "/" + f, "utf8"));
  const rows = Object.entries(doc.steps).filter(([, s]: any) => "agent" in s);
  if (!rows.length) continue;
  console.log("\n### " + f + "\n");
  console.log("| step | skills | orientation |\n|---|---|---|");
  for (const [n, s] of rows as any) console.log("| " + n + " | " + (s.skills ?? []).join(", ") + " | " + String(s.agent).trim().replace(/\n/g, " ").replace(/\|/g, "\\|") + " |");
}
