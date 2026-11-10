import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHarness } from "/Users/jakubpruszynski/Projects/norn-worktrees/gh-318-unit-worktrees-live-in-the-machine-dir/test/support/harness.ts";
const h = await createHarness(); await h.norn("init");
mkdirSync(join(h.dir, "repo-worktrees"));
try { h.cleanup(); console.log("cleanup did NOT throw"); } catch (e) { console.log("cleanup threw:", (e as Error).message); }
console.log("harness dir removed:", !existsSync(h.dir));
const g = await createHarness(); await g.norn("init"); g.cleanup(); console.log("clean harness: cleanup ok, removed:", !existsSync(g.dir));
