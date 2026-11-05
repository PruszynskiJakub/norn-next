import { acquireTickLock } from "/Users/jakubpruszynski/Projects/norn-worktrees/gh-61-pin-the-norn-version-a-repo-needs-and/packages/store/src/index.ts";
const l = await acquireTickLock(process.argv[2], { note: "norn watch", now: () => new Date().toISOString() });
console.log("held", l.ok); await Bun.sleep(8000); if (l.ok) l.release();
