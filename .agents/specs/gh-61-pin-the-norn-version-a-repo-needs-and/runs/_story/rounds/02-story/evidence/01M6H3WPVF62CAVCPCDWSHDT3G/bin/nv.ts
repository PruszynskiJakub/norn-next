import { runCli } from "/Users/jakubpruszynski/Projects/norn-worktrees/gh-61-pin-the-norn-version-a-repo-needs-and/packages/cli/src/cli.ts";
const r = await runCli(process.argv.slice(2), { version: process.env.NV || undefined, log: (l) => process.stderr.write(l + "\n") });
if (r.stderr) process.stderr.write(r.stderr);
process.stdout.write(r.stdout);
process.exit(r.exit);
