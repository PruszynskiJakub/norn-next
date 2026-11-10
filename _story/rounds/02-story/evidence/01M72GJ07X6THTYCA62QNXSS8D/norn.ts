import { runCli } from "/Users/jakubpruszynski/Projects/norn-worktrees/gh-317-simplify-norn-upgrade-assume-every-repo/packages/cli/src/cli.ts";
const v = process.env.QA_VERSION;
const r = await runCli(process.argv.slice(2), { ...(v ? { version: v } : {}), log: (l: string) => process.stderr.write(l + "\n") } as any);
process.stderr.write(r.stderr ?? ""); process.stdout.write(r.stdout); process.exit(r.exit);
