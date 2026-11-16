import { parse } from "/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-343-a-step-is-written-with-two-keys-for-one/node_modules/yaml/dist/index.js";
import { readFileSync } from "node:fs";
const a=parse(readFileSync(process.argv[2],"utf8")), b=parse(readFileSync(process.argv[3],"utf8"));
for (const [n,s] of Object.entries<any>(a.steps)) { const t=b.steps[n]; const oldText=s.instructions??s.run??s.prompt; const newText=t.agent??t.check??t.gate; console.log(n, "head text equal:", oldText===undefined?"(none)":oldText===newText); for (const [o,e] of Object.entries<any>(s.outcomes??{})) if (e&&e.means) console.log(" ",o,"means equal:", e.means===t.means?.[o]); }
