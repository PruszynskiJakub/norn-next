import ts from "/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-343-a-step-is-written-with-two-keys-for-one--06-integration-fixtures/node_modules/typescript/lib/typescript.js";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { translateWording } from "/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-343-a-step-is-written-with-two-keys-for-one--06-integration-fixtures/packages/store/src/wording.ts";
const dir = process.argv[2];
const write = process.argv[3] === "--write";
const OLD = /(^|\n)\s*(type: ?["']?(agent|check|gate|git|merge|slices)\b|skill: |action: |instructions: |prompt: |run: )|"type": ?"(agent|check|gate|git|merge|slices)"/;
for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts"))) {
  const path = dir + "/" + f;
  const src = readFileSync(path, "utf8");
  const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true);
  const edits: { start: number; end: number; text: string }[] = [];
  const visit = (n: ts.Node) => {
    let raw: string | undefined, start = 0, end = 0, isTpl = false;
    if (ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n)) { start = n.getStart(sf) + 1; end = n.getEnd() - 1; raw = src.slice(start, end); isTpl = true; }
    if (raw !== undefined && OLD.test(raw) && /\n/.test(raw)) {
      const subs: string[] = [];
      const text = raw.replace(/\\\$\{/g, "\u0000").replace(/\$\{([^{}]|\{[^{}]*\})*\}/g, (m) => { subs.push(m); return "PLH" + (subs.length - 1) + "X"; }).replace(/\u0000/g, "\\${");
      const line = sf.getLineAndCharacterOfPosition(start).line + 1;
      const t = translateWording(text, f);
      if (!t.ok) { console.log("REFUSED", f + ":" + line, t.message, t.line); return; }
      if (!t.changed) { console.log("UNCHANGED", f + ":" + line); return; }
      let out = t.text.replace(/PLH(\d+)X/g, (_, i) => subs[+i]);
      if (/PLH\d/.test(out)) { console.log("LEFTOVER", f + ":" + line); return; }
      edits.push({ start, end, text: out });
      console.log("OK", f + ":" + line);
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  if (write && edits.length) {
    let s = src;
    for (const e of edits.sort((a, b) => b.start - a.start)) s = s.slice(0, e.start) + e.text + s.slice(e.end);
    writeFileSync(path, s);
  }
}
