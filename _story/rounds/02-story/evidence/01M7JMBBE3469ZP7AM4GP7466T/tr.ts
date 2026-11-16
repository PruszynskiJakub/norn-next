import { translateWording } from "/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-343-a-step-is-written-with-two-keys-for-one/packages/store/src/index.ts";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
const [inp, out] = process.argv.slice(2);
const t = readFileSync(inp, "utf8");
const r = translateWording(t, inp);
if (!r.ok) { console.log("REFUSED", JSON.stringify(r)); process.exit(3); }
if (out) { mkdirSync(dirname(out), {recursive:true}); writeFileSync(out, r.text); } else process.stdout.write(r.text);
const r2 = translateWording(r.text, inp);
console.error(`changed=${r.changed} idempotent=${r2.ok && r2.text===r.text && !r2.changed}`);
