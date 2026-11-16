import ts from "/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-343-a-step-is-written-with-two-keys-for-one--06-integration-fixtures/node_modules/typescript/lib/typescript.js";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { parse } from "/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-343-a-step-is-written-with-two-keys-for-one--06-integration-fixtures/node_modules/yaml/dist/index.js";
import { parseWorkflowText } from "/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-343-a-step-is-written-with-two-keys-for-one--06-integration-fixtures/packages/store/src/unit.ts";
import { translateWordingValue } from "/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-343-a-step-is-written-with-two-keys-for-one--06-integration-fixtures/packages/store/src/wording.ts";
const files = execSync("git diff --name-only -- packages/cli/test/integration", { encoding: "utf8" }).trim().split("\n");
const lits = (src: string) => {
  const sf = ts.createSourceFile("x.ts", src, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const v = (n: ts.Node) => {
    if (ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n) || ts.isStringLiteral(n)) {
      const raw = ts.isStringLiteral(n) ? JSON.parse(JSON.stringify(n.text)) : src.slice(n.getStart(sf) + 1, n.getEnd() - 1);
      let i = 0;
      // cook escapes the way the runtime would, interpolations become plain tokens
      const t = raw.replace(/\$\{([^{}]|\{[^{}]*\})*\}/g, () => "PLH" + i++ + "X");
      out.push(ts.isStringLiteral(n) ? t : t.replace(/\\`/g, "`").replace(/\\n/g, "\n").replace(/\\\\/g, "\\"));
    }
    ts.forEachChild(n, v);
  };
  v(sf);
  return out;
};
let bad = 0, same = 0, checked = 0;
for (const f of files) {
  const a = lits(execSync("git show HEAD:" + f, { encoding: "utf8" })), b = lits(readFileSync(f, "utf8"));
  if (a.length !== b.length) { console.log("COUNT", f, a.length, b.length); bad++; continue; }
  a.forEach((x, i) => {
    const y = b[i];
    if (x === y) return;
    if (!/steps:|start:/.test(x)) return;
    checked++;
    const pa = parseWorkflowText(x, f, "copy"), pb = parseWorkflowText(y, f, "checkout");
    if (pa.ok && pb.ok) { if (isDeepStrictEqual(pa.value, pb.value)) same++; else { bad++; console.log("DIFF", f, i, JSON.stringify(pa.value), JSON.stringify(pb.value)); } return; }
    let va, vb; try { va = translateWordingValue(parse(x)); vb = parse(y); } catch (e) { console.log("PARSE", f, i, String(e).slice(0, 80)); bad++; return; }
    if (isDeepStrictEqual(va, vb)) same++; else { bad++; console.log("VDIFF", f, i, pa.ok, pb.ok, JSON.stringify(va), JSON.stringify(vb)); }
  });
}
console.log({ checked, same, bad });
