import { parse } from "/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-343-a-step-is-written-with-two-keys-for-one/node_modules/yaml/dist/index.js";
import { readFileSync } from "node:fs";
const HEAD=["agent","check","gate","update-branch","open-pr","integrate","push","await-merge","slices","use"];
const OLD=["type","skill","instructions","run","prompt","action"];
for (const f of process.argv.slice(2)) { const d=parse(readFileSync(f,"utf8")); for (const [n,s] of Object.entries(d.steps??{})) { const k=Object.keys(s as any); const heads=k.filter(x=>HEAD.includes(x)); const old=k.filter(x=>OLD.includes(x)); const edgeProse=Object.values((s as any).outcomes??{}).some((e:any)=>e&&typeof e==="object"&&("means" in e||"verdict" in e)); const ok=(heads.length===1&&k[0]===heads[0]||k[0]==="like")&&!old.length&&!edgeProse; console.log(ok?"ok ":"BAD", f, n, k.join(",")); } }
