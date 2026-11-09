import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendProgress } from "../../trees/gh273-new/packages/cli/src/runtime/report.ts";
const f = join(mkdtempSync(join(tmpdir(), "p-")), "_story.md");
writeFileSync(f, "## Goal\n\nG\n\n## Progress\n\n- ran it:\n\n```sh\n# install deps\nbun install\n```\n\n## Resume\n\nR\n");
appendProgress(f, "s#1 done: x");
console.log(readFileSync(f, "utf8"));
