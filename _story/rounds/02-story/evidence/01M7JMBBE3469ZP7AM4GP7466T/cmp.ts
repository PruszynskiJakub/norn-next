import { parse } from "/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-343-a-step-is-written-with-two-keys-for-one/node_modules/yaml/dist/index.js";
import { readFileSync } from "node:fs";
for (const f of ["quick","story","slice","refinement","reproduce","triage"]) {
  const o = parse(readFileSync("/private/tmp/claude-501/-Users-jakubpruszynski--norn-repos-norn-b68fe828-worktrees-gh-343-a-step-is-written-with-two-keys-for-one/26f879fb-29ed-468d-aba8-6f306806ce15/scratchpad/qa/old/" + f + ".yaml","utf8")).steps, n = parse(readFileSync("/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-343-a-step-is-written-with-two-keys-for-one/packages/cli/assets/workflows/" + f + ".yaml","utf8")).steps;
  for (const [k, s] of Object.entries(n) as any) if ("agent" in s) {
    const old = String(o[k]?.instructions ?? "").replace(/\s+/g," ").trim(), nw = String(s.agent).replace(/\s+/g," ").trim();
    console.log(f.padEnd(11), k.padEnd(13), old === nw ? "same as old instructions" : old === "" ? "NEW (no old instructions)" : "rewritten");
  }
}
