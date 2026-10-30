import { loadProjectView } from "@norn/view";
const [repoRoot, now] = [process.argv[2]!, Number(process.argv[3])];
const v = await loadProjectView({ repoRoot, now, env: { NORN_HOME_DIR: process.argv[4] } });
console.log(JSON.stringify({ timeline: v.timeline, errors: v.errors }));
