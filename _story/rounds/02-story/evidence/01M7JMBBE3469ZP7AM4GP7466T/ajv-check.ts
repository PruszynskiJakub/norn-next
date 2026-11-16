import Ajv from "/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-343-a-step-is-written-with-two-keys-for-one/packages/schema/node_modules/ajv/dist/ajv.js";
import { parse } from "/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-343-a-step-is-written-with-two-keys-for-one/node_modules/yaml/dist/index.js";
import { readFileSync } from "node:fs";
const ajv = new (Ajv as any).default ? new (Ajv as any).default({ allErrors: true, strict: false }) : new (Ajv as any)({ allErrors: true, strict: false });
const v = (s: string) => ajv.compile(JSON.parse(readFileSync("/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-343-a-step-is-written-with-two-keys-for-one/packages/schema/json/" + s + ".schema.json", "utf8")));
const src = v("workflow-source"), sh = v("workflow-shared");
const cases: [string, any][] = [
  ["/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-343-a-step-is-written-with-two-keys-for-one/packages/cli/assets/workflows/quick.yaml", src],
  ["/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-343-a-step-is-written-with-two-keys-for-one/packages/cli/assets/workflows/story.yaml", src],
  ["/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-343-a-step-is-written-with-two-keys-for-one/.agents/workflows/release.yaml", src],
  ["/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-343-a-step-is-written-with-two-keys-for-one/packages/cli/assets/workflows/shared/base-update.yaml", sh],
  ["/private/tmp/claude-501/-Users-jakubpruszynski--norn-repos-norn-b68fe828-worktrees-gh-343-a-step-is-written-with-two-keys-for-one/26f879fb-29ed-468d-aba8-6f306806ce15/scratchpad/qa/old/quick.yaml (origin/main)", src],
  ["/private/tmp/claude-501/-Users-jakubpruszynski--norn-repos-norn-b68fe828-worktrees-gh-343-a-step-is-written-with-two-keys-for-one/26f879fb-29ed-468d-aba8-6f306806ce15/scratchpad/qa/old/sync.yaml (origin/main shared)", sh],
];
for (const [f, fn] of cases) {
  const ok = fn(parse(readFileSync(f.split(" ")[0], "utf8")));
  const errs = (fn.errors ?? []).filter((e: any) => e.keyword === "additionalProperties").slice(0, 4).map((e: any) => e.instancePath + " extra " + e.params.additionalProperty);
  console.log(ok ? "VALID  " : "INVALID", f.replace("/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-343-a-step-is-written-with-two-keys-for-one/", "").replace("/private/tmp/claude-501/-Users-jakubpruszynski--norn-repos-norn-b68fe828-worktrees-gh-343-a-step-is-written-with-two-keys-for-one/26f879fb-29ed-468d-aba8-6f306806ce15/scratchpad/qa/", "qa/"), ok ? "" : "(" + fn.errors.length + " errors, e.g. " + errs.join("; ") + ")");
}
