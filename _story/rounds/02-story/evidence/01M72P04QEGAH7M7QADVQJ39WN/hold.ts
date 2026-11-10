import { acquireTickLock } from "/Users/jakubpruszynski/Projects/norn-worktrees/gh-317-simplify-norn-upgrade-assume-every-repo/packages/store/src/index.ts";
const r = await acquireTickLock(process.argv[2], { note: "qa holder" });
console.log("held:", r.ok); await Bun.sleep(15000);
